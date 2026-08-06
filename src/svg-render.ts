/**
 * Stage 5: serializes a laid-out `Scene` to a deterministic SVG string. Resolves
 * per-element styling (theme → per-kind → inline), draws each node kind with its
 * own shape function, routes edges with crossing "hops", settles flow-label
 * positions to keep overlaps at zero, and appends the flows/objects/legend bands.
 * All text goes through `esc`/`escAttr`; output must stay byte-identical across
 * runs, so only the arithmetic allowed by AGENTS.md#non-negotiable-invariants is used here.
 */

import type { Model, StyleProps, Flow } from "./models/ast.ts";
import type { View } from "./views.ts";
import { themeFor, flowPalette } from "./themes.ts";
import { UI } from "./localization.ts";
import { esc, escAttr } from "./xml-escape.ts";
import { type Box, boxesOverlap } from "./geometry.ts";
import type { Scene, SceneNode, SceneEdge, SceneLabel } from "./scene-layout.ts";
import { chipW, techText, wrapText, fontSizes } from "./text-metrics.ts";

const HOP_RADIUS = 5;
/**
 * Character-width factor for positioning text inside the rendered bands (flow
 * list, legend). Deliberately narrower than text-metrics' CHAR_WIDTH (0.56):
 * the bands pack labels tighter, and this 0.52 keeps chip/wrap placement snug.
 * Changing it shifts band geometry — see the determinism note in AGENTS.md#non-negotiable-invariants.
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
      if (!collides()) continue;
      const originY = label.y,
        originX = label.x;
      let settled = false;
      outer: for (const dx of [0, -24, 24, -48, 48]) {
        for (const step of [0, 8, 14, 20, 28, 36, 44, 56, 70, 86]) {
          for (const dir of step === 0 ? [1] : [-1, 1]) {
            label.y = originY + dir * step;
            label.x = originX + dx;
            if (!collides()) {
              settled = true;
              break outer;
            }
          }
        }
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
          `<text x="${label.x + label.width / 2}" y="${label.y + edgeFontSize + 1 + index * (edgeFontSize + 3)}" font-size="${edgeFontSize}" text-anchor="middle" fill="${color}" font-style="italic" stroke="${palette.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">${esc(line)}</text>\n`,
      )
      .join("");
    const flow = flowById.get(label.flowId);
    const tech = techText(flow?.tech);
    if (tech && flow?.label) {
      svg += `<text x="${label.x + label.width / 2}" y="${label.y + edgeFontSize + 1 + lines.length * (edgeFontSize + 3)}" font-size="${annot.tech}" text-anchor="middle" fill="${palette.techText}" stroke="${palette.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">${esc(tech)}</text>\n`;
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

  const renderEdge = (edge: SceneEdge): string => {
    const flow = flowById.get(edge.id);
    const flowStyle = flow?.style;
    const color = flowColorOf(flow);
    const headColor = style.flowColor === "by-source" ? color : defaultEdgeColor;
    const dash = dashArray(flowStyle?.stroke?.style ?? style.flowStroke.style);
    const width = flowStyle?.stroke?.width ?? style.flowStroke.width;
    let svg = "";
    if (edge.pts.length) {
      svg += `<path d="${edgePath(edge.pts)}" fill="none" stroke="${escAttr(color)}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${markerName(headColor)})"/>\n`;
    }
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
  for (const edge of scene.edges) body += renderEdge(edge);

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
