// Folded composite layout (slide mode): each middle system is laid out
// independently by ELK, systems are stacked as ROWS in a middle column,
// actor-groups form a left column, externals a right column. Inter-group
// flows are routed through gutters via phantom ports so they exit/enter
// groups on clean, ELK-routed internal segments.
//
// Row gaps are sized from measured gutter demand BEFORE placement, so trunk
// lanes can never overflow into a system box. Lane allocation uses interval
// coloring: overlapping spans never share a lane.

import type { Model, Element, View } from './model.ts';
import type { Scene, SceneNode, SceneEdge, SceneLabel } from './layout.ts';
import { measure, wrapText, nodeSize, flowLabelBox, techText, fontSizes } from './text.ts';

const PAD_TOP = 30, PAD = 12;
const LANE_STEP = 10;   // horizontal spacing of vertical lanes
const LANE_V = 11;      // vertical spacing of horizontal gutter lanes
const LABEL_WRAP = 16;

interface Box { x: number; y: number; w: number; h: number; }
interface Pt { x: number; y: number; }

class LaneAlloc {
  lanes: { a: number; b: number }[][] = [];
  alloc(a: number, b: number): number {
    const lo = Math.min(a, b) - 4, hi = Math.max(a, b) + 4;
    for (let i = 0; i < this.lanes.length; i++) {
      if (!this.lanes[i].some(iv => iv.a < hi && lo < iv.b)) { this.lanes[i].push({ a: lo, b: hi }); return i; }
    }
    this.lanes.push([{ a: lo, b: hi }]);
    return this.lanes.length - 1;
  }
}

export async function foldedLayout(model: Model, view: View, elk: any): Promise<Scene | null> {
  const roots = model.elements;
  const boName = new Map(model.businessObjects.map(b => [b.id, b.name]));
  const numbered = model.style.flowText === 'numbered';
  const { edge: FS_EDGE, node: FS_NODE, cont: FS_CONT, scale: FS_SCALE } = fontSizes(model.style.font.size);
  const chipsOf = (f: { objects?: { id: string }[] }) => numbered ? [] : (f.objects ?? []).map(o => boName.get(o.id) ?? o.id);
  const numLabel = (f: { id: string }) => ({ text: String(parseInt(f.id.slice(1), 10)), width: Math.round(26 * FS_SCALE), height: Math.round(17 * FS_SCALE) });
  const part = (e: Element) => view.partitions[e.kind] ?? 1;
  const sources = roots.filter(e => part(e) === 0);
  const middles = roots.filter(e => part(e) === 1);
  const sinks = roots.filter(e => part(e) === 2);
  if (view.partitionByOrder) return null; // declaration-order banding (infra) has no source/middle/sink split
  const middleGroups = middles.filter(m => m.children.length > 0);
  if (middleGroups.length < 2) return null; // fold pays off only with several systems

  const topOf = new Map<string, Element>();
  for (const r of roots) (function mark(e: Element) { topOf.set(e.id, r); e.children.forEach(mark); })(r);

  const interFlows = model.flows.filter(f => {
    const a = topOf.get(f.from), b = topOf.get(f.to);
    return a && b && a !== b;
  });
  const internalFlows = model.flows.filter(f => topOf.get(f.from) && topOf.get(f.from) === topOf.get(f.to));

  const elByid = new Map<string, Element>();
  (function idx(els: Element[]) { for (const e of els) { elByid.set(e.id, e); idx(e.children); } })(roots);

  // ---------- 1. internal ELK layout per middle group (with phantom ports) ----------
  function toElkNode(e: Element): any {
    if (e.children.length) {
      const nLines = (e.label ?? e.id).split('\n').length;
      return {
        id: e.id,
        layoutOptions: { 'elk.padding': `[top=${17 + nLines * 13},left=${PAD},bottom=${PAD},right=${PAD}]` },
        labels: [{ text: e.label ?? e.id, ...measure(e.label ?? e.id, FS_CONT) }],
        children: e.children.map(toElkNode),
      };
    }
    const s = nodeSize(e.kind, e.label ?? e.id, FS_NODE);
    return { id: e.id, width: s.w, height: s.h };
  }

  const middleResults = new Map<string, any>();
  for (const sys of middleGroups) {
    const node = toElkNode(sys);
    for (const f of interFlows) {
      if (topOf.get(f.from) === sys) node.children.push({ id: `${f.id}_out`, width: 1, height: 1, layoutOptions: { 'elk.layered.layering.layerConstraint': 'LAST' } });
      if (topOf.get(f.to) === sys) node.children.push({ id: `${f.id}_in`, width: 1, height: 1, layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } });
    }
    const graph = {
      id: `fold_${sys.id}`,
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'RIGHT',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': '36', 'elk.spacing.nodeNode': '14',
        'elk.spacing.edgeEdge': '10', 'elk.spacing.edgeNode': '11', 'elk.spacing.edgeLabel': '3',
        'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN', 'elk.edgeLabels.placement': 'CENTER',
      },
      children: [node],
      edges: [
        ...internalFlows.filter(f => topOf.get(f.from) === sys).map(f => {
          if (numbered) return { id: f.id, sources: [f.from], targets: [f.to], labels: [numLabel(f)] };
          // No prose label → the protocol tail becomes the label (see layout.ts).
          const text = f.label ? wrapText(f.label, LABEL_WRAP + 4) : techText(f.tech);
          const chips = chipsOf(f);
          return { id: f.id, sources: [f.from], targets: [f.to], labels: text || chips.length ? [{ text, ...flowLabelBox(text, chips, FS_EDGE, undefined, FS_SCALE) }] : [] };
        }),
        ...interFlows.filter(f => topOf.get(f.from) === sys).map(f => ({ id: `${f.id}_oe`, sources: [f.from], targets: [`${f.id}_out`] })),
        ...interFlows.filter(f => topOf.get(f.to) === sys).map(f => ({ id: `${f.id}_ie`, sources: [`${f.id}_in`], targets: [f.to] })),
      ],
    };
    middleResults.set(sys.id, await elk.layout(graph));
  }

  // ---------- 2. self-laid source/sink columns ----------
  interface ColGroup { el: Element; w: number; h: number; blocks: { el: Element; x: number; y: number; w: number; h: number }[]; }
  const layoutColumn = (groups: Element[]): ColGroup[] => groups.map(g => {
    const blocks = g.children.map(c => ({ el: c, ...nodeSize(c.kind, c.label ?? c.id, FS_NODE), x: 0, y: 0 }));
    const w = Math.max(measure(g.label ?? g.id, FS_CONT).width + 20, ...blocks.map(b => b.w)) + 2 * PAD;
    let y = PAD_TOP;
    for (const b of blocks) { b.x = PAD + (w - 2 * PAD - b.w) / 2; b.y = y; y += b.h + 14; }
    return { el: g, w, h: y - 14 + PAD, blocks };
  });
  const srcCols = layoutColumn(sources);
  const sinkCols = layoutColumn(sinks);

  // ---------- 3. classify flows & measure gutter demand ----------
  const rowIdx = new Map(middles.map((m, i) => [m.id, i]));
  type Cls = 'A' | 'B' | 'C' | 'D' | 'E' | 'X';
  const classify = (f: (typeof interFlows)[number]): { cls: Cls; gutter?: number } => {
    const sp = part(topOf.get(f.from)!), dp = part(topOf.get(f.to)!);
    if (sp === 0 && dp === 1) return { cls: 'A' };
    if (sp === 1 && dp === 2) return { cls: 'B' };
    if (sp === 1 && dp === 1) {
      const si = rowIdx.get(topOf.get(f.from)!.id)!, di = rowIdx.get(topOf.get(f.to)!.id)!;
      return { cls: 'C', gutter: di > si ? di : di + 1 };
    }
    if (sp === 2 && dp === 1) return { cls: 'D', gutter: rowIdx.get(topOf.get(f.to)!.id)! };
    if (sp === 1 && dp === 0) return { cls: 'E', gutter: rowIdx.get(topOf.get(f.from)!.id)! };
    return { cls: 'X' };
  };
  const classified = interFlows.map(f => ({ f, ...classify(f) }));

  // demand per horizontal gutter g (g = "above row g", g in 0..rows.length)
  const gDemand: number[] = Array(middles.length + 1).fill(0);
  for (const c of classified) if (c.gutter !== undefined) gDemand[c.gutter]++;

  // ---------- 4. compose geometry ----------
  const nLeft = classified.filter(c => 'ACDE'.includes(c.cls)).length;
  const nRight = classified.filter(c => 'BCDE'.includes(c.cls)).length;
  const LABEL_W = 118;
  const wLG = 28 + Math.min(Math.ceil(nLeft / 2), 10) * LANE_STEP + LABEL_W;
  const wRG = 28 + Math.min(Math.ceil(nRight / 2), 10) * LANE_STEP + LABEL_W;

  const wSrc = Math.max(0, ...srcCols.map(c => c.w));
  const midW = (m: Element) => m.children.length
    ? middleResults.get(m.id)!.children[0].width
    : nodeSize(m.kind, m.label ?? m.id, FS_NODE).w;
  const wMid = Math.max(...middles.map(midW));
  const wSink = Math.max(0, ...sinkCols.map(c => c.w));

  const xSrc = 10;
  const xLG = xSrc + wSrc + 10;
  const xMid = xLG + wLG;
  const xRG = xMid + wMid + 10;
  const xSink = xRG + wRG;

  // gutter = [label zone: 2 rows of staggered labels][lane zone: demand * LANE_V]
  // label rows grow when business-object chips ride under gutter labels
  const hasChips = interFlows.some(f => f.objects?.length);
  const LABEL_ROW = hasChips ? 48 : 29;
  const LABEL_ZONE = 4 + 2 * LABEL_ROW;
  const gutterHeight = (g: number) => 14 + gDemand[g] * LANE_V + (gDemand[g] ? LABEL_ZONE : 0);
  const rows: { el: Element; box: Box; res: any | null }[] = [];
  let yCur = 16 + gutterHeight(0);
  middles.forEach((m, i) => {
    const res = middleResults.get(m.id) ?? null;
    const size = res
      ? { w: res.children[0].width, h: res.children[0].height }
      : (() => { const s = nodeSize(m.kind, m.label ?? m.id, FS_NODE); return { w: s.w, h: s.h }; })();
    rows.push({ el: m, box: { x: xMid, y: yCur, w: size.w, h: size.h }, res });
    yCur += size.h + Math.max(40, gutterHeight(i + 1));
  });
  const midH = yCur - Math.max(40, gutterHeight(middles.length));

  const placeCol = (cols: ColGroup[], x: number): { g: ColGroup; box: Box }[] => {
    const total = cols.reduce((s, c) => s + c.h, 0) + (cols.length - 1) * 30;
    let y = Math.max(20, 20 + (midH - total) / 2);
    return cols.map(c => { const b = { x, y, w: c.w, h: c.h }; y += c.h + 30; return { g: c, box: b }; });
  };
  const srcPlaced = placeCol(srcCols, xSrc);
  const sinkPlaced = placeCol(sinkCols, xSink);

  // ---------- 5. scene nodes ----------
  const nodes: SceneNode[] = [];
  const absBox = new Map<string, Box>();
  const pushCol = (placed: { g: ColGroup; box: Box }[]) => {
    for (const { g, box } of placed) {
      nodes.push({ id: g.el.id, kind: g.el.kind, label: g.el.label ?? g.el.id, ...box, container: true } as any);
      absBox.set(g.el.id, box);
      for (const b of g.blocks) {
        const nb = { x: box.x + b.x, y: box.y + b.y, w: b.w, h: b.h };
        nodes.push({ id: b.el.id, kind: b.el.kind, label: b.el.label ?? b.el.id, ...nb, container: false } as any);
        absBox.set(b.el.id, nb);
      }
    }
  };
  pushCol(srcPlaced); pushCol(sinkPlaced);

  const portAbs = new Map<string, Pt>();
  const origins = new Map<string, Pt>(); // container id -> absolute origin (for edge coordinate frames)
  for (const { el, box, res } of rows) {
    if (!res) { // leaf middle (root datastore/external in middle band)
      nodes.push({ id: el.id, kind: el.kind, label: el.label ?? el.id, ...box, container: false } as any);
      absBox.set(el.id, box);
      continue;
    }
    const rootOff = { x: box.x - res.children[0].x, y: box.y - res.children[0].y };
    origins.set(res.id, rootOff);
    (function walk(n: any, ox: number, oy: number) {
      for (const c of n.children ?? []) {
        const ax = ox + c.x, ay = oy + c.y;
        origins.set(c.id, { x: ax, y: ay });
        if (/_in$|_out$/.test(c.id)) { portAbs.set(c.id, { x: ax, y: ay }); continue; }
        const el = elByid.get(c.id)!;
        const b = { x: ax, y: ay, w: c.width, h: c.height };
        nodes.push({ id: c.id, kind: el.kind, label: el.label ?? c.id, ...b, container: !!(c.children?.length) } as any);
        absBox.set(c.id, b);
        walk(c, ax, ay);
      }
    })(res, rootOff.x, rootOff.y);
  }

  // ---------- 6. edges ----------
  const edges: SceneEdge[] = [];
  const edgePts = new Map<string, Pt[]>();
  for (const { box, res } of rows) {
    if (!res) continue;
    const rootOff = { x: box.x - res.children[0].x, y: box.y - res.children[0].y };
    (function collect(n: any) {
      for (const e of n.edges ?? []) {
        const s = e.sections?.[0];
        if (!s) continue;
        const o = (e.container && origins.get(e.container)) || rootOff;
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: any) => ({ x: p.x + o.x, y: p.y + o.y }));
        if (/_oe$|_ie$/.test(e.id)) { edgePts.set(e.id, pts); continue; }
        const labels = (e.labels ?? []).map((l: any) => ({ flowId: e.id, text: l.text, x: l.x + o.x, y: l.y + o.y, w: l.width, h: l.height }));
        edges.push({ id: e.id, pts, labels });
      }
      (n.children ?? []).forEach(collect);
    })(res);
  }

  const allocL = new LaneAlloc(), allocR = new LaneAlloc();
  const gAllocs = gDemand.map(() => new LaneAlloc());
  const laneLX = (y1: number, y2: number) => xLG + 14 + allocL.alloc(y1, y2) * LANE_STEP;
  const laneRX = (y1: number, y2: number) => xRG + 14 + allocR.alloc(y1, y2) * LANE_STEP;
  const gutterInfo = (g: number, x1: number, x2: number) => {
    const top = g === 0 ? 14 : rows[g - 1].box.y + rows[g - 1].box.h + 10;
    const k = gAllocs[g].alloc(x1, x2);
    return { y: top + LABEL_ZONE + k * LANE_V, k, labelY: top + 2 + (k % 2) * LABEL_ROW };
  };
  const sideMid = (b: Box, side: 'left' | 'right'): Pt => ({ x: side === 'left' ? b.x : b.x + b.w, y: b.y + b.h / 2 });

  for (const { f, cls, gutter } of classified) {
    const srcTop = topOf.get(f.from)!, dstTop = topOf.get(f.to)!;
    const out = portAbs.get(`${f.id}_out`);
    const inp = portAbs.get(`${f.id}_in`);
    const srcPt = out ?? sideMid(absBox.get(f.from) ?? absBox.get(srcTop.id)!, 'right');
    const dstPt = inp ?? sideMid(absBox.get(f.to) ?? absBox.get(dstTop.id)!, 'left');
    const pre = edgePts.get(`${f.id}_oe`) ?? [];
    const post = edgePts.get(`${f.id}_ie`) ?? [];
    const pts: Pt[] = [];
    let laneK = 0, gy = 0, gLabelY = 0;

    if (cls === 'A') {
      const lx = laneLX(srcPt.y, dstPt.y);
      pts.push(srcPt, { x: lx, y: srcPt.y }, { x: lx, y: dstPt.y }, dstPt);
    } else if (cls === 'B') {
      const rx = laneRX(srcPt.y, dstPt.y);
      pts.push(srcPt, { x: rx, y: srcPt.y }, { x: rx, y: dstPt.y }, dstPt);
    } else if (cls === 'C' || cls === 'D' || cls === 'E') {
      const g = gutter!;
      const start: Pt = cls === 'D' ? sideMid(absBox.get(f.from) ?? absBox.get(srcTop.id)!, 'left') : srcPt;
      const gi = gutterInfo(g, xLG, cls === 'D' ? xSink : xRG + 120);
      gy = gi.y; laneK = gi.k; gLabelY = gi.labelY;
      const rx = laneRX(start.y, gy), lx = laneLX(gy, dstPt.y);
      pts.push(start, { x: rx, y: start.y }, { x: rx, y: gy }, { x: lx, y: gy }, { x: lx, y: dstPt.y }, dstPt);
    } else {
      const lx = laneLX(srcPt.y, dstPt.y);
      pts.push(srcPt, { x: lx, y: srcPt.y }, { x: lx, y: dstPt.y }, dstPt);
    }

    const merged = [...pre, ...pts, ...post];
    // Label placement, readability-first:
    //  - gutter routes: above the horizontal gutter segment, staggered along x
    //    by lane index so labels in the same gutter never start stacked
    //  - direct routes: pinned above the final approach segment (target end)
    let label: SceneLabel | undefined;
    const chips = chipsOf(f);
    const text = numbered ? numLabel(f).text : (f.label ? wrapText(f.label, LABEL_WRAP) : (techText(f.tech) || (chips.length ? '' : undefined)));
    if (text !== undefined) {
      const m = numbered ? { width: Math.round(26 * FS_SCALE), height: Math.round(17 * FS_SCALE) } : flowLabelBox(text, chips, FS_EDGE, undefined, FS_SCALE);
      if (pts.length >= 6) {
        const segL = Math.min(pts[2].x, pts[3].x), segR = Math.max(pts[2].x, pts[3].x);
        const span = Math.max(40, segR - segL - m.width - 20);
        const cx = segL + 10 + ((laneK * 173) % span);
        label = { flowId: f.id, text, x: cx, y: gLabelY, w: m.width, h: m.height };
      } else {
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        label = { flowId: f.id, text, x: (a.x + b.x) / 2 - m.width / 2, y: b.y - m.height - 4, w: m.width, h: m.height };
      }
    }
    edges.push({ id: f.id, pts: merged, labels: label ? [label] : [] });
  }

  const W = Math.ceil(xSink + wSink + 10);
  const H = Math.ceil(Math.max(midH + 30, ...sinkPlaced.map(p => p.box.y + p.box.h + 20), ...srcPlaced.map(p => p.box.y + p.box.h + 20)));
  return { width: W, height: H, nodes, edges, layoutMs: 0 };
}
