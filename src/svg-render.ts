/**
 * Turn a laid-out Scene into the final SVG document.
 *
 * This is the last stage of the pipeline (… → layout → render). It receives the
 * absolute-positioned Scene from layout.ts and emits SVG text: one shape per
 * node, one path per flow, and the explanatory bands (FLOWS / BUSINESS OBJECTS /
 * LEGEND) stacked underneath the diagram.
 *
 * Reading order of `render()`:
 *   1. resolve theme + per-element styles           (resolveStyle)
 *   2. settle flow-label positions so none overlap   (settleLabelPositions)
 *   3. emit node shapes, then flow paths + labels    (renderContainerNode / renderLeafNode / renderEdge)
 *   4. emit the bands below the canvas               (renderFlowsBand / renderObjectsBand / renderLegendBand)
 *   5. assemble the <svg> with its arrowhead markers
 *
 * Two invariants shape the code:
 *   • Determinism — identical input must produce byte-identical SVG. Every
 *     number goes through `round1` / `scaled`; no dates, randomness, or locale
 *     formatting ever touch the output path.
 *   • Safety — user text is untrusted, so it is escaped with `esc` (text nodes)
 *     or `escAttr` (attribute values) before it reaches the SVG.
 *
 * INVARIANT (§1.1): every flow is a distinct arrow with a distinct label. Never merged.
 */

import type { Model, View, StyleProps, Flow } from './model.ts';
import { themeFor, flowPalette, UI } from './model.ts';
import type { Scene, SceneNode, SceneEdge, SceneLabel } from './layout.ts';
import { chipW, techText, wrapText, fontSizes } from './text.ts';

const HOP_RADIUS = 5;
const SEC_LEVEL_FR: Record<string, string> = { public: 'public', internal: 'interne', restricted: 'restreint', secret: 'secret' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Attribute context also needs the quote escaped, else a user string placed
// inside `="..."` (e.g. a custom font family) could break out and inject
// attributes — an XSS vector when the SVG is opened standalone or inlined.
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');
const dashArray = (lineStyle?: string) => lineStyle === 'dashed' ? '5 3' : lineStyle === 'dotted' ? '2 2.5' : undefined;

interface Box { x: number; y: number; w: number; h: number; }
const overlaps = (a: Box, b: Box) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

export interface RenderResult { svg: string; overlapsBefore: number; overlapsAfter: number; }

export function render(model: Model, view: View, scene: Scene): RenderResult {
  const style = model.style;
  const fonts = fontSizes(style.font.size);
  const { edge: FS_EDGE, node: FS_NODE, cont: FS_CONT } = fonts;
  const round1 = (n: number) => Math.round(n * 10) / 10;   // 1-decimal, tidy SVG numbers
  // Annotation sizes (tech tails, chips, tags, legend/registry bands) scale with
  // the base too; `.scale` is 1 at the default base so output stays identical.
  const annot = {
    tech: round1(fonts.tech), chip: round1(fonts.chip), tag: round1(fonts.tag), band: round1(fonts.band),
    bandTitle: round1(fonts.bandTitle), chipH: Math.round(fonts.chipH), scale: fonts.scale,
    chipRectH: Math.round(15 * fonts.scale), chipTextDy: round1(11 * fonts.scale),
  };
  // Below-canvas bands (FLOWS / BUSINESS OBJECTS / LEGEND) scale every metric —
  // fonts, row heights, offsets — by the same factor so they grow together.
  // At the default base, scale = 1 and scaled(n) === n, so output is byte-identical.
  const scaled = (n: number) => round1(n * fonts.scale);
  // Theme selects the chrome palette, per-kind default fills/strokes and levels.
  const { palette, kinds: kindDefaults, levels: levelDefaults } = themeFor(style.theme, view);
  const isDarkTheme = ['dark', 'nord', 'classic-dark'].includes(style.theme);
  // Flow color: explicit flow-stroke wins, else the accent (if set), else palette.
  const edgeColor = style.flowStrokeColorSet ? style.flowStroke.color : (style.accent ?? palette.edge);

  // `flow-color: by-source` tints each flow (and its arrowhead) by its origin.
  // Assign palette hues to distinct source ids in first-seen order, cycling.
  const sourceHue = new Map<string, string>();
  if (style.flowColor === 'by-source') {
    const hues = flowPalette[isDarkTheme ? 'dark' : 'light'];
    for (const flow of model.flows) if (!sourceHue.has(flow.from)) sourceHue.set(flow.from, hues[sourceHue.size % hues.length]);
  }
  const flowColorOf = (flow?: Flow): string =>
    flow?.style?.stroke?.color ?? (style.flowColor === 'by-source' ? sourceHue.get(flow?.from ?? '') ?? edgeColor : edgeColor);

  // Arrowhead markers: one <marker> per distinct color, so heads match their
  // line even in static SVG (no reliance on context-stroke). The base edge color
  // keeps id "arr" so default output (normal arrows, no color) is byte-identical.
  const arrowMarkers = new Map<string, string>();
  const markerId = (color: string): string => {
    let id = arrowMarkers.get(color);
    if (!id) { id = arrowMarkers.size === 0 ? 'arr' : `arr${arrowMarkers.size}`; arrowMarkers.set(color, id); }
    return id;
  };

  const flowById = new Map<string, Flow>(model.flows.map(f => [f.id, f]));
  const objectName = new Map(model.businessObjects.map(b => [b.id, b.name]));
  const numbered = style.flowText === 'numbered';
  // Output localization (keywords stay English — decision D2).
  const ui = UI[style.lang] ?? UI.en;
  const legendNames = style.lang === 'fr' ? view.legendNamesFr : view.legendNames;
  const legendFlowLabel = style.lang === 'fr' ? view.legendFlowLabelFr : view.legendFlowLabel;

  const elementStyle = new Map<string, StyleProps | undefined>();
  const elementAttr = new Map<string, string | undefined>();
  (function index(els: Model['elements']) {
    for (const e of els) { elementStyle.set(e.id, e.style); elementAttr.set(e.id, e.attr?.value); index(e.children); }
  })(model.elements);

  // Effective style for an element: view/theme default < diagram-level per-kind
  // override < per-element inline style. Trust-zone base colors come from the
  // sensitivity level (theme.levels) rather than the kind default.
  const resolveStyle = (kind: string, id: string): StyleProps => {
    let base = kindDefaults[kind] ?? {};
    const level = elementAttr.get(id);
    if (kind === 'trust-zone' && level && levelDefaults?.[level]) base = levelDefaults[level];
    const perKind = style.kind[kind] ?? {};
    const inline = elementStyle.get(id) ?? {};
    return {
      fill: inline.fill ?? perKind.fill ?? base.fill,
      stroke: { ...base.stroke, ...perKind.stroke, ...inline.stroke },
      text: inline.text ?? perKind.text ?? base.text,
    };
  };

  // ---- flow-label placement + overlap post-pass ----
  const nodeBoxes: Box[] = scene.nodes.filter(n => !n.container).map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const labels: SceneLabel[] = scene.edges.flatMap(e => e.labels);
  const labelBoxes: Box[] = labels.map(l => l as Box);

  const countLabelOverlaps = (): number => {
    let count = 0;
    for (let i = 0; i < labelBoxes.length; i++) {
      for (let j = i + 1; j < labelBoxes.length; j++) if (overlaps(labelBoxes[i], labelBoxes[j])) count++;
      for (const node of nodeBoxes) if (overlaps(labelBoxes[i], node)) count++;
    }
    return count;
  };

  // Apply the requested above/below offset, then nudge any still-colliding label
  // along a fixed search of vertical (then vertical+horizontal) offsets until it
  // clears every other label and node — or give up and leave it in place.
  const settleLabelPositions = () => {
    for (const label of labels) {
      const requested = flowById.get(label.flowId)?.style?.label ?? style.flowLabel;
      if (requested === 'above') label.y -= label.h / 2 + 5;
      else if (requested === 'below') label.y += label.h / 2 + 5;
    }
    for (const label of labels) {
      const collides = () =>
        labelBoxes.some(o => o !== label && overlaps(o, label as Box)) || nodeBoxes.some(node => overlaps(node, label as Box));
      if (!collides()) continue;
      const originY = label.y, originX = label.x;
      let settled = false;
      outer: for (const dx of [0, -24, 24, -48, 48]) {
        for (const step of [0, 8, 14, 20, 28, 36, 44, 56, 70, 86]) {
          for (const dir of step === 0 ? [1] : [-1, 1]) {
            label.y = originY + dir * step; label.x = originX + dx;
            if (!collides()) { settled = true; break outer; }
          }
        }
      }
      if (!settled) { label.x = originX; label.y = originY; }
    }
  };

  const overlapsBefore = countLabelOverlaps();
  settleLabelPositions();
  const overlapsAfter = countLabelOverlaps();

  // ---- crossing hops ----
  // Collect every vertical wire so a horizontal wire crossing one can arc over
  // it (a little hop), which reads far better than an ambiguous plus-junction.
  const verticalSegments: { x: number; y1: number; y2: number }[] = [];
  if (style.crossingHops) {
    for (const e of scene.edges) {
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        if (Math.abs(a.x - b.x) < 0.5) verticalSegments.push({ x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
      }
    }
  }
  const edgePath = (pts: { x: number; y: number }[]): string => {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (style.crossingHops && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) {
        const dir = Math.sign(b.x - a.x);
        const lo = Math.min(a.x, b.x) + HOP_RADIUS + 1, hi = Math.max(a.x, b.x) - HOP_RADIUS - 1;
        const crossings = verticalSegments
          .filter(v => v.x > lo && v.x < hi && a.y > v.y1 + 1 && a.y < v.y2 - 1)
          .map(v => v.x)
          .sort((p, q) => (dir > 0 ? p - q : q - p));
        for (const cx of crossings) d += ` L ${cx - dir * HOP_RADIUS} ${a.y} A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${dir > 0 ? 1 : 0} ${cx + dir * HOP_RADIUS} ${a.y}`;
      }
      d += ` L ${b.x} ${b.y}`;
    }
    return d;
  };

  // A leaf node's caption: multiline text centered on `centerX`, each line
  // stacked below `topBaseline`. Shared by every node shape.
  const centeredNodeLabel = (lines: string[], centerX: number, topBaseline: number, fill: string): string =>
    lines
      .map((line, i) => `<text x="${centerX}" y="${topBaseline + i * (FS_NODE + 2)}" font-size="${FS_NODE}" text-anchor="middle" fill="${fill}">${esc(line)}</text>\n`)
      .join('');
  // Vertical origin that centers `lineCount` lines of node text inside height `h`.
  const centerLinesY = (top: number, h: number, lineCount: number) =>
    top + h / 2 - ((lineCount - 1) * (FS_NODE + 2)) / 2 + 4;

  // ---- node shapes ----
  const renderContainerNode = (n: SceneNode): string => {
    const s = resolveStyle(n.kind, n.id);
    const dash = dashArray(s.stroke?.style);
    let svg = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${s.fill ?? palette.containerFill}" stroke="${s.stroke?.color ?? palette.containerStroke}" stroke-width="${s.stroke?.width ?? 1.2}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>\n`;
    n.label.split('\n').forEach((line, i) => {
      svg += `<text x="${n.x + 10}" y="${n.y + 18 + i * 14}" font-size="${FS_CONT}" font-weight="bold" fill="${s.text ?? palette.containerLabel}">${esc(line)}</text>\n`;
    });
    // security view: sensitivity level tag, bottom-right of the trust zone
    // (inside the bottom padding — clear of the title and of child nodes)
    const level = n.kind === 'trust-zone' ? elementAttr.get(n.id) : undefined;
    if (level) {
      const word = (style.lang === 'fr' ? SEC_LEVEL_FR[level] : level) ?? level;
      svg += `<text x="${n.x + n.w - 9}" y="${n.y + n.h - 6}" font-size="${annot.tag}" text-anchor="end" font-weight="bold" fill="${s.stroke?.color ?? palette.containerStroke}" letter-spacing="0.5">${esc(word.toUpperCase())}</text>\n`;
    }
    return svg;
  };

  const renderActor = (n: SceneNode, s: StyleProps, lines: string[]): string => {
    const cx = n.x + n.w / 2;
    const stroke = s.stroke?.color ?? palette.actorStroke;
    let svg = `<circle cx="${cx}" cy="${n.y + 10}" r="7" fill="none" stroke="${stroke}" stroke-width="1.5"/>
<path d="M ${cx - 11} ${n.y + 32} q 11 -19 22 0" fill="none" stroke="${stroke}" stroke-width="1.5"/>\n`;
    lines.forEach((line, i) => {
      svg += `<text x="${cx}" y="${n.y + 44 + i * 11}" font-size="${FS_NODE - 1.5}" text-anchor="middle" fill="${s.text ?? palette.actorText}">${esc(line)}</text>\n`;
    });
    return svg;
  };

  const renderDatastore = (n: SceneNode, s: StyleProps, lines: string[]): string => {
    const ry = 7, stroke = s.stroke?.color ?? palette.nodeStroke, fill = s.fill ?? palette.nodeFill;
    const body =
      `<path d="M ${n.x} ${n.y + ry} v ${n.h - 2 * ry} a ${n.w / 2} ${ry} 0 0 0 ${n.w} 0 v ${-(n.h - 2 * ry)}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + ry}" rx="${n.w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n`;
    const cy = n.y + ry + (n.h - ry) / 2 - ((lines.length - 1) * (FS_NODE + 2)) / 2 + 4;
    return body + centeredNodeLabel(lines, n.x + n.w / 2, cy, s.text ?? palette.nodeText);
  };

  const renderQueue = (n: SceneNode, s: StyleProps, lines: string[]): string => {
    const rx = 8;
    const fill = escAttr(s.fill ?? palette.nodeFill), stroke = escAttr(s.stroke?.color ?? palette.nodeStroke), text = escAttr(s.text ?? palette.nodeText);
    const body =
      `<path d="M ${n.x + rx} ${n.y} h ${n.w - 2 * rx} a ${rx} ${n.h / 2} 0 0 1 0 ${n.h} h ${-(n.w - 2 * rx)} a ${rx} ${n.h / 2} 0 0 1 0 ${-n.h}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<ellipse cx="${n.x + rx}" cy="${n.y + n.h / 2}" rx="${rx}" ry="${n.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n`;
    return body + centeredNodeLabel(lines, n.x + rx + (n.w - rx) / 2, centerLinesY(n.y, n.h, lines.length), text);
  };

  const renderGateway = (n: SceneNode, s: StyleProps, lines: string[]): string => {
    const cx = n.x + n.w / 2;
    const fill = escAttr(s.fill ?? palette.nodeFill), stroke = escAttr(s.stroke?.color ?? palette.nodeStroke), text = escAttr(s.text ?? palette.nodeText);
    const body =
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<path d="M ${round1(n.x + 8)} ${round1(n.y + 8)} L ${round1(n.x + 22)} ${round1(n.y + 8)} Q ${round1(n.x + 24)} ${round1(n.y + 13)} ${round1(n.x + 15)} ${round1(n.y + 20)} Q ${round1(n.x + 6)} ${round1(n.y + 13)} ${round1(n.x + 8)} ${round1(n.y + 8)}" fill="none" stroke="${stroke}" stroke-width="1.3"/>\n`;
    return body + centeredNodeLabel(lines, cx + 10, centerLinesY(n.y, n.h, lines.length), text);
  };

  const renderAuth = (n: SceneNode, s: StyleProps, lines: string[]): string => {
    const cx = n.x + n.w / 2;
    const fill = escAttr(s.fill ?? palette.nodeFill), stroke = escAttr(s.stroke?.color ?? palette.nodeStroke), text = escAttr(s.text ?? palette.nodeText);
    const body =
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<rect x="${n.x + 6}" y="${n.y + 6}" width="18" height="14" rx="3" fill="none" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<path d="M ${n.x + 10} ${n.y + 9} v -4 a 5 5 0 0 1 10 0 v 4" fill="none" stroke="${stroke}" stroke-width="1.3"/>\n` +
      `<circle cx="${n.x + 15}" cy="${n.y + 16}" r="2.5" fill="${stroke}"/>\n`;
    return body + centeredNodeLabel(lines, cx + 10, centerLinesY(n.y, n.h, lines.length), text);
  };

  const renderPlainBox = (n: SceneNode, s: StyleProps, lines: string[]): string => {
    const dash = dashArray(s.stroke?.style);
    const body = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${s.fill ?? palette.nodeFill}" stroke="${s.stroke?.color ?? palette.nodeStroke}" stroke-width="${s.stroke?.width ?? 1.3}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>\n`;
    return body + centeredNodeLabel(lines, n.x + n.w / 2, centerLinesY(n.y, n.h, lines.length), s.text ?? palette.nodeText);
  };

  const renderLeafNode = (n: SceneNode): string => {
    const s = resolveStyle(n.kind, n.id);
    const lines = n.label.split('\n');
    switch (n.kind) {
      case 'actor': return renderActor(n, s, lines);
      case 'datastore': return renderDatastore(n, s, lines);
      case 'queue': return renderQueue(n, s, lines);
      case 'gateway': return renderGateway(n, s, lines);
      case 'auth': return renderAuth(n, s, lines);
      default: return renderPlainBox(n, s, lines);
    }
  };

  // ---- flows: one path per edge, plus its label(s) ----
  const renderNumberedBadge = (label: SceneLabel): string => {
    // Number sits on the line near its target (full text lives in the FLOWS band
    // below). No background box: a two-pass halo (fat background-colored number
    // behind, dark number on top) keeps it legible over lines and renders crisply
    // even where `paint-order` is unsupported (PDF/rsvg).
    const cx = label.x + label.w / 2, cy = label.y + label.h / 2 + scaled(3.6), size = scaled(10.5);
    return `<text x="${cx}" y="${cy}" font-size="${size}" text-anchor="middle" fill="${palette.halo}" stroke="${palette.halo}" stroke-width="3" stroke-linejoin="round" font-weight="bold">${esc(label.text)}</text>\n` +
      `<text x="${cx}" y="${cy}" font-size="${size}" text-anchor="middle" fill="${palette.edgeLabel}" font-weight="bold">${esc(label.text)}</text>\n`;
  };

  const renderTextLabel = (label: SceneLabel, flowStyle?: StyleProps): string => {
    // Transparent background: a thin halo (background color) on the glyphs keeps
    // text legible where it crosses a line, without masking fills.
    const lines = label.text ? label.text.split('\n') : [];
    const color = flowStyle?.text ?? palette.edgeLabel;
    let svg = lines
      .map((line, i) => `<text x="${label.x + label.w / 2}" y="${label.y + FS_EDGE + 1 + i * (FS_EDGE + 3)}" font-size="${FS_EDGE}" text-anchor="middle" fill="${color}" font-style="italic" stroke="${palette.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">${esc(line)}</text>\n`)
      .join('');
    // technical sub-line (protocol, format) — space reserved at layout time.
    // Only when the flow has a prose label; a label-less flow renders its
    // protocol AS the label above (promoted in layout), so no sub-line here.
    const flow = flowById.get(label.flowId);
    const tech = techText(flow?.tech);
    if (tech && flow?.label) {
      svg += `<text x="${label.x + label.w / 2}" y="${label.y + FS_EDGE + 1 + lines.length * (FS_EDGE + 3)}" font-size="${annot.tech}" text-anchor="middle" fill="${palette.techText}" stroke="${palette.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">${esc(tech)}</text>\n`;
    }
    // business-object chips (space already reserved at layout time)
    const chips = (flow?.objects ?? []).map(o => objectName.get(o.id) ?? o.id);
    if (chips.length) {
      const totalW = chips.reduce((sum, name) => sum + chipW(name, annot.scale) + 4, -4);
      let cx = label.x + label.w / 2 - totalW / 2;
      const cy = label.y + label.h - annot.chipH + 2;
      for (const name of chips) {
        const w = chipW(name, annot.scale);
        svg += `<rect x="${cx}" y="${cy}" width="${w}" height="${annot.chipRectH}" rx="${annot.chipRectH / 2}" fill="${palette.chipFill}" stroke="${palette.chipStroke}" stroke-width="1"/>\n`;
        svg += `<text x="${cx + w / 2}" y="${cy + annot.chipTextDy}" font-size="${annot.chip}" text-anchor="middle" fill="${palette.chipText}" font-weight="bold">${esc(name)}</text>\n`;
        cx += w + 4;
      }
    }
    return svg;
  };

  const renderEdge = (e: SceneEdge): string => {
    const flow = flowById.get(e.id);
    const flowStyle = flow?.style;
    const color = flowColorOf(flow);
    // arrowhead matches the line only under by-source; otherwise the base edge
    // color, so default output stays byte-identical.
    const headColor = style.flowColor === 'by-source' ? color : edgeColor;
    const dash = dashArray(flowStyle?.stroke?.style ?? style.flowStroke.style);
    const width = flowStyle?.stroke?.width ?? style.flowStroke.width;
    let svg = '';
    if (e.pts.length) {
      svg += `<path d="${edgePath(e.pts)}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} marker-end="url(#${markerId(headColor)})"/>\n`;
    }
    for (const label of e.labels) {
      svg += numbered ? renderNumberedBadge(label) : renderTextLabel(label, flowStyle);
    }
    return svg;
  };

  // ---- bands below the canvas (zero impact on layout & fit metric) ----
  // `bandY` is the running vertical cursor; the band renderers append to
  // `bandsSvg` and advance it.
  let bandY = scene.height;
  let bandsSvg = '';
  const contentX = 150;

  const chip = (x: number, y: number, name: string) => {
    const w = chipW(name, annot.scale);
    return {
      svg: `<rect x="${x}" y="${y}" width="${w}" height="${scaled(15)}" rx="${scaled(7.5)}" fill="${palette.chipFill}" stroke="${palette.chipStroke}"/>\n` +
        `<text x="${x + w / 2}" y="${y + scaled(11)}" font-size="${scaled(9.5)}" text-anchor="middle" fill="${palette.chipText}" font-weight="bold">${esc(name)}</text>\n`,
      w,
    };
  };
  const beginBand = (title: string) => {
    bandsSvg += `<line x1="20" y1="${bandY + 10}" x2="${scene.width - 20}" y2="${bandY + 10}" stroke="${palette.divider}" stroke-width="1"/>\n`;
    bandsSvg += `<text x="20" y="${bandY + scaled(32)}" font-size="${scaled(11)}" font-weight="bold" fill="${palette.bandTitle}">${esc(title)}</text>\n`;
    bandY += scaled(20);
  };

  // FLOWS band (numbered mode): number -> full description + chips.
  // Columns adapt to the diagram width, and each entry wraps to its column so
  // long labels (and manual \n breaks) stay readable — wide diagrams put the
  // second half of the list to the right instead of one tall column.
  const renderFlowsBand = () => {
    beginBand(ui.flows);
    const BADGE = scaled(34);        // badge + gap before the text
    const GUTTER = scaled(28);       // gutter between columns
    const LINE_H = scaled(13.5);     // line height inside the band
    const COL_TARGET = 520;          // desired column width (incl. badge)
    const avail = scene.width - contentX - 20;
    let cols = Math.max(1, Math.min(3, Math.floor((avail + GUTTER) / (COL_TARGET + GUTTER))));
    cols = Math.min(cols, model.flows.length);
    const colW = Math.floor((avail - (cols - 1) * GUTTER) / cols);

    // pre-wrap every entry to its column, honouring manual \n and chip width
    const entries = model.flows.map(flow => {
      const tech = techText(flow.tech);
      const chipsW = (flow.objects ?? []).reduce((sum, o) => sum + chipW(objectName.get(o.id) ?? o.id, annot.scale) + 4, 0);
      const textW = Math.max(60, colW - BADGE - (chipsW ? chipsW + 6 : 0));
      const maxChars = Math.max(6, Math.floor(textW / (scaled(10) * 0.52)));
      const raw = (flow.label ?? '') + (tech ? '  ' + tech : '');
      const lines = raw.split('\n').flatMap(segment => wrapText(segment, maxChars).split('\n'));
      return { flow, lines };
    });

    const rows = Math.ceil(entries.length / cols);
    const colY = new Array(cols).fill(bandY);
    entries.forEach((entry, i) => {
      const col = Math.floor(i / rows);
      const x = contentX + col * (colW + GUTTER);
      const y = colY[col];
      bandsSvg += `<rect x="${x}" y="${y}" width="${scaled(24)}" height="${scaled(15)}" rx="${scaled(7.5)}" fill="${palette.badgeFill}" stroke="${palette.badgeStroke}"/>\n`;
      bandsSvg += `<text x="${x + scaled(12)}" y="${y + scaled(11)}" font-size="${scaled(9.5)}" text-anchor="middle" fill="${palette.bandText}" font-weight="bold">${i + 1}</text>\n`;
      entry.lines.forEach((line, li) => {
        bandsSvg += `<text x="${x + BADGE}" y="${y + scaled(11) + li * LINE_H}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(line)}</text>\n`;
      });
      if (entry.flow.objects?.length) {
        const last = entry.lines[entry.lines.length - 1] ?? '';
        let cx = x + BADGE + Math.ceil(last.length * scaled(10) * 0.52) + 6;
        const cy = y + 1 + (entry.lines.length - 1) * LINE_H;
        for (const o of entry.flow.objects) { const c = chip(cx, cy, objectName.get(o.id) ?? o.id); bandsSvg += c.svg; cx += c.w + 4; }
      }
      colY[col] = y + Math.max(scaled(20), entry.lines.length * LINE_H + scaled(7));
    });
    bandY = Math.max(...colY) + 6;
  };

  const renderObjectsBand = () => {
    beginBand(ui.objects);
    for (const bo of model.businessObjects) {
      const c = chip(contentX, bandY + 2, bo.name);
      bandsSvg += c.svg;
      if (bo.description) bandsSvg += `<text x="${contentX + c.w + 10}" y="${bandY + scaled(13)}" font-size="${scaled(10)}" fill="${palette.bandMuted}">— ${esc(bo.description)}</text>\n`;
      bandY += scaled(24);
    }
    bandY += 6;
  };

  // LEGEND (auto from kinds used + flow/chip samples + custom notes)
  const renderLegendBand = () => {
    beginBand(ui.legend);
    let lx = contentX;
    // `actor` is normally keyed by the "Actor group" swatch; views that place
    // standalone actors (infrastructure) opt in via view.actorLegend to show a
    // person-glyph key so the user/consumer symbol is explained.
    const kindsUsed = [...new Set(scene.nodes.map(n => n.kind))]
      .filter(k => legendNames[k] && (k !== 'actor' || view.actorLegend));
    for (const kind of kindsUsed) {
      const s = resolveStyle(kind, '');
      if (kind === 'actor') {
        const stroke = s.stroke?.color ?? palette.actorStroke;
        bandsSvg += `<circle cx="${lx + scaled(13)}" cy="${bandY + scaled(5)}" r="${scaled(3)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>\n`;
        bandsSvg += `<path d="M ${lx + scaled(8)} ${bandY + scaled(15)} q ${scaled(5)} ${scaled(-7)} ${scaled(10)} 0" fill="none" stroke="${stroke}" stroke-width="1.2"/>\n`;
      } else {
        const dash = dashArray(s.stroke?.style);
        bandsSvg += `<rect x="${lx}" y="${bandY + 2}" width="${scaled(26)}" height="${scaled(14)}" rx="3" fill="${s.fill ?? palette.nodeFill}" stroke="${s.stroke?.color ?? palette.nodeStroke}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>\n`;
      }
      const name = legendNames[kind];
      bandsSvg += `<text x="${lx + scaled(32)}" y="${bandY + scaled(13)}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(name)}</text>\n`;
      lx += scaled(40) + Math.ceil(name.length * scaled(10) * 0.52) + scaled(24);
      if (lx > scene.width - 220) { lx = contentX; bandY += scaled(22); }
    }
    bandY += scaled(24);
    bandsSvg += `<line x1="${contentX}" y1="${bandY + 8}" x2="${contentX + scaled(26)}" y2="${bandY + 8}" stroke="${edgeColor}" stroke-width="1.3" marker-end="url(#${markerId(edgeColor)})"/>\n`;
    const flowLabelText = (numbered ? legendFlowLabel + ' — ' + ui.numberedSuffix : legendFlowLabel)
      + (style.flowColor === 'by-source' ? (style.lang === 'fr' ? ' — couleur = source' : ' — colour = source') : '');
    bandsSvg += `<text x="${contentX + scaled(32)}" y="${bandY + scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(flowLabelText)}</text>\n`;
    if (model.businessObjects.length) {
      const c = chip(contentX + 330, bandY + 1, ui.businessObject);
      bandsSvg += c.svg;
      bandsSvg += `<text x="${contentX + 330 + c.w + 8}" y="${bandY + scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}">${esc(ui.carriedByFlow)}</text>\n`;
    }
    bandY += scaled(24);
    for (const note of model.legendNotes) {
      bandsSvg += `<text x="${contentX}" y="${bandY + scaled(12)}" font-size="${scaled(10)}" fill="${palette.bandText}" font-style="italic">${esc(note)}</text>\n`;
      bandY += scaled(20);
    }
  };

  // ---- assemble the document ----
  let body = '';
  for (const n of scene.nodes) if (n.container) body += renderContainerNode(n);
  for (const n of scene.nodes) if (!n.container) body += renderLeafNode(n);
  for (const e of scene.edges) body += renderEdge(e);

  if (numbered && model.flows.length) renderFlowsBand();
  if (model.businessObjects.length) renderObjectsBand();
  if (style.legend === 'auto') renderLegendBand();

  const W = scene.width, H = scene.height;
  const totalH = bandY > H ? bandY + 14 : H;
  // `arrows: large` scales arrowheads with font-size; default stays 7.
  const markerSize = style.arrows === 'large' ? round1(11 * fonts.scale) : 7;
  if (arrowMarkers.size === 0) markerId(edgeColor); // ensure the base marker always exists
  const markers = [...arrowMarkers].map(([color, id]) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${markerSize}" markerHeight="${markerSize}" orient="auto-start-reverse">\n<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" font-family="${escAttr(style.font.family)},Arial,sans-serif">
<defs>${markers}</defs>
<rect width="${W}" height="${totalH}" fill="${style.background ?? palette.background}"/>\n` + body + bandsSvg + '</svg>\n';
  return { svg, overlapsBefore, overlapsAfter };
}
