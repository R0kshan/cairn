// Scene -> SVG with style resolution (view defaults < diagram style < inline)
// + label-overlap post-pass + optional edge-crossing hops.
// INVARIANT (§1.1): every flow is a distinct arrow with a distinct label. Never merged.

import type { Model, View, StyleProps, Flow } from './model.ts';
import { palettes, lightPalette, UI } from './model.ts';
import type { Scene, SceneLabel } from './layout.ts';
import { chipW, CHIP_H, measure, techText, wrapText, fontSizes } from './text.ts';

const HOP_R = 5;
const SEC_LEVEL_FR: Record<string, string> = { public: 'public', internal: 'interne', restricted: 'restreint', secret: 'secret' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dashArray = (style?: string) => style === 'dashed' ? '5 3' : style === 'dotted' ? '2 2.5' : undefined;

interface Box { x: number; y: number; w: number; h: number; }
const inter = (a: Box, b: Box) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

export interface RenderResult { svg: string; overlapsBefore: number; overlapsAfter: number; }

export function render(model: Model, view: View, scene: Scene): RenderResult {
  const ds = model.style;
  const F = fontSizes(ds.font.size);
  const { edge: FS_EDGE, node: FS_NODE, cont: FS_CONT } = F;
  // annotation sizes (tech tails, chips, tags, legend/registry bands) scale with
  // the base too; `.scale` is 1 at the default base so output stays identical.
  const r1 = (n: number) => Math.round(n * 10) / 10;   // 1-decimal, tidy SVG numbers
  const A = {
    tech: r1(F.tech), chip: r1(F.chip), tag: r1(F.tag), band: r1(F.band),
    bandTitle: r1(F.bandTitle), chipH: Math.round(F.chipH), scale: F.scale,
    chipRectH: Math.round(15 * F.scale), chipTextDy: r1(11 * F.scale),
  };
  // Below-canvas bands (FLOWS / BUSINESS OBJECTS / LEGEND) scale every metric —
  // fonts, row heights, offsets — by the same factor so they grow together.
  // At the default base, scale = 1 and bs(n) === n, so output is byte-identical.
  const bs = (n: number) => r1(n * F.scale);
  // Theme selects the chrome palette and the per-kind default fills/strokes.
  const pal = palettes[ds.theme] ?? lightPalette;
  const kindDefaults = ds.theme === 'dark' ? view.defaultsDark : view.defaults;
  // Default flow-stroke color follows the palette unless the author set one.
  const edge = ds.flowStrokeColorSet ? ds.flowStroke.color : pal.edge;
  const flowById = new Map<string, Flow>(model.flows.map(f => [f.id, f]));
  const boName = new Map(model.businessObjects.map(b => [b.id, b.name]));
  const numbered = ds.flowText === 'numbered';
  // Output localization (keywords stay English — decision D2).
  const t = UI[ds.lang] ?? UI.en;
  const legendNames = ds.lang === 'fr' ? view.legendNamesFr : view.legendNames;
  const legendFlowLabel = ds.lang === 'fr' ? view.legendFlowLabelFr : view.legendFlowLabel;
  const elStyle = new Map<string, StyleProps | undefined>();
  const elAttr = new Map<string, string | undefined>();
  (function walk(els) { for (const e of els) { elStyle.set(e.id, e.style); elAttr.set(e.id, e.attr?.value); walk(e.children); } })(model.elements);
  // security view: trust-zone base colors come from the sensitivity level, not the kind.
  const levelDefaults = ds.theme === 'dark' ? view.levelDefaultsDark : view.levelDefaults;

  const resolve = (kind: string, id: string): StyleProps => {
    let a = kindDefaults[kind] ?? {};
    const lvl = elAttr.get(id);
    if (kind === 'trust-zone' && lvl && levelDefaults?.[lvl]) a = levelDefaults[lvl];
    const b = ds.kind[kind] ?? {};
    const c = elStyle.get(id) ?? {};
    return {
      fill: c.fill ?? b.fill ?? a.fill,
      stroke: { ...a.stroke, ...b.stroke, ...c.stroke },
      text: c.text ?? b.text ?? a.text,
    };
  };

  // ---------- label placement (flow-label option) + overlap post-pass ----------
  const leafBoxes: Box[] = scene.nodes.filter(n => !n.container).map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const allLabels: SceneLabel[] = scene.edges.flatMap(e => e.labels);

  for (const l of allLabels) {
    const pos = flowById.get(l.flowId)?.style?.label ?? ds.flowLabel;
    if (pos === 'above') l.y -= l.h / 2 + 5;
    else if (pos === 'below') l.y += l.h / 2 + 5;
  }

  const boxes: Box[] = allLabels.map(l => l as Box);
  const countOverlaps = () => {
    let n = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) if (inter(boxes[i], boxes[j])) n++;
      for (const nb of leafBoxes) if (inter(boxes[i], nb)) n++;
    }
    return n;
  };
  const overlapsBefore = countOverlaps();
  for (const lb of allLabels) {
    const collides = () => boxes.some(o => o !== lb && inter(o, lb as Box)) || leafBoxes.some(nb => inter(nb, lb as Box));
    if (!collides()) continue;
    const y0 = lb.y, x0 = lb.x;
    let done = false;
    // search vertically first, then combined vertical+horizontal offsets
    outer: for (const dx of [0, -24, 24, -48, 48]) {
      for (const step of [0, 8, 14, 20, 28, 36, 44, 56, 70, 86]) {
        for (const dir of step === 0 ? [1] : [-1, 1]) {
          lb.y = y0 + dir * step; lb.x = x0 + dx;
          if (!collides()) { done = true; break outer; }
        }
      }
    }
    if (!done) { lb.x = x0; lb.y = y0; }
  }
  const overlapsAfter = countOverlaps();

  // ---------- crossing hops ----------
  const vSegs: { x: number; y1: number; y2: number }[] = [];
  if (ds.crossingHops) {
    for (const e of scene.edges) {
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        if (Math.abs(a.x - b.x) < 0.5) vSegs.push({ x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
      }
    }
  }
  function edgePath(pts: { x: number; y: number }[]): string {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (ds.crossingHops && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) {
        const dir = Math.sign(b.x - a.x);
        const lo = Math.min(a.x, b.x) + HOP_R + 1, hi = Math.max(a.x, b.x) - HOP_R - 1;
        const xs = vSegs
          .filter(v => v.x > lo && v.x < hi && a.y > v.y1 + 1 && a.y < v.y2 - 1)
          .map(v => v.x)
          .sort((p, q) => (dir > 0 ? p - q : q - p));
        for (const cx of xs) d += ` L ${cx - dir * HOP_R} ${a.y} A ${HOP_R} ${HOP_R} 0 0 ${dir > 0 ? 1 : 0} ${cx + dir * HOP_R} ${a.y}`;
      }
      d += ` L ${b.x} ${b.y}`;
    }
    return d;
  }

  // ---------- SVG body (header assembled at the end, once band height is known) ----------
  const W = scene.width, H = scene.height;
  const font = ds.font.family;
  let out = '';

  for (const n of scene.nodes.filter(n => n.container)) {
    const s = resolve(n.kind, n.id);
    const da = dashArray(s.stroke?.style);
    out += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${s.fill ?? pal.containerFill}" stroke="${s.stroke?.color ?? pal.containerStroke}" stroke-width="${s.stroke?.width ?? 1.2}"${da ? ` stroke-dasharray="${da}"` : ''}/>\n`;
    n.label.split('\n').forEach((line, i) => {
      out += `<text x="${n.x + 10}" y="${n.y + 18 + i * 14}" font-size="${FS_CONT}" font-weight="bold" fill="${s.text ?? pal.containerLabel}">${esc(line)}</text>\n`;
    });
    // security view: sensitivity level tag, bottom-right of the trust zone
    // (inside the bottom padding — clear of the title and of child nodes)
    const lvl = n.kind === 'trust-zone' ? elAttr.get(n.id) : undefined;
    if (lvl) {
      const word = (ds.lang === 'fr' ? SEC_LEVEL_FR[lvl] : lvl) ?? lvl;
      out += `<text x="${n.x + n.w - 9}" y="${n.y + n.h - 6}" font-size="${A.tag}" text-anchor="end" font-weight="bold" fill="${s.stroke?.color ?? pal.containerStroke}" letter-spacing="0.5">${esc(word.toUpperCase())}</text>\n`;
    }
  }
  for (const n of scene.nodes.filter(n => !n.container)) {
    const s = resolve(n.kind, n.id);
    const lines = n.label.split('\n');
    if (n.kind === 'actor') {
      const cx = n.x + n.w / 2;
      const ac = s.stroke?.color ?? pal.actorStroke;
      out += `<circle cx="${cx}" cy="${n.y + 10}" r="7" fill="none" stroke="${ac}" stroke-width="1.5"/>
<path d="M ${cx - 11} ${n.y + 32} q 11 -19 22 0" fill="none" stroke="${ac}" stroke-width="1.5"/>\n`;
      lines.forEach((l, i) => {
        out += `<text x="${cx}" y="${n.y + 44 + i * 11}" font-size="${FS_NODE - 1.5}" text-anchor="middle" fill="${s.text ?? pal.actorText}">${esc(l)}</text>\n`;
      });
    } else if (n.kind === 'datastore') {
      // cylinder
      const ry = 7, c = s.stroke?.color ?? pal.nodeStroke, f = s.fill ?? pal.nodeFill;
      out += `<path d="M ${n.x} ${n.y + ry} v ${n.h - 2 * ry} a ${n.w / 2} ${ry} 0 0 0 ${n.w} 0 v ${-(n.h - 2 * ry)}" fill="${f}" stroke="${c}" stroke-width="1.3"/>\n`;
      out += `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + ry}" rx="${n.w / 2}" ry="${ry}" fill="${f}" stroke="${c}" stroke-width="1.3"/>\n`;
      const cy = n.y + ry + (n.h - ry) / 2 - ((lines.length - 1) * (FS_NODE + 2)) / 2 + 4;
      lines.forEach((l, i) => {
        out += `<text x="${n.x + n.w / 2}" y="${cy + i * (FS_NODE + 2)}" font-size="${FS_NODE}" text-anchor="middle" fill="${s.text ?? pal.nodeText}">${esc(l)}</text>\n`;
      });
    } else {
      const da = dashArray(s.stroke?.style);
      out += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${s.fill ?? pal.nodeFill}" stroke="${s.stroke?.color ?? pal.nodeStroke}" stroke-width="${s.stroke?.width ?? 1.3}"${da ? ` stroke-dasharray="${da}"` : ''}/>\n`;
      const cy = n.y + n.h / 2 - ((lines.length - 1) * (FS_NODE + 2)) / 2 + 4;
      lines.forEach((l, i) => {
        out += `<text x="${n.x + n.w / 2}" y="${cy + i * (FS_NODE + 2)}" font-size="${FS_NODE}" text-anchor="middle" fill="${s.text ?? pal.nodeText}">${esc(l)}</text>\n`;
      });
    }
  }
  for (const e of scene.edges) {
    const fst = flowById.get(e.id)?.style;
    const color = fst?.stroke?.color ?? edge;
    const style = fst?.stroke?.style ?? ds.flowStroke.style;
    const width = fst?.stroke?.width ?? ds.flowStroke.width;
    const da = dashArray(style);
    if (e.pts.length) {
      out += `<path d="${edgePath(e.pts)}" fill="none" stroke="${color}" stroke-width="${width}"${da ? ` stroke-dasharray="${da}"` : ''} marker-end="url(#arr)"/>\n`;
    }
    for (const l of e.labels) {
      if (numbered) {
        // number badge — full text lives in the FLOWS band below
        out += `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.h / 2}" fill="${pal.badgeFill}" stroke="${pal.badgeStroke}" stroke-width="1"/>\n`;
        out += `<text x="${l.x + l.w / 2}" y="${l.y + l.h * 12.5 / 17}" font-size="${bs(10)}" text-anchor="middle" fill="${pal.bandText}" font-weight="bold">${esc(l.text)}</text>\n`;
        continue;
      }
      // Transparent background: a thin halo (background color) on the glyphs
      // keeps text legible where it crosses a line, without masking fills.
      const lines = l.text ? l.text.split('\n') : [];
      const labelColor = fst?.text ?? pal.edgeLabel;
      lines.forEach((line, i) => {
        out += `<text x="${l.x + l.w / 2}" y="${l.y + FS_EDGE + 1 + i * (FS_EDGE + 3)}" font-size="${FS_EDGE}" text-anchor="middle" fill="${labelColor}" font-style="italic" stroke="${pal.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">${esc(line)}</text>\n`;
      });
      // technical sub-line (protocol, format) — space reserved at layout time
      const tech = techText(flowById.get(l.flowId)?.tech);
      if (tech) {
        out += `<text x="${l.x + l.w / 2}" y="${l.y + FS_EDGE + 1 + lines.length * (FS_EDGE + 3)}" font-size="${A.tech}" text-anchor="middle" fill="${pal.techText}" stroke="${pal.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">${esc(tech)}</text>\n`;
      }
      // business-object chips (space already reserved at layout time)
      const chips = (flowById.get(l.flowId)?.objects ?? []).map(o => boName.get(o.id) ?? o.id);
      if (chips.length) {
        const totalW = chips.reduce((s, n) => s + chipW(n, A.scale) + 4, -4);
        let cx = l.x + l.w / 2 - totalW / 2;
        const cy = l.y + l.h - A.chipH + 2;
        for (const name of chips) {
          const w = chipW(name, A.scale);
          out += `<rect x="${cx}" y="${cy}" width="${w}" height="${A.chipRectH}" rx="${A.chipRectH / 2}" fill="${pal.chipFill}" stroke="${pal.chipStroke}" stroke-width="1"/>\n`;
          out += `<text x="${cx + w / 2}" y="${cy + A.chipTextDy}" font-size="${A.chip}" text-anchor="middle" fill="${pal.chipText}" font-weight="bold">${esc(name)}</text>\n`;
          cx += w + 4;
        }
      }
    }
  }

  // ---------- bands below the canvas (zero impact on layout & fit metric) ----------
  let by = H;
  let bands = '';
  const chip = (x: number, y: number, name: string) => {
    const w = chipW(name, A.scale);
    return {
      svg: `<rect x="${x}" y="${y}" width="${w}" height="${bs(15)}" rx="${bs(7.5)}" fill="${pal.chipFill}" stroke="${pal.chipStroke}"/>\n` +
        `<text x="${x + w / 2}" y="${y + bs(11)}" font-size="${bs(9.5)}" text-anchor="middle" fill="${pal.chipText}" font-weight="bold">${esc(name)}</text>\n`,
      w,
    };
  };
  const bandStart = (title: string) => {
    bands += `<line x1="20" y1="${by + 10}" x2="${W - 20}" y2="${by + 10}" stroke="${pal.divider}" stroke-width="1"/>\n`;
    bands += `<text x="20" y="${by + bs(32)}" font-size="${bs(11)}" font-weight="bold" fill="${pal.bandTitle}">${esc(title)}</text>\n`;
    by += bs(20);
  };
  const contentX = 150;

  // FLOWS band (numbered mode): number -> full description + chips.
  // Columns adapt to the diagram width, and each entry wraps to its column so
  // long labels (and manual \n breaks) stay readable — wide diagrams put the
  // second half of the list to the right instead of one tall column.
  if (numbered && model.flows.length) {
    bandStart(t.flows);
    const BADGE = bs(34);        // badge + gap before the text
    const GUT = bs(28);          // gutter between columns
    const LH = bs(13.5);         // line height inside the band
    const COL_TARGET = 520;      // desired column width (incl. badge)
    const avail = W - contentX - 20;
    let cols = Math.max(1, Math.min(3, Math.floor((avail + GUT) / (COL_TARGET + GUT))));
    cols = Math.min(cols, model.flows.length);
    const colW = Math.floor((avail - (cols - 1) * GUT) / cols);

    // pre-wrap every entry to its column, honouring manual \n and chip width
    const entries = model.flows.map(f => {
      const tech = techText(f.tech);
      const chipsW = (f.objects ?? []).reduce((s, o) => s + chipW(boName.get(o.id) ?? o.id, A.scale) + 4, 0);
      const textW = Math.max(60, colW - BADGE - (chipsW ? chipsW + 6 : 0));
      const maxChars = Math.max(6, Math.floor(textW / (bs(10) * 0.52)));
      const raw = (f.label ?? '') + (tech ? '  ' + tech : '');
      const lines = raw.split('\n').flatMap(seg => wrapText(seg, maxChars).split('\n'));
      return { f, lines };
    });

    const rows = Math.ceil(entries.length / cols);
    const yBase = by;
    const colY = new Array(cols).fill(yBase);
    entries.forEach((e, i) => {
      const col = Math.floor(i / rows);
      const x = contentX + col * (colW + GUT);
      const y = colY[col];
      bands += `<rect x="${x}" y="${y}" width="${bs(24)}" height="${bs(15)}" rx="${bs(7.5)}" fill="${pal.badgeFill}" stroke="${pal.badgeStroke}"/>\n`;
      bands += `<text x="${x + bs(12)}" y="${y + bs(11)}" font-size="${bs(9.5)}" text-anchor="middle" fill="${pal.bandText}" font-weight="bold">${i + 1}</text>\n`;
      e.lines.forEach((line, li) => {
        bands += `<text x="${x + BADGE}" y="${y + bs(11) + li * LH}" font-size="${bs(10)}" fill="${pal.bandText}">${esc(line)}</text>\n`;
      });
      if (e.f.objects?.length) {
        const last = e.lines[e.lines.length - 1] ?? '';
        let cx = x + BADGE + Math.ceil(last.length * bs(10) * 0.52) + 6;
        const cy = y + 1 + (e.lines.length - 1) * LH;
        for (const o of e.f.objects) { const c = chip(cx, cy, boName.get(o.id) ?? o.id); bands += c.svg; cx += c.w + 4; }
      }
      colY[col] = y + Math.max(bs(20), e.lines.length * LH + bs(7));
    });
    by = Math.max(...colY) + 6;
  }

  // BUSINESS OBJECTS registry
  if (model.businessObjects.length) {
    bandStart(t.objects);
    for (const b of model.businessObjects) {
      const c = chip(contentX, by + 2, b.name);
      bands += c.svg;
      if (b.description) bands += `<text x="${contentX + c.w + 10}" y="${by + bs(13)}" font-size="${bs(10)}" fill="${pal.bandMuted}">— ${esc(b.description)}</text>\n`;
      by += bs(24);
    }
    by += 6;
  }

  // LEGEND (auto from kinds used + flow/chip samples + custom notes)
  if (ds.legend === 'auto') {
    bandStart(t.legend);
    let lx = contentX;
    // `actor` is normally keyed by the "Actor group" swatch; views that place
    // standalone actors (infrastructure) opt in via view.actorLegend to show a
    // person-glyph key so the user/consumer symbol is explained.
    const kindsUsed = [...new Set(scene.nodes.map(n => n.kind))]
      .filter(k => legendNames[k] && (k !== 'actor' || view.actorLegend));
    for (const k of kindsUsed) {
      const s = resolve(k, '');
      if (k === 'actor') {
        const ac = s.stroke?.color ?? pal.actorStroke;
        bands += `<circle cx="${lx + bs(13)}" cy="${by + bs(5)}" r="${bs(3)}" fill="none" stroke="${ac}" stroke-width="1.2"/>\n`;
        bands += `<path d="M ${lx + bs(8)} ${by + bs(15)} q ${bs(5)} ${bs(-7)} ${bs(10)} 0" fill="none" stroke="${ac}" stroke-width="1.2"/>\n`;
      } else {
        const da = dashArray(s.stroke?.style);
        bands += `<rect x="${lx}" y="${by + 2}" width="${bs(26)}" height="${bs(14)}" rx="3" fill="${s.fill ?? pal.nodeFill}" stroke="${s.stroke?.color ?? pal.nodeStroke}"${da ? ` stroke-dasharray="${da}"` : ''}/>\n`;
      }
      const name = legendNames[k];
      bands += `<text x="${lx + bs(32)}" y="${by + bs(13)}" font-size="${bs(10)}" fill="${pal.bandText}">${esc(name)}</text>\n`;
      lx += bs(40) + Math.ceil(name.length * bs(10) * 0.52) + bs(24);
      if (lx > W - 220) { lx = contentX; by += bs(22); }
    }
    by += bs(24);
    bands += `<line x1="${contentX}" y1="${by + 8}" x2="${contentX + bs(26)}" y2="${by + 8}" stroke="${edge}" stroke-width="1.3" marker-end="url(#arr)"/>\n`;
    bands += `<text x="${contentX + bs(32)}" y="${by + bs(12)}" font-size="${bs(10)}" fill="${pal.bandText}">${esc(numbered ? legendFlowLabel + ' — ' + t.numberedSuffix : legendFlowLabel)}</text>\n`;
    if (model.businessObjects.length) {
      const c = chip(contentX + 330, by + 1, t.businessObject);
      bands += c.svg;
      bands += `<text x="${contentX + 330 + c.w + 8}" y="${by + bs(12)}" font-size="${bs(10)}" fill="${pal.bandText}">${esc(t.carriedByFlow)}</text>\n`;
    }
    by += bs(24);
    for (const note of model.legendNotes) {
      bands += `<text x="${contentX}" y="${by + bs(12)}" font-size="${bs(10)}" fill="${pal.bandText}" font-style="italic">${esc(note)}</text>\n`;
      by += bs(20);
    }
  }

  const totalH = by > H ? by + 14 : H;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" font-family="${esc(font)},Arial,sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="${edge}"/></marker></defs>
<rect width="${W}" height="${totalH}" fill="${ds.background ?? pal.background}"/>\n` + out + bands + '</svg>\n';
  return { svg, overlapsBefore, overlapsAfter };
}
