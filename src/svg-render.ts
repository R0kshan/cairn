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
import { LINE_STYLES } from "./views.ts";
import type { LineStyle } from "./views.ts";
import { themeFor, themeFromSpec, flowPalette, isDarkTheme } from "./themes.ts";
import type { ThemeSpec } from "./themes.ts";
import { UI } from "./localization.ts";
import { esc, escAttr } from "./xml-escape.ts";
import { type TitleBox, boxesOverlap } from "./geometry.ts";
import type { Scene, SceneNode, SceneEdge, SceneLabel } from "./scene-layout.ts";
import { compactVertical, fitCanvas } from "./compact.ts";
import { airOutContainers } from "./scene-layout.ts";
import { labelsSeated } from "./edge-tidy.ts";
import { anchorFlowLabels } from "./label-anchor.ts";
import { createLabelSettler, ADRIFT_SQ } from "./label-settle.ts";
import { segmentsCross } from "./edge-tidy.ts";
import { inspect } from "./readability.ts";
import { chipW, techText, wrapText, fontSizes, GLYPH_GUTTER, LOGO_GUTTER } from "./text-metrics.ts";
import { logoAttributionComment } from "./logo-attribution.ts";
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

/** Where band content sits when it shares its row with the band's title. */
const BAND_CONTENT_X = 150;
/**
 * Narrowest run of text worth laying beside a band title. Below it the title
 * takes a row of its own and the content starts at the left margin instead: a
 * legend beside the title on a 198px-wide drawing has 28px to write in, which
 * wraps every key to one word per line.
 */
const MIN_BAND_TEXT = 200;
/** Right margin every band writes up to. */
const bandRightMargin = (scene: Scene) => scene.width - 20;

/**
 * A band's text is clipped by the frame, never reflowed by it — the bands grow
 * the drawing's height, never its width (`svgDocument`). So everything a band
 * writes is wrapped to the room between where it starts and the right margin.
 * On a drawing narrower than its own legend that is the difference between a key
 * that reads and a key that ends mid-word.
 */
function bandLines(text: string, from: number, right: number, fontSize: number): string[] {
  const chars = Math.floor((right - from) / (fontSize * RENDER_CHAR_WIDTH));
  return bandWrap(text, Math.max(8, chars));
}

/**
 * `wrapText` breaks between words and leaves a word longer than the row intact,
 * which is the right call for a node label — the box is sized around it. A band
 * has no such recourse: its width is the drawing's, so a URL or a long
 * identifier in a `legend note` or an object description would run off the edge
 * and be clipped. Here the word is broken mid-token instead, which at least
 * leaves all of it on the page. Lines that already fit are untouched.
 */
function bandWrap(text: string, maxChars: number): string[] {
  return wrapText(text, maxChars)
    .split("\n")
    .flatMap((line) => {
      if (line.length <= maxChars) return [line];
      const parts: string[] = [];
      for (let index = 0; index < line.length; index += maxChars)
        parts.push(line.slice(index, index + maxChars));
      return parts;
    });
}

const dashArray = (lineStyle?: string) =>
  lineStyle === "dashed" ? "5 3" : lineStyle === "dotted" ? "2 2.5" : undefined;

/**
 * Which line style a flow is actually drawn with. Most specific wins, as
 * everywhere else in the style model: an inline `{ stroke: dashed }` overrides
 * the arrow glyph, which overrides the diagram-level `flow-stroke`. Shared with
 * the legend so it keys the styles the drawing really carries — a key for a
 * style no edge uses is worse than no key at all.
 */
const lineStyleOf = (flow: Flow | undefined, style: Model["style"]) =>
  flow?.style?.stroke?.style ?? flow?.lineStyle ?? style.flowStroke.style;

/** One decimal place — SVG coordinates stay short and byte-stable across runs. */
const round1 = (n: number) => Math.round(n * 10) / 10;

interface ElementStyleEntry {
  id: string;
  style: StyleProps | undefined;
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

/** Flattened per-element style entries for `elements` and all their descendants, pre-order. */
function collectElementStyles(elements: Model["elements"]): ElementStyleEntry[] {
  return elements.flatMap((element) => [
    { id: element.id, style: element.style, logo: element.logo },
    ...collectElementStyles(element.children),
  ]);
}

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
  /**
   * Crossings the repaired flows make, counted against every other route.
   *
   * The one pairwise defect this audit cannot skip. "Crossings are the router's
   * business, already weighed" holds for the *repair* — the router chose it —
   * and not at all for the revert, which restores a route the router rejected
   * and nothing has weighed since. On `small-slide` the layout had already
   * routed `SECRETARY -> SCHEDULER` out of the secretary's south face and along
   * the bottom, clear of `SCHEDULER -> PATIENT` coming back the other way; the
   * audit then reverted it to the older route straight through that flow, and
   * scored the trade as free because it never looked.
   *
   * Affordable because only the repaired edges move: every other route is fixed,
   * so their crossings with each other cannot change and need not be counted.
   * That is a handful of edges against the rest, not the full pairwise sweep the
   * comment above rules out.
   */
  const crossHarm = (): number => {
    // Rank, so a pair of *repaired* edges — visited once from each side — is
    // counted once, the way the pairwise scorers key on an unordered pair. Left
    // double, such a crossing outweighs a repaired-to-fixed one two to one, and
    // `lessDamaged` compares those counts.
    const rank = new Map<SceneEdge, number>();
    for (const [index, edge] of [...repaired].entries()) rank.set(edge, index);
    let count = 0;
    for (const edge of repaired)
      for (const other of scene.edges) {
        if (other === edge) continue;
        const mine = rank.get(other);
        if (mine !== undefined && mine < rank.get(edge)!) continue;
        for (let i = 0; i + 1 < edge.pts.length; i++)
          for (let j = 0; j + 1 < other.pts.length; j++)
            if (segmentsCross(edge.pts[i], edge.pts[i + 1], other.pts[j], other.pts[j + 1]))
              count++;
      }
    return count;
  };

  const stateHarm = (): number[] => {
    const tiers = [0, 0, 0, 0, 0];
    for (const tier of soloProfile().values()) tiers[tier]++;
    const [labels0, labels1] = labelHarm();
    tiers[0] += labels0;
    tiers[1] += labels1;
    // Crossings are tier 2 (see `TIER` in scripts/sweep.ts).
    tiers[2] += crossHarm();
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

  /**
   * The flow a breach key names — `diag:F04:1`, `leaf:F04~db`, `adrift:7` — so a
   * promise the batch broke can be charged to the repair that broke it instead
   * of to all of them. `null` when the key belongs to no flow this pass moved,
   * which is the case the batch revert still has to cover.
   */
  const flowOfBreach = (key: string): string | null => {
    if (key.startsWith("adrift:"))
      return labels[Number.parseInt(key.slice("adrift:".length), 10)]?.flowId ?? null;
    const body = key.slice(key.indexOf(":") + 1);
    const cut = body.search(/[~:]/);
    return cut < 0 ? body : body.slice(0, cut);
  };

  const withRepair = stateHarm();
  const breachesWith = breaches();
  const repairedRoutes = repaired.map((edge) => edge.pts);
  const replacedRoutes = repaired.map((edge) => edge.repairedFrom!);
  /** Put the drawing into one keep/revert combination and settle it for real. */
  const applyKeep = (keep: boolean[]) => {
    repaired.forEach((edge, index) => {
      edge.pts = keep[index] ? repairedRoutes[index] : replacedRoutes[index];
    });
    resettle();
  };

  applyKeep(repaired.map(() => false));
  const withoutRepair = stateHarm();
  const breachesWithout = breaches();
  const broken = [...breachesWith].filter((key) => !breachesWithout.has(key));
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
  if (!broken.length) {
    if (!lessDamaged(withoutRepair, withRepair)) applyKeep(repaired.map(() => true));
    for (const edge of repaired) edge.repairedFrom = undefined;
    return;
  }

  // The veto is owed by the repair that broke the promise, not by the batch it
  // arrived in. `repaired` is every route this render moved, so an all-or-
  // nothing revert threw away the innocent ones too: on `infrastructure`
  // (page and tall) one broken key discarded five repairs and put four runs back
  // across container names — a tier-0 §4e strike bought with nothing.
  //
  // So revert only the flows the broken keys name, and judge what survives
  // exactly as the whole-drawing comparison above judges: it ships only if it
  // breaks no promise of its own and is no more damaged than the full revert.
  // Keys naming a flow this pass never moved leave nothing to charge, and the
  // full revert already applied stands.
  const blamed = new Set(broken.map(flowOfBreach).filter((id): id is string => id !== null));
  const keep = repaired.map((edge) => !blamed.has(edge.id));
  if (keep.some(Boolean) && keep.some((kept) => !kept)) {
    applyKeep(keep);
    const partly = stateHarm();
    const stillBroken = [...breaches()].some((key) => !breachesWithout.has(key));
    if (stillBroken || lessDamaged(withoutRepair, partly)) applyKeep(repaired.map(() => false));
  }
  for (const edge of repaired) edge.repairedFrom = undefined;
}


/**
 * The corner glyphs that tell the infrastructure kinds apart at a glance.
 *
 * Each is stroke-only, in the kind's own stroke colour, drawn inside one 18x16
 * box so they read as a family. A pen receives that box already placed and
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

/** Padlock: authentication is a check something must pass. */
const padlock = ({ x, y, r, line, stroke }: GlyphPen): string =>
  `<rect x="${x(3)}" y="${y(7)}" width="${r(12)}" height="${r(9)}" rx="${r(2)}" ${line}/>` +
  `<path d="M ${x(6)} ${y(7)} v ${-r(3)} a ${r(3)} ${r(3)} 0 0 1 ${r(6)} 0 v ${r(3)}" ${line}/>` +
  `<circle cx="${x(9)}" cy="${y(11)}" r="${r(1.5)}" fill="${stroke}"/>`;

const GLYPHS: Record<string, (pen: GlyphPen) => string> = {
  auth: padlock,
  // The logical view's security capability wears the same padlock: a reader who
  // has seen one view should not have to learn a second mark for the same idea.
  security: padlock,
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
  // One line in, three out of a split point: a load balancer picks one backend
  // out of many, which is exactly what the gateway's two posts do not say.
  "load-balancer": ({ x, y, r, line, stroke }) =>
    `<path d="M ${x(1)} ${y(8)} H ${x(7)}" ${line}/>` +
    `<path d="M ${x(7)} ${y(8)} L ${x(16)} ${y(2)} M ${x(7)} ${y(8)} H ${x(16)} M ${x(7)} ${y(8)} L ${x(16)} ${y(14)}" ${line}/>` +
    `<circle cx="${x(7)}" cy="${y(8)}" r="${r(1.6)}" fill="${stroke}"/>`,
  // Brick wall: a firewall is a barrier, and no other kind reads as one.
  firewall: ({ x, y, r, line }) =>
    `<rect x="${x(2)}" y="${y(2)}" width="${r(14)}" height="${r(12)}" rx="${r(1)}" ${line}/>` +
    `<path d="M ${x(2)} ${y(6)} H ${x(16)} M ${x(2)} ${y(10)} H ${x(16)}" ${line}/>` +
    `<path d="M ${x(9)} ${y(2)} V ${y(6)} M ${x(6)} ${y(6)} V ${y(10)} M ${x(12)} ${y(6)} V ${y(10)} M ${x(9)} ${y(10)} V ${y(14)}" ${line}/>`,
  // Monitor on a stand: a device is the machine a person works at. The screen is
  // left empty on purpose — that is what separates it from the firewall's wall
  // at legend size, where both are a rectangle and little else survives.
  device: ({ x, y, r, line }) =>
    `<rect x="${x(2)}" y="${y(1)}" width="${r(14)}" height="${r(9)}" rx="${r(1)}" ${line}/>` +
    `<path d="M ${x(9)} ${y(10)} V ${y(13)}" ${line}/>` +
    `<path d="M ${x(4)} ${y(13)} H ${x(14)}" ${line}/>`,
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
  /**
   * Collects the built-in slugs this render actually paints, so the document's
   * attribution names those and nothing else. Written here rather than derived
   * from the model because only this function knows which marks survived: a
   * file logo the caller never resolved, or a name with no built-in behind it,
   * draws nothing and owes nothing.
   */
  drawn: Set<string>;
  /** Shapes with a curved corner push the mark clear of it. */
  inset?: { right?: number; top?: number };
}): string {
  const { logo, resolved, node, stroke, drawn, inset = {} } = mark;
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
  drawn.add(logo.value);
  // 24 is the authored viewBox edge. Rounded to four places through integer
  // maths so the attribute is a short, stable decimal rather than the raw
  // binary quotient (§2: no drifting floats in the output path).
  const scale = Math.round((LOGO_BOX.size / 24) * 1e4) / 1e4;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${stroke}"><title>${esc(builtin.title)}</title><path d="${builtin.d}"/></g>\n`;
}

/** Everything the node shapes paint with: theme colours, fonts and per-element style. */
interface NodePaint {
  palette: ReturnType<typeof themeFor>["palette"];
  nodeFontSize: number;
  containerFontSize: number;
  resolveStyle: (kind: string, id: string) => StyleProps;
  elementLogo: Map<string, Element["logo"]>;
  /** `id` → inlined `data:` URI, filled in by whoever could read the files. */
  resolvedLogos: Map<string, string> | undefined;
  /** Filled in as marks are painted; read once the body is built. */
  drawnLogos: Set<string>;
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
    nodeFontSize,
    containerFontSize,
    resolveStyle,
    elementLogo,
    resolvedLogos,
    drawnLogos,
  } = paint;
  /** The logo mark for a node, already placed and coloured. `""` when it has none. */
  const logoFor = (node: SceneNode, stroke: string, inset?: { right?: number; top?: number }) =>
    logoSvg({
      logo: elementLogo.get(node.id),
      resolved: resolvedLogos,
      node,
      stroke,
      drawn: drawnLogos,
      inset,
    });
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
  legendLineStyles: View["legendLineStyles"];
  scaled: (n: number) => number;
  objectName: Map<string, string>;
  resolveStyle: (kind: string, id: string) => StyleProps;
  defaultEdgeColor: string;
  markerName: (color: string) => string;
  numbered: boolean;
}

/**
 * The kinds this drawing actually places, in the order their keys are drawn.
 * A key for a kind the reader cannot find on the canvas is noise, so the legend
 * is derived from the scene rather than from the view's vocabulary. `actor` is
 * the one kind a view opts into (`View.actorLegend`): elsewhere a person glyph
 * needs no key.
 */
const legendKinds = (paint: BandPaint): string[] =>
  [...new Set(paint.scene.nodes.map((node) => node.kind))].filter(
    (kind) => paint.legendNames[kind] && (kind !== "actor" || paint.view.actorLegend),
  );

/**
 * The legend's element keys: one swatch per kind, drawn from the same `glyphSvg`
 * the nodes are, so a key and the shape it stands for cannot drift apart.
 * Returns where the band now ends — `y` unchanged when there is nothing to key.
 */
function kindKeysSvg(
  paint: BandPaint,
  kinds: string[],
  y: number,
  x: number,
): { svg: string; bandY: number } {
  const { scene, palette, legendNames, scaled, resolveStyle } = paint;
  let svg = "";
  let keyX = x;
  let bandY = y;
  const LINE_H = scaled(12);
  for (const kind of kinds) {
    const nodeStyle = resolveStyle(kind, "");
    if (kind === "actor") {
      const stroke = nodeStyle.stroke?.color ?? palette.actorStroke;
      svg += `<circle cx="${keyX + scaled(13)}" cy="${bandY + scaled(5)}" r="${scaled(3)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>\n`;
      svg += `<path d="M ${keyX + scaled(8)} ${bandY + scaled(15)} q ${scaled(5)} ${scaled(-7)} ${scaled(10)} 0" fill="none" stroke="${stroke}" stroke-width="1.2"/>\n`;
    } else {
      const dash = dashArray(nodeStyle.stroke?.style);
      const stroke = nodeStyle.stroke?.color ?? palette.nodeStroke;
      svg += `<rect x="${keyX}" y="${bandY + 2}" width="${scaled(26)}" height="${scaled(14)}" rx="3" fill="${nodeStyle.fill ?? palette.nodeFill}" stroke="${escAttr(stroke)}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>\n`;
      // A kind drawn with a glyph shows that glyph in its key, from the same
      // function the node renderer calls. The glyph is scaled to sit inside the
      // swatch with a 2px margin.
      const glyphScale = (scaled(14) - scaled(4)) / GLYPH_BOX.height;
      svg += glyphSvg(kind, escAttr(stroke), {
        x: keyX + (scaled(26) - GLYPH_BOX.width * glyphScale) / 2,
        y: bandY + 2 + (scaled(14) - GLYPH_BOX.height * glyphScale) / 2,
        scale: glyphScale,
      });
    }
    const name = legendNames[kind];
    // A name with room for it is one line, exactly as before wrapping existed.
    const lines = bandLines(name, keyX + scaled(32), bandRightMargin(scene), scaled(10));
    for (const [row, line] of lines.entries())
      svg += `<text x="${keyX + scaled(32)}" y="${bandY + scaled(13) + row * LINE_H}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(line)}</text>\n`;
    keyX += scaled(40) + Math.ceil(name.length * scaled(10) * RENDER_CHAR_WIDTH) + scaled(24);
    // A key that wrapped owns its row: what follows would sit beside a block of
    // text rather than beside a key.
    bandY += (lines.length - 1) * LINE_H;
    if (lines.length > 1 || keyX > scene.width - 220) {
      keyX = x;
      bandY += scaled(22);
    }
  }
  return { svg, bandY: kinds.length ? bandY + scaled(24) : bandY };
}

/**
 * The legend's line-style keys: what each arrow glyph means in this view
 * (`View.legendLineStyles`), one key per style the drawing actually uses. The
 * swatch is drawn from `dashArray`, the same function the edges are, so a key
 * and the lines it stands for cannot drift apart. Returns where the band now
 * ends — `y` unchanged when there is nothing to key.
 */
function lineStyleKeysSvg(paint: BandPaint, y: number, x: number): { svg: string; bandY: number } {
  const { scene, model, style, palette, legendLineStyles, scaled, defaultEdgeColor, markerName } =
    paint;
  const styles: LineStyle[] = LINE_STYLES.filter((lineStyle) =>
    model.flows.some((flow) => lineStyleOf(flow, style) === lineStyle),
  );
  // One style throughout distinguishes nothing, and the flow key above already
  // says what a flow is in this view: a legend is there to tell things apart.
  if (styles.length < 2) return { svg: "", bandY: y };
  const maxX = scene.width - 20;
  let svg = "";
  let keyX = x;
  let bandY = y;
  const LINE_H = scaled(12);
  for (const [index, lineStyle] of styles.entries()) {
    const meaning = legendLineStyles[lineStyle];
    const keyWidth =
      scaled(40) + Math.ceil(meaning.length * scaled(10) * RENDER_CHAR_WIDTH) + scaled(24);
    // Wrap before drawing rather than after: these readings are sentences, and
    // one started near the right edge would run off it.
    if (keyX > x && keyX + keyWidth > maxX) {
      keyX = x;
      bandY += scaled(22);
    }
    const dash = dashArray(lineStyle);
    svg += `<line x1="${keyX}" y1="${bandY + 8}" x2="${keyX + scaled(26)}" y2="${bandY + 8}" stroke="${escAttr(defaultEdgeColor)}" stroke-width="1.3"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${markerName(defaultEdgeColor)})"/>\n`;
    // A reading with no row wide enough for it is broken across lines rather
    // than over the canvas edge.
    const lines = bandLines(meaning, keyX + scaled(40), maxX, scaled(10));
    for (const [row, line] of lines.entries())
      svg += `<text x="${keyX + scaled(32)}" y="${bandY + scaled(12) + row * LINE_H}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(line)}</text>\n`;
    if (lines.length === 1) {
      keyX += keyWidth;
      continue;
    }
    // A wrapped reading owns its row — nothing else fits beside it anyway.
    bandY += (lines.length - 1) * LINE_H;
    if (index < styles.length - 1) {
      bandY += scaled(22);
      keyX = x;
    }
  }
  return { svg, bandY: bandY + scaled(24) };
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
    style,
    palette,
    annot,
    ui,
    legendFlowLabel,
    scaled,
    objectName,
    defaultEdgeColor,
    markerName,
    numbered,
  } = paint;

  let bandY = scene.height;
  let bandsSvg = "";
  const rightMargin = bandRightMargin(scene);
  // A drawing can be narrower than the words under it — a `tall` infrastructure
  // view is often 200px wide, and its legend says "Technical flow (protocol,
  // port)". Where the column beside the title leaves too little to write in, the
  // title takes its own row and the content starts at the left margin, which is
  // the whole width rather than a seventh of it. The bands never widen the
  // drawing to make room (`svgDocument`), so this is the only room there is.
  const stackedTitle = rightMargin - BAND_CONTENT_X < MIN_BAND_TEXT;
  const contentX = stackedTitle ? 20 : BAND_CONTENT_X;

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
    // Beside the title, the first content row shares its baseline; under it, the
    // content starts a row lower so the two do not collide.
    bandY += scaled(stackedTitle ? 34 : 20);
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
      const lines = raw.split("\n").flatMap((segment) => bandWrap(segment, maxChars));
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
    const LINE_H = scaled(12);
    /** A chip and the reading beside it, wrapped to the room left of the margin. */
    const chipRow = (name: string, reading: string) => {
      const chipResult = chip(contentX, bandY + 2, name);
      bandsSvg += chipResult.svg;
      const textX = contentX + chipResult.width + 10;
      const lines = reading ? bandLines(reading, textX, rightMargin, scaled(10)) : [];
      for (const [row, line] of lines.entries())
        bandsSvg += `<text x="${textX}" y="${bandY + scaled(13) + row * LINE_H}" font-size="${scaled(10)}" fill="${palette.bandMuted}">${esc(line)}</text>\n`;
      bandY += scaled(24) + Math.max(0, lines.length - 1) * LINE_H;
    };
    for (const bo of model.businessObjects)
      chipRow(bo.name, bo.description ? `— ${bo.description}` : "");
    // What a chip means belongs with the objects it describes, not among the
    // legend's shape keys — and only when the drawing has chips to explain.
    if (model.flows.some((flow) => flow.objects?.length))
      chipRow(ui.businessObject, ui.carriedByFlow);
    bandY += 6;
  };

  const renderLegendBand = () => {
    const kinds = legendKinds(paint);
    // Every key this band can carry is conditional on what the drawing holds, so
    // the band itself is too — a legend of nothing is worse than no legend.
    if (!kinds.length && !model.flows.length && !model.legendNotes.length) return;
    beginBand(ui.legend);
    const kindKeys = kindKeysSvg(paint, kinds, bandY, contentX);
    bandsSvg += kindKeys.svg;
    bandY = kindKeys.bandY;
    // The arrow key describes flows, so a diagram without any gets none.
    if (model.flows.length) {
      bandsSvg += `<line x1="${contentX}" y1="${bandY + 8}" x2="${contentX + scaled(26)}" y2="${bandY + 8}" stroke="${escAttr(defaultEdgeColor)}" stroke-width="1.3" marker-end="url(#${markerName(defaultEdgeColor)})"/>\n`;
      const flowLabelText =
        (numbered ? legendFlowLabel + " — " + ui.numberedSuffix : legendFlowLabel) +
        (style.flowColor === "by-source"
          ? style.lang === "fr"
            ? " — couleur = source"
            : " — colour = source"
          : "");
      const flowKeyX = contentX + scaled(32);
      const flowKeyLines = bandLines(flowLabelText, flowKeyX, rightMargin, scaled(10));
      for (const [row, line] of flowKeyLines.entries())
        bandsSvg += `<text x="${flowKeyX}" y="${bandY + scaled(12) + row * scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(line)}</text>\n`;
      bandY += scaled(24) + (flowKeyLines.length - 1) * scaled(12);
      // What each arrow glyph means, keyed under the flow it qualifies.
      const lineStyleKeys = lineStyleKeysSvg(paint, bandY, contentX);
      bandsSvg += lineStyleKeys.svg;
      bandY = lineStyleKeys.bandY;
    }
    for (const note of model.legendNotes) {
      const lines = bandLines(note, contentX, rightMargin, scaled(10));
      for (const [row, line] of lines.entries())
        bandsSvg += `<text x="${contentX}" y="${bandY + scaled(12) + row * scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}" font-style="italic">${esc(line)}</text>\n`;
      bandY += scaled(20) + (lines.length - 1) * scaled(12);
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
    const dash = dashArray(lineStyleOf(flow, style));
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
  /** Third-party artwork notice for the licensed logos drawn, or `""`. */
  attribution: string;
}): string {
  const {
    width,
    height,
    fontFamily,
    background,
    arrowMarkers,
    markerSize,
    body,
    bandsSvg,
    attribution,
  } = args;
  const markers = [...arrowMarkers]
    .map(
      ([color, markerName]) =>
        `<marker id="${markerName}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${markerSize}" markerHeight="${markerSize}" orient="auto-start-reverse">\n<path d="M0,0 L10,5 L0,10 z" fill="${escAttr(color)}"/></marker>`,
    )
    .join("\n");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${escAttr(fontFamily)},Arial,sans-serif">
${attribution}<defs>${markers}</defs>
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
  const { palette, kinds: kindDefaults } = options?.theme
    ? themeFromSpec(options.theme, view)
    : themeFor(style.theme, view);
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
  const legendLineStyles = style.lang === "fr" ? view.legendLineStylesFr : view.legendLineStyles;

  const elementStyle = new Map<string, StyleProps | undefined>();
  const elementLogo = new Map<string, Element["logo"]>();
  for (const entry of collectElementStyles(model.elements)) {
    elementStyle.set(entry.id, entry.style);
    if (entry.logo) elementLogo.set(entry.id, entry.logo);
  }

  const resolveStyle = (kind: string, id: string): StyleProps => {
    const base = kindDefaults[kind] ?? {};
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
  } = createLabelSettler({ scene, model });

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
  // Again, for the same reason `compactVertical` runs again: a reverted repair
  // restores the route `recordRepairs` saved, and that route may cross a frame
  // the layout-stage pass never measured it against. Idempotent on geometry it
  // already cleared, so it is a no-op wherever nothing was reverted.
  airOutContainers(scene);
  // Last word on the canvas size: settling moves labels, and a reverted repair
  // restores the route it replaced, so both can land outside the frame layout
  // sized. Before the bands are built, so the legend is laid out against the
  // width the document ends up with.
  fitCanvas(scene);

  // Which licensed marks this render actually paints, and so what the document
  // has to attribute. Declared here because the renderers fill it and the
  // document reads it — the body has to exist before the notice can be honest.
  const drawnLogos = new Set<string>();
  const { renderContainerNode, renderLeafNode } = createNodeRenderers({
    palette,
    nodeFontSize,
    containerFontSize,
    resolveStyle,
    elementLogo,
    resolvedLogos: options?.logos,
    drawnLogos,
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
    legendLineStyles,
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
    // Read after the body is built, so it names the marks that were painted
    // rather than the ones the model asked for.
    attribution: logoAttributionComment(drawnLogos),
  });
  return { svg, overlapsBefore, overlapsAfter };
}
