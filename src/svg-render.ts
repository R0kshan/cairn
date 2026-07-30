/**
 * Stage 5: serializes a laid-out `Scene` to a deterministic SVG string. Resolves
 * per-element styling (theme → per-kind → inline), draws each node kind with its
 * own shape function, routes edges with crossing "hops", settles flow-label
 * positions to keep overlaps at zero, and appends the flows/objects/legend bands.
 * All text goes through `esc`/`escAttr`; output must stay byte-identical across
 * runs, so only the arithmetic allowed by CLAUDE.md is used here.
 */

import type { Model, StyleProps, Flow } from "./models/ast.ts";
import type { View } from "./views.ts";
import { themeFor, flowPalette } from "./themes.ts";
import { UI } from "./localization.ts";
import { esc, escAttr } from "./xml-escape.ts";
import { type Box, boundsOf, boxesOverlap, boxGapSq, boxToPolylineSq } from "./geometry.ts";
import type { Scene, SceneNode, SceneEdge, SceneLabel } from "./scene-layout.ts";
import { compactVertical } from "./compact.ts";
import { chipW, techText, wrapText, fontSizes } from "./text-metrics.ts";

const HOP_RADIUS = 5;
/**
 * Halo stroked behind flow-label text. Labels sit *on* their run, so this is
 * what stops the line reading as a strike-through: at 4 the halos of adjacent
 * glyphs meet, masking the run across the whole word instead of outlining each
 * letter and letting the line show through the gaps between them.
 */
const LABEL_HALO = 4;
/**
 * Character-width factor for positioning text inside the rendered bands (flow
 * list, legend). Deliberately narrower than text-metrics' CHAR_WIDTH (0.56):
 * the bands pack labels tighter, and this 0.52 keeps chip/wrap placement snug.
 * Changing it shifts band geometry — see the determinism note in CLAUDE.md.
 */
const RENDER_CHAR_WIDTH = 0.52;
const SEC_LEVEL_FR: Record<string, string> = {
  public: "public",
  internal: "interne",
  restricted: "restreint",
  secret: "secret",
};

const dashArray = (lineStyle?: string) =>
  lineStyle === "dashed" ? "5 3" : lineStyle === "dotted" ? "2 2.5" : undefined;

interface ElementStyleEntry {
  id: string;
  style: StyleProps | undefined;
  attrValue: string | undefined;
}

export interface RenderResult {
  svg: string;
  overlapsBefore: number;
  overlapsAfter: number;
}

/** Assigns each unique flow-source its own palette hue, in first-seen order. */
function assignSourceHues(model: Model, hues: string[]): Map<string, string> {
  const sourceHue = new Map<string, string>();
  for (const flow of model.flows) {
    if (sourceHue.has(flow.from)) continue;
    sourceHue.set(flow.from, hues[sourceHue.size % hues.length]);
  }
  return sourceHue;
}

/** Flattened per-element style/attr entries for `elements` and all their descendants, pre-order. */
function collectElementStyles(elements: Model["elements"]): ElementStyleEntry[] {
  return elements.flatMap((element) => [
    { id: element.id, style: element.style, attrValue: element.attr?.value },
    ...collectElementStyles(element.children),
  ]);
}

export function render(model: Model, view: View, scene: Scene): RenderResult {
  const style = model.style;
  const fonts = fontSizes(style.font.size);
  const { edge: edgeFontSize, node: nodeFontSize, cont: containerFontSize } = fonts;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const annot = {
    tech: round1(fonts.tech),
    chip: round1(fonts.chip),
    tag: round1(fonts.tag),
    band: round1(fonts.band),
    bandTitle: round1(fonts.bandTitle),
    chipH: Math.round(fonts.chipH),
    scale: fonts.scale,
    chipRectH: Math.round(15 * fonts.scale),
    chipTextDy: round1(11 * fonts.scale),
  };
  const scaled = (n: number) => round1(n * fonts.scale);
  const { palette, kinds: kindDefaults, levels: levelDefaults } = themeFor(style.theme, view);
  const isDarkTheme = ["dark", "nord", "classic-dark"].includes(style.theme);
  const defaultEdgeColor = style.flowStrokeColorSet
    ? style.flowStroke.color
    : (style.accent ?? palette.edge);

  const sourceHue =
    style.flowColor === "by-source"
      ? assignSourceHues(model, flowPalette[isDarkTheme ? "dark" : "light"])
      : new Map<string, string>();
  const flowColorOf = (flow?: Flow): string =>
    flow?.style?.stroke?.color ??
    (style.flowColor === "by-source"
      ? (sourceHue.get(flow?.from ?? "") ?? defaultEdgeColor)
      : defaultEdgeColor);

  const arrowMarkers = new Map<string, string>();
  const markerName = (color: string): string => {
    let name = arrowMarkers.get(color);
    if (!name) {
      name = arrowMarkers.size === 0 ? "arr" : `arr${arrowMarkers.size}`;
      arrowMarkers.set(color, name);
    }
    return name;
  };

  const flowById = new Map<string, Flow>(model.flows.map((flow) => [flow.id, flow]));
  const objectName = new Map(model.businessObjects.map((bo) => [bo.id, bo.name]));
  const numbered = style.flowText === "numbered";
  const ui = UI[style.lang] ?? UI.en;
  const legendNames = style.lang === "fr" ? view.legendNamesFr : view.legendNames;
  const legendFlowLabel = style.lang === "fr" ? view.legendFlowLabelFr : view.legendFlowLabel;

  const elementStyle = new Map<string, StyleProps | undefined>();
  const elementAttr = new Map<string, string | undefined>();
  for (const entry of collectElementStyles(model.elements)) {
    elementStyle.set(entry.id, entry.style);
    elementAttr.set(entry.id, entry.attrValue);
  }

  const resolveStyle = (kind: string, id: string): StyleProps => {
    let base = kindDefaults[kind] ?? {};
    const level = elementAttr.get(id);
    if (kind === "trust-zone" && level && levelDefaults?.[level]) base = levelDefaults[level];
    const perKind = style.kind[kind] ?? {};
    const inline = elementStyle.get(id) ?? {};
    return {
      fill: inline.fill ?? perKind.fill ?? base.fill,
      stroke: { ...base.stroke, ...perKind.stroke, ...inline.stroke },
      text: inline.text ?? perKind.text ?? base.text,
    };
  };

  const nodeBoxes: Box[] = scene.nodes
    .filter((node) => !node.container)
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
  const labels: SceneLabel[] = scene.edges.flatMap((edge) => edge.labels);

  const countLabelOverlaps = (): number => {
    let count = 0;
    for (let index = 0; index < labels.length; index++) {
      for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex++)
        if (boxesOverlap(labels[index] as Box, labels[otherIndex] as Box)) count++;
      for (const node of nodeBoxes) if (boxesOverlap(labels[index] as Box, node)) count++;
    }
    return count;
  };

  const ownRun = new Map<SceneLabel, SceneEdge>();
  for (const edge of scene.edges) for (const label of edge.labels) ownRun.set(label, edge);
  const routes = scene.edges
    .filter((edge) => edge.pts.length >= 2)
    .map((edge) => ({ edge, bounds: boundsOf(edge.pts) }));

  /**
   * How far a label may sit from its own flow. Squared, like everything else
   * here. 20px matches the sweep's `labelAdrift` gate: past it the label is
   * further from its flow than `MIN_ATTACH_GAP` puts the neighbouring one, so
   * there is nothing left to tell the reader which run it annotates.
   */
  const ADRIFT_SQ = 20 * 20;
  /** Within this a label reads as sitting on its run whatever else is nearby. */
  const ATTACHED_SQ = 6 * 6;

  const offOwnRun = (label: SceneLabel) => {
    const edge = ownRun.get(label);
    return edge && edge.pts.length >= 2 ? boxToPolylineSq(label as Box, edge.pts) : 0;
  };
  /**
   * Is some other flow's run closer to this label than its own run is? If so the
   * reader will attribute the label to the wrong flow, which is the whole defect
   * this guards against.
   *
   * A label within `ATTACHED_SQ` of its own run is exempt: it is visibly sitting
   * on that run, and a neighbour grazing 1px nearer changes nothing a reader
   * would notice. That case is two flows running close together, which
   * `nearParallel` already accounts for.
   */
  const stolen = (label: SceneLabel, own: number) => {
    if (own <= ATTACHED_SQ) return false;
    const mine = ownRun.get(label);
    return routes.some(
      (route) =>
        route.edge !== mine &&
        boxGapSq(label as Box, route.bounds) < own &&
        boxToPolylineSq(label as Box, route.edge.pts) < own,
    );
  };

  /**
   * Is another flow's run drawn straight *through* the label box?
   *
   * This is the worst ambiguity and the one neither rule above can see. A label
   * centred on its own run has `own` of 0 — inside `ATTACHED_SQ`, and nothing
   * can be nearer than its own flow — so it passes both checks while a second
   * flow crosses the words themselves. The reader gets no cue at all.
   *
   * Not measured at exactly 0: the renderer strokes a halo behind label text, so
   * a line grazing the box edge stays legible. It is the line through the middle
   * that has to go.
   */
  const PIERCE_SQ = 1;
  const pierced = (label: SceneLabel) => {
    const mine = ownRun.get(label);
    return routes.some(
      (route) =>
        route.edge !== mine &&
        boxGapSq(label as Box, route.bounds) <= PIERCE_SQ &&
        boxToPolylineSq(label as Box, route.edge.pts) <= PIERCE_SQ,
    );
  };

  /**
   * Where the label would sit centred on each run of its own flow, in segment
   * order. A label crowded off its preferred run can often still sit — clearly
   * attached, on the right flow — somewhere else along the same route, which
   * beats being flung into open space to escape a collision.
   */
  const ownRunMidpoints = (label: SceneLabel) => {
    const edge = ownRun.get(label);
    const seats: { x: number; y: number }[] = [];
    if (!edge) return seats;
    const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const a = edge.pts[index];
      const b = edge.pts[index + 1];
      seats.push({
        x: (a.x + b.x) / 2 - label.width / 2,
        y: (a.y + b.y) / 2 - lead,
      });
    }
    return seats;
  };

  /**
   * Seats along the label's own run, in both directions from wherever it sits.
   *
   * This is the escape that keeps invariant §4d: sliding *along* a run never
   * takes the label off it, so a label crowded by a neighbour can move a long
   * way and still be on its own line. Perpendicular steps — the ladder below —
   * are what take it off, and are only reached once every slide has failed.
   */
  const alongOwnRun = (label: SceneLabel): { x: number; y: number }[] => {
    const edge = ownRun.get(label);
    if (!edge || edge.pts.length < 2) return [];
    const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
    const seats: { x: number; y: number }[] = [];
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const a = edge.pts[index];
      const b = edge.pts[index + 1];
      const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
      const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
      const room = Math.max(0, (span - (vertical ? label.height : label.width)) / 2);
      if (room === 0) continue;
      for (const fraction of [-0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1]) {
        const shift = room * fraction;
        seats.push(
          vertical
            ? { x: (a.x + b.x) / 2 - label.width / 2, y: (a.y + b.y) / 2 + shift - lead }
            : { x: (a.x + b.x) / 2 + shift - label.width / 2, y: (a.y + b.y) / 2 - lead },
        );
      }
    }
    return seats;
  };

  const settleLabelPositions = () => {
    for (const label of labels) {
      const requested = flowById.get(label.flowId)?.style?.label ?? style.flowLabel;
      if (requested === "above") label.y -= label.height / 2 + 5;
      else if (requested === "below") label.y += label.height / 2 + 5;
    }
    for (const label of labels) {
      const collides = () =>
        labels.some((other) => other !== label && boxesOverlap(other as Box, label as Box)) ||
        nodeBoxes.some((node) => boxesOverlap(node, label as Box));
      /** Can the reader tell, from this position alone, which flow is speaking? */
      const attributableHere = () => {
        const own = offOwnRun(label);
        return own <= ADRIFT_SQ && !stolen(label, own) && !pierced(label);
      };
      // A label is moved for either reason. Overlap alone was the old trigger,
      // and it misses the whole `labelPierced` population: a label centred on
      // its own run overlaps nothing at all while another flow is drawn through
      // the middle of its text.
      if (!collides() && attributableHere()) continue;
      const originY = label.y,
        originX = label.x;
      const here = { x: originX, y: originY };
      // Two rounds. The first refuses any escape that detaches the label from
      // its flow or parks it nearer a different one, and will walk the label to
      // another run of its own flow rather than accept one. The second drops
      // that condition entirely.
      //
      // The order is not a preference. An overlapping label is unreadable, an
      // ambiguous one is merely misleading — so zero overlaps, a hard invariant,
      // outranks attribution every time. Attribution is a ratchet exactly
      // because it has to yield here, and these are the cases where it does.
      let settled = false;
      // Round 0: stay on the line. Every seat here is *on* the run — its
      // midpoints and points sliding along it — so §4d survives the escape.
      // Only if the label cannot be placed anywhere along its own flow do the
      // perpendicular rounds below get to take it off the line.
      //
      // Two sweeps over the same seats. The first also wants attribution; the
      // second takes any seat that is merely overlap-free, pierced or not.
      // That order encodes the ranking: overlapping is unreadable, off the line
      // breaks §4d, pierced is a ratchet — so a pierced seat *on* the run beats
      // a clean one beside it, and only a collision sends the label off.
      const onLineSeats = [...ownRunMidpoints(label), ...alongOwnRun(label)];
      for (const wantAttributable of [true, false]) {
        for (const seat of onLineSeats) {
          label.x = seat.x;
          label.y = seat.y;
          if (collides()) continue;
          if (wantAttributable && !attributableHere()) continue;
          settled = true;
          break;
        }
        if (settled) break;
      }
      for (const attributable of settled ? [] : [true, false]) {
        const origins = attributable ? [here, ...ownRunMidpoints(label)] : [here];
        // The attributable round slides further sideways than the relaxed one:
        // along its own run a label keeps `own` at 0 whatever the distance, so
        // a long slide is how a label wider than the gap between two crossing
        // runs dodges the one that pierces it without leaving its flow. The
        // relaxed round keeps the short ladder — unguarded long throws are how
        // a label ends up in a stranger's corridor.
        const slides = attributable
          ? [0, -24, 24, -48, 48, -72, 72, -96, 96]
          : [0, -24, 24, -48, 48];
        outer: for (const origin of origins) {
          for (const dx of slides) {
            for (const step of [0, 8, 14, 20, 28, 36, 44, 56, 70, 86]) {
              for (const dir of step === 0 ? [1] : [-1, 1]) {
                label.y = origin.y + dir * step;
                label.x = origin.x + dx;
                if (collides()) continue;
                if (attributable && !attributableHere()) continue;
                settled = true;
                break outer;
              }
            }
          }
        }
        if (settled) break;
      }
      if (!settled) {
        label.x = originX;
        label.y = originY;
      }
    }
  };

  const overlapsBefore = countLabelOverlaps();
  settleLabelPositions();
  const overlapsAfter = countLabelOverlaps();
  // Settling can move a label off a band that nothing else pinned — an extreme
  // label at the top of the drawing escaping downward strands dead height that
  // the layout-stage compact already ran too early to see. Reclaiming again
  // here closes that for every settle trigger. Safe on settled geometry: band
  // removal is monotone, keeps ≥14px between pinned extents, and never reorders
  // anything, so it cannot create an overlap, a pierce, or a new collision.
  // No-op when settling stranded nothing, which is the common case.
  compactVertical(scene);

  const verticalSegments: { x: number; y1: number; y2: number }[] = [];
  if (style.crossingHops) {
    for (const edge of scene.edges) {
      for (let segmentIndex = 0; segmentIndex + 1 < edge.pts.length; segmentIndex++) {
        const point = edge.pts[segmentIndex],
          nextPoint = edge.pts[segmentIndex + 1];
        if (Math.abs(point.x - nextPoint.x) < 0.5)
          verticalSegments.push({
            x: point.x,
            y1: Math.min(point.y, nextPoint.y),
            y2: Math.max(point.y, nextPoint.y),
          });
      }
    }
  }
  const edgePath = (pts: { x: number; y: number }[]): string => {
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let segmentIndex = 0; segmentIndex + 1 < pts.length; segmentIndex++) {
      const point = pts[segmentIndex],
        nextPoint = pts[segmentIndex + 1];
      if (
        style.crossingHops &&
        Math.abs(point.y - nextPoint.y) < 0.5 &&
        Math.abs(point.x - nextPoint.x) >= 0.5
      ) {
        const direction = Math.sign(nextPoint.x - point.x);
        const rangeStart = Math.min(point.x, nextPoint.x) + HOP_RADIUS + 1,
          rangeEnd = Math.max(point.x, nextPoint.x) - HOP_RADIUS - 1;
        const crossings = verticalSegments
          .filter(
            (vertical) =>
              vertical.x > rangeStart &&
              vertical.x < rangeEnd &&
              point.y > vertical.y1 + 1 &&
              point.y < vertical.y2 - 1,
          )
          .map((vertical) => vertical.x)
          .sort((pointA, pointB) => (direction > 0 ? pointA - pointB : pointB - pointA));
        for (const crossingX of crossings)
          path += ` L ${crossingX - direction * HOP_RADIUS} ${point.y} A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${direction > 0 ? 1 : 0} ${crossingX + direction * HOP_RADIUS} ${point.y}`;
      }
      path += ` L ${nextPoint.x} ${nextPoint.y}`;
    }
    return path;
  };

  const centeredNodeLabel = (
    lines: string[],
    centerX: number,
    topBaseline: number,
    fill: string,
  ): string =>
    lines
      .map(
        (line, index) =>
          `<text x="${centerX}" y="${topBaseline + index * (nodeFontSize + 2)}" font-size="${nodeFontSize}" text-anchor="middle" fill="${fill}">${esc(line)}</text>\n`,
      )
      .join("");
  const centerLinesY = (top: number, height: number, lineCount: number) =>
    top + height / 2 - ((lineCount - 1) * (nodeFontSize + 2)) / 2 + 4;

  const renderContainerNode = (node: SceneNode): string => {
    const nodeStyle = resolveStyle(node.kind, node.id);
    const fill = escAttr(nodeStyle.fill ?? palette.containerFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.containerStroke),
      text = escAttr(nodeStyle.text ?? palette.containerLabel);
    const dash = dashArray(nodeStyle.stroke?.style);
    let svg = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${nodeStyle.stroke?.width ?? 1.2}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n`;
    node.label.split("\n").forEach((line, index) => {
      svg += `<text x="${node.x + 10}" y="${node.y + 18 + index * 14}" font-size="${containerFontSize}" font-weight="bold" fill="${text}">${esc(line)}</text>\n`;
    });
    const level = node.kind === "trust-zone" ? elementAttr.get(node.id) : undefined;
    if (level) {
      const word = (style.lang === "fr" ? SEC_LEVEL_FR[level] : level) ?? level;
      svg += `<text x="${node.x + node.width - 9}" y="${node.y + node.height - 6}" font-size="${annot.tag}" text-anchor="end" font-weight="bold" fill="${stroke}" letter-spacing="0.5">${esc(word.toUpperCase())}</text>\n`;
    }
    return svg;
  };

  const renderActor = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const centerX = node.x + node.width / 2;
    const stroke = escAttr(nodeStyle.stroke?.color ?? palette.actorStroke);
    const text = escAttr(nodeStyle.text ?? palette.actorText);
    let svg = `<circle cx="${centerX}" cy="${node.y + 10}" r="7" fill="none" stroke="${stroke}" stroke-width="1.5"/>
<path d="M ${centerX - 11} ${node.y + 32} q 11 -19 22 0" fill="none" stroke="${stroke}" stroke-width="1.5"/>\n`;
    lines.forEach((line, index) => {
      svg += `<text x="${centerX}" y="${node.y + 44 + index * 11}" font-size="${nodeFontSize - 1.5}" text-anchor="middle" fill="${text}">${esc(line)}</text>\n`;
    });
    return svg;
  };

  const renderDatastore = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const ry = 7;
    const stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      fill = escAttr(nodeStyle.fill ?? palette.nodeFill);
    const body =
      `<path d="M ${node.x} ${node.y + ry} v ${node.height - 2 * ry} a ${node.width / 2} ${ry} 0 0 0 ${node.width} 0 v ${-(node.height - 2 * ry)}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + ry}" rx="${node.width / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n`;
    const centerY =
      node.y + ry + (node.height - ry) / 2 - ((lines.length - 1) * (nodeFontSize + 2)) / 2 + 4;
    return (
      body +
      centeredNodeLabel(
        lines,
        node.x + node.width / 2,
        centerY,
        escAttr(nodeStyle.text ?? palette.nodeText),
      )
    );
  };

  const renderQueue = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const rx = 8;
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const body =
      `<path d="M ${node.x + rx} ${node.y} h ${node.width - 2 * rx} a ${rx} ${node.height / 2} 0 0 1 0 ${node.height} h ${-(node.width - 2 * rx)} a ${rx} ${node.height / 2} 0 0 1 0 ${-node.height}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<ellipse cx="${node.x + rx}" cy="${node.y + node.height / 2}" rx="${rx}" ry="${node.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n`;
    return (
      body +
      centeredNodeLabel(
        lines,
        node.x + rx + (node.width - rx) / 2,
        centerLinesY(node.y, node.height, lines.length),
        text,
      )
    );
  };

  const renderGateway = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const centerX = node.x + node.width / 2;
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const body =
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<path d="M ${round1(node.x + 8)} ${round1(node.y + 8)} L ${round1(node.x + 22)} ${round1(node.y + 8)} Q ${round1(node.x + 24)} ${round1(node.y + 13)} ${round1(node.x + 15)} ${round1(node.y + 20)} Q ${round1(node.x + 6)} ${round1(node.y + 13)} ${round1(node.x + 8)} ${round1(node.y + 8)}" fill="none" stroke="${stroke}" stroke-width="1.3"/>\n`;
    return (
      body +
      centeredNodeLabel(lines, centerX + 10, centerLinesY(node.y, node.height, lines.length), text)
    );
  };

  const renderAuth = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const centerX = node.x + node.width / 2;
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const body =
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<rect x="${node.x + 6}" y="${node.y + 6}" width="18" height="14" rx="3" fill="none" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<path d="M ${node.x + 10} ${node.y + 9} v -4 a 5 5 0 0 1 10 0 v 4" fill="none" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<circle cx="${node.x + 15}" cy="${node.y + 16}" r="2.5" fill="${stroke}"/>\n`;
    return (
      body +
      centeredNodeLabel(lines, centerX + 10, centerLinesY(node.y, node.height, lines.length), text)
    );
  };

  const renderPlainBox = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const dash = dashArray(nodeStyle.stroke?.style);
    const body = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${nodeStyle.stroke?.width ?? 1.3}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n`;
    return (
      body +
      centeredNodeLabel(
        lines,
        node.x + node.width / 2,
        centerLinesY(node.y, node.height, lines.length),
        text,
      )
    );
  };

  const renderIdp = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const body = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${nodeStyle.stroke?.width ?? 1.3}"/>\n`;
    return (
      body +
      centeredNodeLabel(
        lines,
        node.x + node.width / 2,
        centerLinesY(node.y, node.height, lines.length),
        text,
      )
    );
  };

  const renderLeafNode = (node: SceneNode): string => {
    const nodeStyle = resolveStyle(node.kind, node.id);
    const lines = node.label.split("\n");
    switch (node.kind) {
      case "actor":
        return renderActor(node, nodeStyle, lines);
      case "datastore":
        return renderDatastore(node, nodeStyle, lines);
      case "queue":
        return renderQueue(node, nodeStyle, lines);
      case "gateway":
        return renderGateway(node, nodeStyle, lines);
      case "auth":
        return renderAuth(node, nodeStyle, lines);
      case "idp":
        return renderIdp(node, nodeStyle, lines);
      default:
        return renderPlainBox(node, nodeStyle, lines);
    }
  };

  const renderNumberedBadge = (label: SceneLabel): string => {
    const centerX = label.x + label.width / 2,
      centerY = label.y + label.height / 2 + scaled(3.6),
      size = scaled(10.5);
    return (
      `<text x="${centerX}" y="${centerY}" font-size="${size}" text-anchor="middle" fill="${palette.halo}" stroke="${palette.halo}" stroke-width="3" stroke-linejoin="round" font-weight="bold">${esc(label.text)}</text>\n` +
      `<text x="${centerX}" y="${centerY}" font-size="${size}" text-anchor="middle" fill="${palette.edgeLabel}" font-weight="bold">${esc(label.text)}</text>\n`
    );
  };

  const renderTextLabel = (label: SceneLabel, flowStyle?: StyleProps): string => {
    const lines = label.text ? label.text.split("\n") : [];
    const color = escAttr(flowStyle?.text ?? palette.edgeLabel);
    let svg = lines
      .map(
        (line, index) =>
          `<text x="${label.x + label.width / 2}" y="${label.y + edgeFontSize + 1 + index * (edgeFontSize + 3)}" font-size="${edgeFontSize}" text-anchor="middle" fill="${color}" font-style="italic" stroke="${palette.halo}" stroke-width="${LABEL_HALO}" paint-order="stroke" stroke-linejoin="round">${esc(line)}</text>\n`,
      )
      .join("");
    const flow = flowById.get(label.flowId);
    const tech = techText(flow?.tech);
    if (tech && flow?.label) {
      svg += `<text x="${label.x + label.width / 2}" y="${label.y + edgeFontSize + 1 + lines.length * (edgeFontSize + 3)}" font-size="${annot.tech}" text-anchor="middle" fill="${palette.techText}" stroke="${palette.halo}" stroke-width="${LABEL_HALO}" paint-order="stroke" stroke-linejoin="round">${esc(tech)}</text>\n`;
    }
    const chips = (flow?.objects ?? []).map((objectRef) => objectName.get(objectRef.id) ?? objectRef.id);
    if (!chips.length) return svg;
    const totalW = chips.reduce((sum, name) => sum + chipW(name, annot.scale) + 4, -4);
    let positionX = label.x + label.width / 2 - totalW / 2;
    const cy = label.y + label.height - annot.chipH + 2;
    for (const name of chips) {
      const chipWidth = chipW(name, annot.scale);
      svg += `<rect x="${positionX}" y="${cy}" width="${chipWidth}" height="${annot.chipRectH}" rx="${annot.chipRectH / 2}" fill="${palette.chipFill}" stroke="${palette.chipStroke}" stroke-width="1"/>\n`;
      svg += `<text x="${positionX + chipWidth / 2}" y="${cy + annot.chipTextDy}" font-size="${annot.chip}" text-anchor="middle" fill="${palette.chipText}" font-weight="bold">${esc(name)}</text>\n`;
      positionX += chipWidth + 4;
    }
    return svg;
  };

  /**
   * Flow lines and flow labels are emitted in two separate passes, not one per
   * edge. Labels sit *on* their run (invariant §4d), and a label is only
   * readable there because its halo masks the line behind it — which works only
   * for lines already drawn. Interleaving them left every label at the mercy of
   * every edge drawn after it: the halo hid its own flow and nothing else, so a
   * crossing run struck straight through the words.
   */
  const renderEdgePath = (edge: SceneEdge): string => {
    if (!edge.pts.length) return "";
    const flow = flowById.get(edge.id);
    const flowStyle = flow?.style;
    const color = flowColorOf(flow);
    const headColor = style.flowColor === "by-source" ? color : defaultEdgeColor;
    const dash = dashArray(flowStyle?.stroke?.style ?? style.flowStroke.style);
    const width = flowStyle?.stroke?.width ?? style.flowStroke.width;
    return `<path d="${edgePath(edge.pts)}" fill="none" stroke="${escAttr(color)}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${markerName(headColor)})"/>\n`;
  };

  const renderEdgeLabels = (edge: SceneEdge): string => {
    const flowStyle = flowById.get(edge.id)?.style;
    let svg = "";
    for (const label of edge.labels) {
      svg += numbered ? renderNumberedBadge(label) : renderTextLabel(label, flowStyle);
    }
    return svg;
  };

  let bandY = scene.height;
  let bandsSvg = "";
  const contentX = 150;

  const chip = (x: number, y: number, name: string) => {
    const width = chipW(name, annot.scale);
    return {
      svg:
        `<rect x="${x}" y="${y}" width="${width}" height="${scaled(15)}" rx="${scaled(7.5)}" fill="${palette.chipFill}" stroke="${palette.chipStroke}"/>\n` +
        `<text x="${x + width / 2}" y="${y + scaled(11)}" font-size="${scaled(9.5)}" text-anchor="middle" fill="${palette.chipText}" font-weight="bold">${esc(name)}</text>\n`,
      width,
    };
  };
  const beginBand = (title: string) => {
    bandsSvg += `<line x1="20" y1="${bandY + 10}" x2="${scene.width - 20}" y2="${bandY + 10}" stroke="${palette.divider}" stroke-width="1"/>\n`;
    bandsSvg += `<text x="20" y="${bandY + scaled(32)}" font-size="${scaled(11)}" font-weight="bold" fill="${palette.bandTitle}">${esc(title)}</text>\n`;
    bandY += scaled(20);
  };
  /** Draws a flow's carried-object chips left-to-right starting at (startX, startY); "" when it carries none. */
  const flowChipsSvg = (flow: Flow, startX: number, startY: number): string => {
    if (!flow.objects?.length) return "";
    let out = "";
    let chipX = startX;
    for (const objectRef of flow.objects) {
      const chipResult = chip(chipX, startY, objectName.get(objectRef.id) ?? objectRef.id);
      out += chipResult.svg;
      chipX += chipResult.width + 4;
    }
    return out;
  };

  const renderFlowsBand = () => {
    beginBand(ui.flows);
    const BADGE = scaled(34);
    const GUTTER = scaled(28);
    const LINE_H = scaled(13.5);
    const COL_TARGET = 520;
    const avail = scene.width - contentX - 20;
    let cols = Math.max(1, Math.min(3, Math.floor((avail + GUTTER) / (COL_TARGET + GUTTER))));
    cols = Math.min(cols, model.flows.length);
    const colW = Math.floor((avail - (cols - 1) * GUTTER) / cols);

    const entries = model.flows.map((flow) => {
      const tech = techText(flow.tech);
      const chipsW = (flow.objects ?? []).reduce(
        (sum, objectRef) => sum + chipW(objectName.get(objectRef.id) ?? objectRef.id, annot.scale) + 4,
        0,
      );
      const textW = Math.max(60, colW - BADGE - (chipsW ? chipsW + 6 : 0));
      const maxChars = Math.max(6, Math.floor(textW / (scaled(10) * RENDER_CHAR_WIDTH)));
      const raw = (flow.label ?? "") + (tech ? "  " + tech : "");
      const lines = raw.split("\n").flatMap((segment) => wrapText(segment, maxChars).split("\n"));
      return { flow, lines };
    });

    const rows = Math.ceil(entries.length / cols);
    const colY = new Array(cols).fill(bandY);
    entries.forEach((entry, index) => {
      const col = Math.floor(index / rows);
      const entryX = contentX + col * (colW + GUTTER);
      const entryY = colY[col];
      bandsSvg += `<rect x="${entryX}" y="${entryY}" width="${scaled(24)}" height="${scaled(15)}" rx="${scaled(7.5)}" fill="${palette.badgeFill}" stroke="${palette.badgeStroke}"/>\n`;
      bandsSvg += `<text x="${entryX + scaled(12)}" y="${entryY + scaled(11)}" font-size="${scaled(9.5)}" text-anchor="middle" fill="${palette.bandText}" font-weight="bold">${index + 1}</text>\n`;
      entry.lines.forEach((line, lineIndex) => {
        bandsSvg += `<text x="${entryX + BADGE}" y="${entryY + scaled(11) + lineIndex * LINE_H}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(line)}</text>\n`;
      });
      const lastLine = entry.lines[entry.lines.length - 1] ?? "";
      const chipStartX =
        entryX + BADGE + Math.ceil(lastLine.length * scaled(10) * RENDER_CHAR_WIDTH) + 6;
      const chipStartY = entryY + 1 + (entry.lines.length - 1) * LINE_H;
      bandsSvg += flowChipsSvg(entry.flow, chipStartX, chipStartY);
      colY[col] = entryY + Math.max(scaled(20), entry.lines.length * LINE_H + scaled(7));
    });
    bandY = Math.max(...colY) + 6;
  };

  const renderObjectsBand = () => {
    beginBand(ui.objects);
    for (const bo of model.businessObjects) {
      const chipResult = chip(contentX, bandY + 2, bo.name);
      bandsSvg += chipResult.svg;
      if (bo.description)
        bandsSvg += `<text x="${contentX + chipResult.width + 10}" y="${bandY + scaled(13)}" font-size="${scaled(10)}" fill="${palette.bandMuted}">— ${esc(bo.description)}</text>\n`;
      bandY += scaled(24);
    }
    // What a chip means belongs with the objects it describes, not among the
    // legend's shape keys.
    const keyChip = chip(contentX, bandY + 2, ui.businessObject);
    bandsSvg += keyChip.svg;
    bandsSvg += `<text x="${contentX + keyChip.width + 10}" y="${bandY + scaled(13)}" font-size="${scaled(10)}" fill="${palette.bandMuted}">${esc(ui.carriedByFlow)}</text>\n`;
    bandY += scaled(24) + 6;
  };

  const renderLegendBand = () => {
    beginBand(ui.legend);
    let lx = contentX;
    const kindsUsed = [...new Set(scene.nodes.map((node) => node.kind))].filter(
      (kind) => legendNames[kind] && (kind !== "actor" || view.actorLegend),
    );
    for (const kind of kindsUsed) {
      const nodeStyle = resolveStyle(kind, "");
      if (kind === "actor") {
        const stroke = nodeStyle.stroke?.color ?? palette.actorStroke;
        bandsSvg += `<circle cx="${lx + scaled(13)}" cy="${bandY + scaled(5)}" r="${scaled(3)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>\n`;
        bandsSvg += `<path d="M ${lx + scaled(8)} ${bandY + scaled(15)} q ${scaled(5)} ${scaled(-7)} ${scaled(10)} 0" fill="none" stroke="${stroke}" stroke-width="1.2"/>\n`;
      } else {
        const dash = dashArray(nodeStyle.stroke?.style);
        bandsSvg += `<rect x="${lx}" y="${bandY + 2}" width="${scaled(26)}" height="${scaled(14)}" rx="3" fill="${nodeStyle.fill ?? palette.nodeFill}" stroke="${nodeStyle.stroke?.color ?? palette.nodeStroke}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n`;
      }
      const name = legendNames[kind];
      bandsSvg += `<text x="${lx + scaled(32)}" y="${bandY + scaled(13)}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(name)}</text>\n`;
      lx += scaled(40) + Math.ceil(name.length * scaled(10) * RENDER_CHAR_WIDTH) + scaled(24);
      if (lx > scene.width - 220) {
        lx = contentX;
        bandY += scaled(22);
      }
    }
    bandY += scaled(24);
    bandsSvg += `<line x1="${contentX}" y1="${bandY + 8}" x2="${contentX + scaled(26)}" y2="${bandY + 8}" stroke="${escAttr(defaultEdgeColor)}" stroke-width="1.3" marker-end="url(#${markerName(defaultEdgeColor)})"/>\n`;
    const flowLabelText =
      (numbered ? legendFlowLabel + " — " + ui.numberedSuffix : legendFlowLabel) +
      (style.flowColor === "by-source"
        ? style.lang === "fr"
          ? " — couleur = source"
          : " — colour = source"
        : "");
    bandsSvg += `<text x="${contentX + scaled(32)}" y="${bandY + scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(flowLabelText)}</text>\n`;
    bandY += scaled(24);
    for (const note of model.legendNotes) {
      bandsSvg += `<text x="${contentX}" y="${bandY + scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}" font-style="italic">${esc(note)}</text>\n`;
      bandY += scaled(20);
    }
  };

  let body = "";
  for (const node of scene.nodes) if (node.container) body += renderContainerNode(node);
  for (const node of scene.nodes) if (!node.container) body += renderLeafNode(node);
  for (const edge of scene.edges) body += renderEdgePath(edge);
  for (const edge of scene.edges) body += renderEdgeLabels(edge);

  if (numbered && model.flows.length) renderFlowsBand();
  if (model.businessObjects.length) renderObjectsBand();
  if (style.legend === "auto") renderLegendBand();

  const viewWidth = scene.width,
    viewHeight = scene.height;
  const totalHeight = bandY > viewHeight ? bandY + 14 : viewHeight;
  const markerSize = style.arrows === "large" ? round1(11 * fonts.scale) : 7;
  if (arrowMarkers.size === 0) markerName(defaultEdgeColor);
  const markers = [...arrowMarkers]
    .map(
      ([color, markerName]) =>
        `<marker id="${markerName}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${markerSize}" markerHeight="${markerSize}" orient="auto-start-reverse">\n<path d="M0,0 L10,5 L0,10 z" fill="${escAttr(color)}"/></marker>`,
    )
    .join("\n");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${totalHeight}" font-family="${escAttr(style.font.family)},Arial,sans-serif">
<defs>${markers}</defs>
<rect width="${viewWidth}" height="${totalHeight}" fill="${escAttr(style.background ?? palette.background)}"/>\n` +
    body +
    bandsSvg +
    "</svg>\n";
  return { svg, overlapsBefore, overlapsAfter };
}
