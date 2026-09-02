/**
 * Stage 5: serializes a laid-out `Scene` to a deterministic SVG string. Resolves
 * per-element styling (theme → per-kind → inline), draws each node kind with its
 * own shape function, routes edges with crossing "hops", settles flow-label
 * positions to keep overlaps at zero, and appends the flows/objects/legend bands.
 * All text goes through `esc`/`escAttr`; output must stay byte-identical across
 * runs, so only the arithmetic allowed by AGENTS.md#non-negotiable-invariants is used here.
 */

import type { Model, StyleProps, Flow, Element } from "./models/ast.ts";
import type { View } from "./views.ts";
import { themeFor, themeFromSpec, flowPalette, isDarkTheme } from "./themes.ts";
import type { ThemeSpec } from "./themes.ts";
import { UI } from "./localization.ts";
import { esc, escAttr } from "./xml-escape.ts";
import {
  type Box,
  type TitleBox,
  boundsOf,
  boxesOverlap,
  boxGapSq,
  boxToPolylineSq,
} from "./geometry.ts";
import type { Scene, SceneNode, SceneEdge, SceneLabel } from "./scene-layout.ts";
import { compactVertical } from "./compact.ts";
import { labelsSeated } from "./edge-tidy.ts";
import { anchorFlowLabels } from "./label-anchor.ts";
import { titleBoxesOf } from "./route-detour.ts";
import { inspect } from "./readability.ts";
import { chipW, techText, wrapText, fontSizes, GLYPH_GUTTER, LOGO_GUTTER } from "./text-metrics.ts";
import { LOGOS } from "./logos.ts";

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

/** One decimal place — SVG coordinates stay short and byte-stable across runs. */
const round1 = (n: number) => Math.round(n * 10) / 10;

interface ElementStyleEntry {
  id: string;
  style: StyleProps | undefined;
  attrValue: string | undefined;
  logo: Element["logo"];
}

interface RenderResult {
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
    { id: element.id, style: element.style, attrValue: element.attr?.value, logo: element.logo },
    ...collectElementStyles(element.children),
  ]);
}

/**
 * How far a label may sit from its own flow. Squared, like everything else here.
 * 20px matches the sweep's `labelAdrift` gate: past it the label is further from
 * its flow than `MIN_ATTACH_GAP` puts the neighbouring one, so there is nothing
 * left to tell the reader which run it annotates.
 */
const ADRIFT_SQ = 20 * 20;
/** Within this a label reads as sitting on its run whatever else is nearby. */
const ATTACHED_SQ = 6 * 6;

/**
 * Undo any route repair that cost a label its run (§4d). `edge-tidy`'s repair
 * trades a lower-tier defect for a higher-tier fix but cannot see this cost: a
 * moved route collides with a *neighbouring* label, and the settler resolves
 * that by lifting whichever label it can — a decision that does not exist until
 * settling runs. So the repair records what it replaced, and the verdict is
 * taken here, where "is this label on its own run" first has an answer.
 */
function auditRouteRepairs(deps: {
  scene: Scene;
  labels: SceneLabel[];
  titles: TitleBox[];
  offOwnRun: (label: SceneLabel) => number;
  pierced: (label: SceneLabel) => boolean;
  stolen: (label: SceneLabel, own: number) => boolean;
  labelsSeated: (edge: SceneEdge) => boolean;
  /** Re-anchor and re-settle, the pair every state change here is measured after. */
  resettle: () => void;
}): void {
  const { scene, labels, titles, offOwnRun, pierced, stolen, labelsSeated, resettle } = deps;
  const repaired = scene.edges.filter((edge) => edge.repairedFrom);
  if (!repaired.length) return;

  /**
   * Every way a route change can damage a label, not one: counting only labels
   * off their run found labelAdrift 3 (must-be-zero), labelOrphan 0→17,
   * labelPierced 7→29 — more moved routes means more collisions, resolved by
   * pushing labels into every failure mode §4a/§4d names.
   *
   * Ranked, not totalled: a flat count once let a tier-1 label sliding off its
   * run veto a repair that cleared a tier-0 run through a container. Index 0 is
   * information destroyed (adrift, pierced, struck title); index 1 is
   * attribution broken (nearer a neighbour's run, or lifted off its own).
   */
  const labelHarm = (): [number, number] => {
    const harm: [number, number] = [0, 0];
    for (const label of labels) {
      const own = offOwnRun(label);
      if (own > ADRIFT_SQ) harm[0]++;
      if (pierced(label)) harm[0]++;
      if (titles.some((title) => boxesOverlap(title, label))) harm[0]++;
      if (stolen(label, own)) harm[1]++;
    }
    for (const edge of scene.edges) if (!labelsSeated(edge)) harm[1]++;
    return harm;
  };

  /** Every edge's solo profile — the runs' own cost in the current state. */
  const soloProfile = () =>
    inspect(scene, titles).local(new Set(scene.edges.map((edge) => edge.id)), new Map(), true);

  /**
   * Both halves of the damage, per tier.
   *
   * Weighing labels alone made the audit blind to the direction that matters:
   * the older route reverting restores has defects of its own, and label damage
   * alone once undid a flow that had stopped cutting through a layer, trading
   * two tier-0 defects for one. Both states are now measured on runs and labels
   * together.
   *
   * `soloOnly` keeps it affordable: every defect here is a route against a fixed
   * obstacle. The pairwise phase is the expensive half, and crossings are the
   * router's business, already weighed.
   */
  const stateHarm = (): number[] => {
    const tiers = [0, 0, 0, 0, 0];
    for (const tier of soloProfile().values()) tiers[tier]++;
    const [labels0, labels1] = labelHarm();
    tiers[0] += labels0;
    tiers[1] += labels1;
    return tiers;
  };

  /**
   * The breaches this audit may never trade for, by identity.
   *
   * `MUST_BE_ZERO` is a promise, not a budget — unlike the rest of tier 0, which
   * is ratchet debt the ladder trades. A count comparison cannot tell them
   * apart: it once let a repair clearing two struck titles ship a label 39px
   * adrift from its own flow.
   *
   * Only the invariants observable after settling: a label adrift, a run through
   * a leaf box, a slanted segment. `coincident` needs the pairwise phase
   * `stateHarm` skips; `overlaps` is the settler's own count.
   *
   * Identity only for these — applying it to all of tier 0 measured worse (19
   * regressions on a quarter corpus), since an all-or-nothing revert then
   * discards every other fix for one gained key.
   */
  const breaches = (): Set<string> => {
    const found = new Set<string>();
    labels.forEach((label, index) => {
      if (offOwnRun(label) > ADRIFT_SQ) found.add(`adrift:${index}`);
    });
    for (const [key, tier] of soloProfile())
      if (tier === 0 && (key.startsWith("leaf:") || key.startsWith("diag:"))) found.add(key);
    return found;
  };

  /** Lexicographic by tier: one fewer tier-0 defect beats any number of tier-4 ones. */
  const lessDamaged = (a: number[], b: number[]): boolean => {
    for (let tier = 0; tier < 5; tier++) if (a[tier] !== b[tier]) return a[tier] < b[tier];
    return false;
  };

  const withRepair = stateHarm();
  const breachesWith = breaches();
  const repairedRoutes = repaired.map((edge) => edge.pts);
  for (const edge of repaired) edge.pts = edge.repairedFrom!;
  resettle();
  const withoutRepair = stateHarm();
  const breachesWithout = breaches();
  const breaksAPromise = [...breachesWith].some((key) => !breachesWithout.has(key));
  // Two finished drawings, judged the same way; the less damaged one ships. Last
  // point where geometry and labels have both settled, so the only place either
  // state can be measured for real. Whole-drawing on purpose: the lifted label
  // belongs to a *neighbour* of the moved flow, so "did this edge keep its own
  // label" always answered yes and reverted nothing.
  //
  // Ties keep the repair — the router proposes only ladder-positive moves, so an
  // equally-damaged repair is one whose gain this audit cannot see after
  // settling. An invariant the repair breaks and the revert does not is never
  // payable; everything below that is a trade.
  if (!breaksAPromise && !lessDamaged(withoutRepair, withRepair)) {
    repaired.forEach((edge, index) => {
      edge.pts = repairedRoutes[index];
    });
    resettle();
  }
  for (const edge of repaired) edge.repairedFrom = undefined;
}

/** A seat the settler may try, as the label's top-left corner. */
interface Seat {
  x: number;
  y: number;
}

/** The two judgements and the two seat ladders every escape round consults. */
interface Settler {
  collides: (label: SceneLabel) => boolean;
  attributableHere: (label: SceneLabel) => boolean;
  ownRunMidpoints: (label: SceneLabel) => Seat[];
  alongOwnRun: (label: SceneLabel) => Seat[];
}

/**
 * Round 0: stay on the line. Every seat here is *on* the run — midpoints and
 * slides along it — so §4d survives the escape. Only a label with nowhere to go
 * along its own flow reaches the perpendicular rounds.
 *
 * Two sweeps over the same seats: the first also wants attribution, the second
 * takes any overlap-free seat, pierced or not. Overlapping is unreadable,
 * off-the-line breaks §4d, pierced is a ratchet — so a pierced seat *on* the run
 * beats a clean one beside it.
 */
function settleOnOwnRun(s: Settler, label: SceneLabel): boolean {
  const onLineSeats = [...s.ownRunMidpoints(label), ...s.alongOwnRun(label)];
  for (const wantAttributable of [true, false])
    for (const seat of onLineSeats) {
      label.x = seat.x;
      label.y = seat.y;
      if (s.collides(label)) continue;
      if (wantAttributable && !s.attributableHere(label)) continue;
      return true;
    }
  return false;
}

/**
 * The perpendicular ladder, walked only once every on-line slide has failed.
 *
 * The attributable round slides further than the relaxed one: along its own run
 * a label keeps `own` at 0 whatever the distance, so a long slide is how a label
 * wider than the gap between two crossing runs dodges the piercing one without
 * leaving its flow. The relaxed round keeps the short ladder — unguarded long
 * throws land in a stranger's corridor.
 */
function settleOffOwnRun(s: Settler, label: SceneLabel, here: Seat): boolean {
  for (const attributable of [true, false]) {
    const origins = attributable ? [here, ...s.ownRunMidpoints(label)] : [here];
    const slides = attributable ? [0, -24, 24, -48, 48, -72, 72, -96, 96] : [0, -24, 24, -48, 48];
    for (const origin of origins)
      for (const dx of slides)
        for (const step of [0, 8, 14, 20, 28, 36, 44, 56, 70, 86])
          for (const dir of step === 0 ? [1] : [-1, 1]) {
            label.y = origin.y + dir * step;
            label.x = origin.x + dx;
            if (s.collides(label)) continue;
            if (attributable && !s.attributableHere(label)) continue;
            return true;
          }
  }
  return false;
}

/**
 * Move one label out of trouble, or leave it exactly where it was.
 *
 * A label is moved for either reason. Overlap alone was the old trigger, and it
 * misses the whole `labelPierced` population: a label centred on its own run
 * overlaps nothing at all while another flow is drawn through the middle of its
 * text.
 *
 * Two rounds. The first refuses any escape that detaches the label from its flow
 * or parks it nearer another, walking it to a different run of its own flow
 * instead; the second drops that condition. Not a preference: an overlapping
 * label is unreadable, an ambiguous one merely misleading, so zero overlaps
 * outranks attribution. Attribution is a ratchet exactly because it has to yield
 * here.
 */
function settleOneLabel(s: Settler, label: SceneLabel): void {
  if (!s.collides(label) && s.attributableHere(label)) return;
  const origin: Seat = { x: label.x, y: label.y };
  if (settleOnOwnRun(s, label)) return;
  if (settleOffOwnRun(s, label, origin)) return;
  label.x = origin.x;
  label.y = origin.y;
}

/**
 * The corner glyphs that tell the infrastructure kinds apart at a glance.
 *
 * Each is stroke-only, in the kind's own stroke colour, drawn inside one 18x16
 * box so the four read as a family. A pen receives that box already placed and
 * scaled: `x`/`y` map box-relative coordinates, `r` scales a length, and
 * `line` is the shared stroke attributes. `GLYPH_GUTTER` (text-metrics) is the
 * width the layout reserves for the box, so no label can run underneath it.
 */
const GLYPH_BOX = { width: 18, height: 16, left: 6, top: 7 };

interface GlyphPen {
  /** Box-relative x, in output coordinates. */
  x: (v: number) => number;
  /** Box-relative y, in output coordinates. */
  y: (v: number) => number;
  /** A box-relative length, scaled. */
  r: (v: number) => number;
  /** `stroke`/`stroke-width`/`fill` attributes shared by every stroke in the family. */
  line: string;
  /** The glyph's colour, for the one filled dot in the set. */
  stroke: string;
}

const GLYPHS: Record<string, (pen: GlyphPen) => string> = {
  // Padlock: authentication is a check something must pass.
  auth: ({ x, y, r, line, stroke }) =>
    `<rect x="${x(3)}" y="${y(7)}" width="${r(12)}" height="${r(9)}" rx="${r(2)}" ${line}/>` +
    `<path d="M ${x(6)} ${y(7)} v ${-r(3)} a ${r(3)} ${r(3)} 0 0 1 ${r(6)} 0 v ${r(3)}" ${line}/>` +
    `<circle cx="${x(9)}" cy="${y(11)}" r="${r(1.5)}" fill="${stroke}"/>`,
  // Two posts with traffic passing between them: a gateway routes, it does not block.
  gateway: ({ x, y, r, line }) =>
    `<path d="M ${x(2)} ${y(1)} V ${y(15)} M ${x(16)} ${y(1)} V ${y(15)}" ${line}/>` +
    `<path d="M ${x(4)} ${y(8)} H ${x(14)}" ${line}/>` +
    `<path d="M ${x(11)} ${y(5)} l ${r(3)} ${r(3)} l ${-r(3)} ${r(3)}" ${line}/>`,
  // ID badge: an identity provider issues who-you-are, it does not check it.
  idp: ({ x, y, r, line }) =>
    `<rect x="${x(3)}" y="${y(2)}" width="${r(12)}" height="${r(13)}" rx="${r(2)}" ${line}/>` +
    `<path d="M ${x(7)} ${y(2)} H ${x(11)}" ${line}/>` +
    `<circle cx="${x(9)}" cy="${y(7)}" r="${r(2)}" ${line}/>` +
    `<path d="M ${x(5)} ${y(13)} q ${r(4)} ${-r(4)} ${r(8)} 0" ${line}/>`,
  // Brick wall: a firewall is a barrier, and no other kind reads as one.
  firewall: ({ x, y, r, line }) =>
    `<rect x="${x(2)}" y="${y(2)}" width="${r(14)}" height="${r(12)}" rx="${r(1)}" ${line}/>` +
    `<path d="M ${x(2)} ${y(6)} H ${x(16)} M ${x(2)} ${y(10)} H ${x(16)}" ${line}/>` +
    `<path d="M ${x(9)} ${y(2)} V ${y(6)} M ${x(6)} ${y(6)} V ${y(10)} M ${x(12)} ${y(6)} V ${y(10)} M ${x(9)} ${y(10)} V ${y(14)}" ${line}/>`,
};

/**
 * One glyph with its box's top-left at `box.x`/`box.y`, scaled by `box.scale`
 * — the legend key draws the same glyphs smaller. Empty for a kind with none.
 */
function glyphSvg(
  kind: string,
  stroke: string,
  box: { x: number; y: number; scale?: number },
): string {
  const glyph = GLYPHS[kind];
  if (!glyph) return "";
  const { x, y, scale = 1 } = box;
  const width = round1(1.3 * scale);
  return glyph({
    x: (v) => round1(x + v * scale),
    y: (v) => round1(y + v * scale),
    r: (v) => round1(v * scale),
    line: `fill="none" stroke="${stroke}" stroke-width="${width}"`,
    stroke,
  });
}

/**
 * A tech-stack logo sits in the node's top-right corner, mirroring the kind
 * glyph in the top-left. simple-icons paths are authored in a `0 0 24 24` box
 * and carry no colour of their own, so one scale factor places any of them and
 * the node's own stroke colour paints it — a logo never introduces a hue the
 * theme did not choose.
 */
const LOGO_BOX = { size: 18, right: 7, top: 6 };

/**
 * The logo for `node`, or `""` when it has none. A file-sourced logo renders
 * only when the caller resolved it: the core never reads from disk, so `cli.ts`
 * hands the inlined data URI down and an unresolved one degrades to nothing
 * rather than to a broken reference.
 */
function logoSvg(mark: {
  logo: Element["logo"];
  resolved: Map<string, string> | undefined;
  node: SceneNode;
  stroke: string;
  /** Shapes with a curved corner push the mark clear of it. */
  inset?: { right?: number; top?: number };
}): string {
  const { logo, resolved, node, stroke, inset = {} } = mark;
  if (!logo) return "";
  const x = round1(node.x + node.width - (inset.right ?? LOGO_BOX.right) - LOGO_BOX.size);
  const y = round1(node.y + (inset.top ?? LOGO_BOX.top));

  if (logo.source === "file") {
    const href = resolved?.get(node.id);
    if (!href) return "";
    return `<image x="${x}" y="${y}" width="${LOGO_BOX.size}" height="${LOGO_BOX.size}" href="${escAttr(href)}" preserveAspectRatio="xMidYMid meet"/>\n`;
  }

  // Own entries only — an inherited `Object.prototype` member is not a logo.
  const builtin = Object.hasOwn(LOGOS, logo.value) ? LOGOS[logo.value] : undefined;
  if (!builtin) return "";
  // 24 is the authored viewBox edge. Rounded to four places through integer
  // maths so the attribute is a short, stable decimal rather than the raw
  // binary quotient (§2: no drifting floats in the output path).
  const scale = Math.round((LOGO_BOX.size / 24) * 1e4) / 1e4;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${stroke}"><title>${esc(builtin.title)}</title><path d="${builtin.d}"/></g>\n`;
}

/** Everything the node shapes paint with: theme colours, fonts and per-element style. */
interface NodePaint {
  palette: ReturnType<typeof themeFor>["palette"];
  style: Model["style"];
  annot: { tag: number };
  nodeFontSize: number;
  containerFontSize: number;
  resolveStyle: (kind: string, id: string) => StyleProps;
  elementAttr: Map<string, string | undefined>;
  elementLogo: Map<string, Element["logo"]>;
  /** `id` → inlined `data:` URI, filled in by whoever could read the files. */
  resolvedLogos: Map<string, string> | undefined;
}

/** The text-placement maths every node shape shares: line stacking, vertical centring, glyph gutter. */
function createNodeLabelHelpers(nodeFontSize: number) {
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
  /**
   * Where a glyph node's label is centred: in the width left over once the
   * glyph gutter is taken off the left, not in the node as a whole. The layout
   * reserved that same gutter (`GLYPH_GUTTER`), so the label cannot reach the
   * glyph however long it is.
   */
  const glyphLabelCenterX = (node: SceneNode) =>
    node.x + GLYPH_GUTTER + (node.width - GLYPH_GUTTER) / 2;
  /**
   * The same idea for a logo, which sits on the right: the label centres in
   * what is left once `LOGO_GUTTER` is taken off that side. `hasLogo` is false
   * for most nodes, and then this is just the node's own centre.
   */
  const logoLabelCenterX = (node: SceneNode, hasLogo: boolean) =>
    node.x + (node.width - (hasLogo ? LOGO_GUTTER : 0)) / 2;
  return { centeredNodeLabel, centerLinesY, glyphLabelCenterX, logoLabelCenterX };
}

/** One function per node kind, plus the container frame. */
function createNodeRenderers(paint: NodePaint) {
  const {
    palette,
    style,
    annot,
    nodeFontSize,
    containerFontSize,
    resolveStyle,
    elementAttr,
    elementLogo,
    resolvedLogos,
  } = paint;
  /** The logo mark for a node, already placed and coloured. `""` when it has none. */
  const logoFor = (node: SceneNode, stroke: string, inset?: { right?: number; top?: number }) =>
    logoSvg({ logo: elementLogo.get(node.id), resolved: resolvedLogos, node, stroke, inset });
  const { centeredNodeLabel, centerLinesY, glyphLabelCenterX, logoLabelCenterX } =
    createNodeLabelHelpers(nodeFontSize);

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
    svg += logoFor(node, stroke);
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
    // A cylinder is only full width between its caps (`ry` down to `height - ry`);
    // above and below that the arcs curve away from the corner. Centring the
    // mark in that band keeps it on paint at any node height, where
    // top-aligning it below the cap overflows the bottom arc on a short node.
    const logo = logoFor(node, stroke, {
      top: ry + (node.height - 2 * ry - LOGO_BOX.size) / 2,
    });
    return (
      body +
      logo +
      centeredNodeLabel(
        lines,
        logoLabelCenterX(node, logo !== ""),
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
    const logo = logoFor(node, stroke, { right: LOGO_BOX.right + rx });
    return (
      body +
      logo +
      centeredNodeLabel(
        lines,
        node.x + rx + (node.width - rx - (logo === "" ? 0 : LOGO_GUTTER)) / 2,
        centerLinesY(node.y, node.height, lines.length),
        text,
      )
    );
  };

  /**
   * A box with its kind's glyph in the top-left corner. The label is centred in
   * the width left over, which the layout reserved as `GLYPH_GUTTER`.
   */
  const renderGlyphBox = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const dash = dashArray(nodeStyle.stroke?.style);
    const body =
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${nodeStyle.stroke?.width ?? 1.3}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n` +
      glyphSvg(node.kind, stroke, {
        x: node.x + GLYPH_BOX.left,
        y: node.y + GLYPH_BOX.top,
      }) +
      "\n";
    return (
      body +
      centeredNodeLabel(
        lines,
        glyphLabelCenterX(node),
        centerLinesY(node.y, node.height, lines.length),
        text,
      )
    );
  };

  const renderPlainBox = (node: SceneNode, nodeStyle: StyleProps, lines: string[]): string => {
    const fill = escAttr(nodeStyle.fill ?? palette.nodeFill),
      stroke = escAttr(nodeStyle.stroke?.color ?? palette.nodeStroke),
      text = escAttr(nodeStyle.text ?? palette.nodeText);
    const dash = dashArray(nodeStyle.stroke?.style);
    const logo = logoFor(node, stroke);
    const body = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${nodeStyle.stroke?.width ?? 1.3}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n`;
    return (
      body +
      logo +
      centeredNodeLabel(
        lines,
        logoLabelCenterX(node, logo !== ""),
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
      default:
        return GLYPHS[node.kind]
          ? renderGlyphBox(node, nodeStyle, lines)
          : renderPlainBox(node, nodeStyle, lines);
    }
  };

  return { renderContainerNode, renderLeafNode };
}

/** The label model: where every label sits, and the pass that settles them. */
interface LabelSettler {
  labels: SceneLabel[];
  titleBands: TitleBox[];
  countLabelOverlaps: () => number;
  offOwnRun: (label: SceneLabel) => number;
  stolen: (label: SceneLabel, own: number) => boolean;
  pierced: (label: SceneLabel) => boolean;
  settleLabelPositions: () => void;
}

function createLabelSettler(deps: {
  scene: Scene;
  model: Model;
  flowById: Map<string, Flow>;
  style: Model["style"];
}): LabelSettler {
  const { scene, model, flowById, style } = deps;

  const nodeBoxes: Box[] = scene.nodes
    .filter((node) => !node.container)
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
  const labels: SceneLabel[] = scene.edges.flatMap((edge) => edge.labels);

  const countLabelOverlaps = (): number => {
    let count = 0;
    for (let index = 0; index < labels.length; index++) {
      for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex++)
        if (boxesOverlap(labels[index], labels[otherIndex])) count++;
      for (const node of nodeBoxes) if (boxesOverlap(labels[index], node)) count++;
    }
    return count;
  };

  const ownRun = new Map<SceneLabel, SceneEdge>();
  for (const edge of scene.edges) for (const label of edge.labels) ownRun.set(label, edge);
  /**
   * Bounds are derived from `edge.pts`, which `auditRouteRepairs` swaps between
   * settling passes. Rebuilt on each settle so the cheap prefilter in `stolen`
   * and `pierced` never disagrees with the polyline test it guards — a stale
   * box rejects routes that now pierce, and the audit then compares the two
   * candidate drawings on partly stale data.
   */
  let routes: { edge: SceneEdge; bounds: Box }[] = [];
  const refreshRoutes = () => {
    routes = scene.edges
      .filter((edge) => edge.pts.length >= 2)
      .map((edge) => ({ edge, bounds: boundsOf(edge.pts) }));
  };
  refreshRoutes();

  const offOwnRun = (label: SceneLabel) => {
    const edge = ownRun.get(label);
    return edge && edge.pts.length >= 2 ? boxToPolylineSq(label, edge.pts) : 0;
  };
  /**
   * Is another flow's run closer to this label than its own? Then the reader
   * attributes it to the wrong flow.
   *
   * A label within `ATTACHED_SQ` of its own run is exempt — it is visibly on
   * that run, and a neighbour grazing 1px nearer is two flows running close
   * together, which `nearParallel` already counts.
   */
  const stolen = (label: SceneLabel, own: number) => {
    if (own <= ATTACHED_SQ) return false;
    const mine = ownRun.get(label);
    return routes.some(
      (route) =>
        route.edge !== mine &&
        boxGapSq(label, route.bounds) < own &&
        boxToPolylineSq(label, route.edge.pts) < own,
    );
  };

  /**
   * Is another flow's run drawn through the label box? Neither rule above sees
   * this: a label on its own run has `own` of 0, so it passes both while a second
   * flow crosses the words.
   *
   * Not measured at 0 — the halo keeps a line grazing the box edge legible.
   *
   * Deliberately wider than the gate; INVARIANTS §3 requires that stated next to
   * both. `labelPierced` + `labelStraddled` omit one case this counts: an on-line
   * label crossed transversally. This is a *preference* deciding whether to look
   * for a better seat, not a charge — narrowing it to the gate's union would stop
   * the settler looking, and the relaxed round below makes the strictness free.
   */
  const PIERCE_SQ = 1;
  const pierced = (label: SceneLabel) => {
    const mine = ownRun.get(label);
    return routes.some(
      (route) =>
        route.edge !== mine &&
        boxGapSq(label, route.bounds) <= PIERCE_SQ &&
        boxToPolylineSq(label, route.edge.pts) <= PIERCE_SQ,
    );
  };

  /**
   * Where the label would sit centred on each run of its own flow, in segment
   * order. A label crowded off its preferred run can usually sit elsewhere on
   * the same route — still clearly attached — which beats being flung into open
   * space to escape a collision.
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
   * Seats along the label's own run, both directions from where it sits. The
   * escape that keeps §4d: sliding *along* a run never leaves it, so a crowded
   * label can travel a long way and stay on its own line. The perpendicular
   * ladder below is what takes it off, and only once every slide has failed.
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

  /** Container names, which carry no halo and so may not be sat on (§4e). */
  const titleBands = titleBoxesOf(scene, model);

  const settler: Settler = {
    /**
     * Somewhere this label may not sit at all.
     *
     * Container names sit with the node boxes, not the soft preferences the
     * escape ladder trades, because §4e is tier 0 while every one of those is
     * tier 1: a name drawn through is destroyed information, a label beside its
     * line is still readable. `label-anchor` ranks these the other way — that
     * predates the ladder, which now decides.
     *
     * Surfaced once `laneBeyond` started clearing runs (§4j): labels that never
     * needed to escape began escaping, and five `slide` drawings put one on a
     * container name on the way out.
     */
    collides: (label) =>
      labels.some((other) => other !== label && boxesOverlap(other, label)) ||
      nodeBoxes.some((node) => boxesOverlap(node, label)) ||
      titleBands.some((band) => boxesOverlap(band, label)),
    /** Can the reader tell, from this position alone, which flow is speaking? */
    attributableHere: (label) => {
      const own = offOwnRun(label);
      return own <= ADRIFT_SQ && !stolen(label, own) && !pierced(label);
    },
    ownRunMidpoints,
    alongOwnRun,
  };

  const settleLabelPositions = () => {
    refreshRoutes();
    for (const label of labels) {
      const requested = flowById.get(label.flowId)?.style?.label ?? style.flowLabel;
      if (requested === "above") label.y -= label.height / 2 + 5;
      else if (requested === "below") label.y += label.height / 2 + 5;
    }
    for (const label of labels) settleOneLabel(settler, label);
  };

  return {
    labels,
    titleBands,
    countLabelOverlaps,
    offOwnRun,
    stolen,
    pierced,
    settleLabelPositions,
  };
}

/** Font sizes and chip metrics for annotations, rounded once for byte-stability. */
interface Annot {
  tech: number;
  chip: number;
  tag: number;
  band: number;
  bandTitle: number;
  chipH: number;
  scale: number;
  chipRectH: number;
  chipTextDy: number;
}

/** Everything the bands under the drawing need: theme, locale and flow colours. */
interface BandPaint {
  scene: Scene;
  model: Model;
  view: View;
  style: Model["style"];
  palette: ReturnType<typeof themeFor>["palette"];
  annot: Annot;
  ui: (typeof UI)[keyof typeof UI];
  legendNames: View["legendNames"];
  legendFlowLabel: View["legendFlowLabel"];
  scaled: (n: number) => number;
  objectName: Map<string, string>;
  resolveStyle: (kind: string, id: string) => StyleProps;
  defaultEdgeColor: string;
  markerName: (color: string) => string;
  numbered: boolean;
}

/**
 * The bands appended under the drawing: the numbered flow list, the carried
 * business objects, and the legend. They share a running `bandY` cursor, so they
 * are built together and report where the drawing now ends.
 */
function createBandRenderers(paint: BandPaint) {
  const {
    scene,
    model,
    view,
    style,
    palette,
    annot,
    ui,
    legendNames,
    legendFlowLabel,
    scaled,
    objectName,
    resolveStyle,
    defaultEdgeColor,
    markerName,
    numbered,
  } = paint;

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
        (sum, objectRef) =>
          sum + chipW(objectName.get(objectRef.id) ?? objectRef.id, annot.scale) + 4,
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
        const stroke = nodeStyle.stroke?.color ?? palette.nodeStroke;
        bandsSvg += `<rect x="${lx}" y="${bandY + 2}" width="${scaled(26)}" height="${scaled(14)}" rx="3" fill="${nodeStyle.fill ?? palette.nodeFill}" stroke="${escAttr(stroke)}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n`;
        // A kind drawn with a glyph shows that glyph in its key, from the same
        // function the node renderer calls — key and node cannot drift apart.
        // The glyph is scaled to sit inside the swatch with a 2px margin.
        const glyphScale = (scaled(14) - scaled(4)) / GLYPH_BOX.height;
        bandsSvg += glyphSvg(kind, escAttr(stroke), {
          x: lx + (scaled(26) - GLYPH_BOX.width * glyphScale) / 2,
          y: bandY + 2 + (scaled(14) - GLYPH_BOX.height * glyphScale) / 2,
          scale: glyphScale,
        });
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

  return {
    renderFlowsBand,
    renderObjectsBand,
    renderLegendBand,
    bandsSvg: () => bandsSvg,
    bandY: () => bandY,
  };
}

/** Everything the edge paths and their labels are drawn with. */
interface EdgePaint {
  scene: Scene;
  style: Model["style"];
  palette: ReturnType<typeof themeFor>["palette"];
  annot: Annot;
  edgeFontSize: number;
  scaled: (n: number) => number;
  flowById: Map<string, Flow>;
  objectName: Map<string, string>;
  flowColorOf: (flow?: Flow) => string;
  defaultEdgeColor: string;
  markerName: (color: string) => string;
  numbered: boolean;
}

/** The flow lines and their labels — hops, halos, tech annotations and chips. */
function createEdgePainter(paint: EdgePaint) {
  const {
    scene,
    style,
    palette,
    annot,
    edgeFontSize,
    scaled,
    flowById,
    objectName,
    flowColorOf,
    defaultEdgeColor,
    markerName,
    numbered,
  } = paint;

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
    const chips = (flow?.objects ?? []).map(
      (objectRef) => objectName.get(objectRef.id) ?? objectRef.id,
    );
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
   * Lines and labels are emitted in two passes, not one per edge. A label sits
   * *on* its run (§4d) and is readable only because its halo masks the line
   * behind it, which works only for lines already drawn. Interleaved, the halo
   * hid its own flow and nothing else, so every edge drawn afterwards struck
   * through the words.
   */
  const renderEdgePath = (edge: SceneEdge): string => {
    if (!edge.pts.length) return "";
    const flow = flowById.get(edge.id);
    const flowStyle = flow?.style;
    const color = flowColorOf(flow);
    const headColor = style.flowColor === "by-source" ? color : defaultEdgeColor;
    // Most specific wins, as everywhere else in the style model: an inline
    // `{ stroke: dashed }` overrides the arrow glyph, which overrides the
    // diagram-level `flow-stroke`.
    const dash = dashArray(flowStyle?.stroke?.style ?? flow?.lineStyle ?? style.flowStroke.style);
    const width = flowStyle?.stroke?.width ?? style.flowStroke.width;
    return `<path d="${edgePath(edge.pts)}" fill="none" stroke="${escAttr(color)}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${markerName(headColor)})"/>\n`;
  };

  const renderEdgeLabels = (edge: SceneEdge): string => {
    if (!edge.pts.length) return "";
    const flowStyle = flowById.get(edge.id)?.style;
    let svg = "";
    for (const label of edge.labels) {
      svg += numbered ? renderNumberedBadge(label) : renderTextLabel(label, flowStyle);
    }
    return svg;
  };

  return { renderEdgePath, renderEdgeLabels };
}

/** Renders the final SVG diagram from the model, view, and positioned scene geometry. */
/**
 * What the caller can hand the renderer that the renderer cannot obtain itself.
 * Today that is only the logo files: reading them is filesystem work, and the
 * core stays environment-neutral, so `cli.ts` resolves them and passes the
 * inlined results down. An embedder that supplies nothing still renders every
 * built-in logo — only file-sourced ones need this.
 */
export interface RenderOptions {
  /** Element id → inlined `data:` URI for its `logo: "<path>"`. */
  logos?: Map<string, string>;
  /**
   * A palette to render with, instead of resolving `style.theme` by name.
   *
   * Themes are otherwise looked up in a module-level registry, which a custom
   * one has to be added to first. That is fine for the CLI — one render, then
   * the process exits — but an embedder rendering for many callers would grow
   * that registry on every call and risk two callers colliding on a name. A
   * spec passed here is used and forgotten.
   */
  theme?: ThemeSpec;
}

/**
 * Wraps the rendered body in the SVG document: one arrow marker per edge
 * colour, the canvas rect, and a viewBox tall enough for the bands drawn
 * underneath the diagram.
 */
function svgDocument(args: {
  width: number;
  height: number;
  fontFamily: string;
  background: string;
  arrowMarkers: Map<string, string>;
  markerSize: number;
  body: string;
  bandsSvg: string;
}): string {
  const { width, height, fontFamily, background, arrowMarkers, markerSize, body, bandsSvg } = args;
  const markers = [...arrowMarkers]
    .map(
      ([color, markerName]) =>
        `<marker id="${markerName}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${markerSize}" markerHeight="${markerSize}" orient="auto-start-reverse">\n<path d="M0,0 L10,5 L0,10 z" fill="${escAttr(color)}"/></marker>`,
    )
    .join("\n");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${escAttr(fontFamily)},Arial,sans-serif">
<defs>${markers}</defs>
<rect width="${width}" height="${height}" fill="${escAttr(background)}"/>\n` +
    body +
    bandsSvg +
    "</svg>\n"
  );
}

export function render(
  model: Model,
  view: View,
  scene: Scene,
  options?: RenderOptions,
): RenderResult {
  const style = model.style;
  const fonts = fontSizes(style.font.size);
  const { edge: edgeFontSize, node: nodeFontSize, cont: containerFontSize } = fonts;
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
  const {
    palette,
    kinds: kindDefaults,
    levels: levelDefaults,
  } = options?.theme ? themeFromSpec(options.theme, view) : themeFor(style.theme, view);
  // A spec carries its own darkness; a name is looked up. Nothing about the
  // colours themselves says which flow palette to use.
  const onDarkGround = options?.theme ? options.theme.dark === true : isDarkTheme(style.theme);
  const defaultEdgeColor = style.flowStrokeColorSet
    ? style.flowStroke.color
    : (style.accent ?? palette.edge);

  const sourceHue =
    style.flowColor === "by-source"
      ? assignSourceHues(model, flowPalette[onDarkGround ? "dark" : "light"])
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
  const elementLogo = new Map<string, Element["logo"]>();
  for (const entry of collectElementStyles(model.elements)) {
    elementStyle.set(entry.id, entry.style);
    elementAttr.set(entry.id, entry.attrValue);
    if (entry.logo) elementLogo.set(entry.id, entry.logo);
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

  const {
    labels,
    titleBands,
    countLabelOverlaps,
    offOwnRun,
    stolen,
    pierced,
    settleLabelPositions,
  } = createLabelSettler({ scene, model, flowById, style });

  const overlapsBefore = countLabelOverlaps();
  settleLabelPositions();
  auditRouteRepairs({
    scene,
    labels,
    titles: titleBands,
    offOwnRun,
    pierced,
    stolen,
    labelsSeated,
    resettle: () => {
      anchorFlowLabels(scene, titleBands);
      settleLabelPositions();
    },
  });
  const overlapsAfter = countLabelOverlaps();
  // Settling can move a label off a band nothing else pinned, stranding dead
  // height the layout-stage compact ran too early to see. Safe on settled
  // geometry: band removal is monotone, keeps ≥14px between pinned extents and
  // reorders nothing, so it cannot create an overlap, a pierce or a collision.
  // No-op when settling stranded nothing, the common case.
  compactVertical(scene);

  const { renderContainerNode, renderLeafNode } = createNodeRenderers({
    palette,
    style,
    annot,
    nodeFontSize,
    containerFontSize,
    resolveStyle,
    elementAttr,
    elementLogo,
    resolvedLogos: options?.logos,
  });

  const { renderEdgePath, renderEdgeLabels } = createEdgePainter({
    scene,
    style,
    palette,
    annot,
    edgeFontSize,
    scaled,
    flowById,
    objectName,
    flowColorOf,
    defaultEdgeColor,
    markerName,
    numbered,
  });

  let body = "";
  for (const node of scene.nodes) if (node.container) body += renderContainerNode(node);
  for (const node of scene.nodes) if (!node.container) body += renderLeafNode(node);
  for (const edge of scene.edges) body += renderEdgePath(edge);
  for (const edge of scene.edges) body += renderEdgeLabels(edge);

  const bands = createBandRenderers({
    scene,
    model,
    view,
    style,
    palette,
    annot,
    ui,
    legendNames,
    legendFlowLabel,
    scaled,
    objectName,
    resolveStyle,
    defaultEdgeColor,
    markerName,
    numbered,
  });
  if (numbered && model.flows.length) bands.renderFlowsBand();
  if (model.businessObjects.length) bands.renderObjectsBand();
  if (style.legend === "auto") bands.renderLegendBand();
  const bandsSvg = bands.bandsSvg();
  const bandY = bands.bandY();

  const viewHeight = scene.height;
  if (arrowMarkers.size === 0) markerName(defaultEdgeColor);
  const svg = svgDocument({
    width: scene.width,
    height: bandY > viewHeight ? bandY + 14 : viewHeight,
    fontFamily: style.font.family,
    background: style.background ?? palette.background,
    arrowMarkers,
    markerSize: style.arrows === "large" ? round1(11 * fonts.scale) : 7,
    body,
    bandsSvg,
  });
  return { svg, overlapsBefore, overlapsAfter };
}
