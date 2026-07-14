// Model -> ELK constraint compilation -> absolute-coordinate scene.
// Ported from the phase 0 spike; view conventions drive the ELK options.

import type { Model, Element, View } from './model.ts';
import { measure, wrapText, flowLabelBox, techText } from './text.ts';
import { foldedLayout } from './fold.ts';
import { getElk } from './elk.ts';

const FS_EDGE = 10.5, FS_NODE = 11.5, FS_CONT = 12;

export interface SceneNode { id: string; kind: string; label: string; x: number; y: number; w: number; h: number; container: boolean; }
export interface SceneLabel { flowId: string; text: string; x: number; y: number; w: number; h: number; }
export interface SceneEdge { id: string; pts: { x: number; y: number }[]; labels: SceneLabel[]; }
export interface Scene { width: number; height: number; nodes: SceneNode[]; edges: SceneEdge[]; layoutMs: number; }

export async function layout(model: Model, view: View): Promise<Scene> {
  const elk = await getElk();
  const boName = new Map(model.businessObjects.map(b => [b.id, b.name]));
  const numbered = model.style.flowText === 'numbered';

  function toElkNode(e: Element): any {
    if (e.children.length) {
      const nLines = (e.label ?? e.id).split('\n').length;
      return {
        id: e.id,
        layoutOptions: { 'elk.padding': `[top=${17 + nLines * 13},left=12,bottom=12,right=12]` },
        labels: [{ text: e.label ?? e.id, ...measure(e.label ?? e.id, FS_CONT) }],
        children: e.children.map(toElkNode),
      };
    }
    const m = measure(e.label ?? e.id, FS_NODE);
    const isActor = e.kind === 'actor';
    return {
      id: e.id,
      width: isActor ? Math.max(64, measure(e.label ?? e.id, FS_NODE - 1.5).width + 8) : Math.max(140, m.width + 16),
      height: isActor ? 56 + ((e.label ?? e.id).split('\n').length - 1) * 11 : Math.max(46, m.height + 18),
    };
  }

  // disposition -> direction; balanced modes (slide/page) try both directions
  // and keep the result closest to the target ratio (ELK's wrapping doesn't
  // operate under INCLUDE_CHILDREN, so exact ratio targeting is unavailable).
  const disp = model.style.disposition;
  const TARGETS: Record<string, number | undefined> = { slide: 16 / 9, page: 0.71 };
  const target = TARGETS[disp];

  const makeGraph = (direction: 'RIGHT' | 'DOWN', opts?: { labelWrap?: number; tight?: boolean; minLayers?: boolean }) => ({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      ...(opts?.tight ? {
        'elk.layered.spacing.nodeNodeBetweenLayers': '30',
        'elk.spacing.nodeNode': '13',
        'elk.spacing.edgeEdge': '9',
        'elk.spacing.edgeNode': '10',
      } : {}),
      ...(opts?.minLayers ? { 'elk.layered.layering.strategy': 'LONGEST_PATH' } : {}),
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.partitioning.activate': 'true',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      'elk.layered.feedbackEdges': 'true',
      'elk.layered.thoroughness': '30',
      'elk.separateConnectedComponents': 'false',
      'elk.layered.spacing.nodeNodeBetweenLayers': '44',
      'elk.spacing.nodeNode': '16',
      'elk.spacing.edgeEdge': '11',
      'elk.spacing.edgeNode': '12',
      'elk.spacing.edgeLabel': '3',
      'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.padding': '[top=30,left=12,bottom=12,right=12]',
      // Numbered mode carries tiny number badges (not full labels) on the
      // edges, so there's room to spread blocks apart and let ELK find
      // shorter, more followable routes: more node/edge spacing + thoroughness.
      ...(numbered && !opts?.tight ? {
        'elk.spacing.nodeNode': '26',
        'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        'elk.spacing.edgeEdge': '14',
        'elk.spacing.edgeNode': '18',
        'elk.layered.thoroughness': '80',
        'elk.layered.nodePlacement.favorStraightEdges': 'true',
      } : {}),
    },
    children: model.elements.map((e, idx) => {
      const n = toElkNode(e);
      // partition: by declaration order (infra zones/sites) or by kind band
      const p = view.partitionByOrder
        ? (view.partitions[e.kind] !== undefined ? 90 + view.partitions[e.kind] : idx)
        : (view.partitions[e.kind] ?? 1);
      n.layoutOptions = { ...n.layoutOptions, 'elk.partitioning.partition': String(p) };
      return n;
    }),
    edges: model.flows.map(f => {
      if (numbered) {
        return {
          id: f.id, sources: [f.from], targets: [f.to],
          labels: [{ text: String(parseInt(f.id.slice(1), 10)), width: 26, height: 17 }],
        };
      }
      const text = f.label && opts?.labelWrap ? wrapText(f.label, opts.labelWrap) : f.label;
      const chips = (f.objects ?? []).map(o => boName.get(o.id) ?? o.id);
      const tech = techText(f.tech);
      return {
        id: f.id, sources: [f.from], targets: [f.to],
        labels: text || chips.length || tech ? [{ text: text ?? '', ...flowLabelBox(text ?? '', chips, FS_EDGE, tech) }] : [],
      };
    }),
  });

  // ---- scene assembly from an ELK result ----
  const kindOf = new Map<string, Element>();
  (function idx(els: Element[]) { for (const e of els) { kindOf.set(e.id, e); idx(e.children); } })(model.elements);

  const sceneFromRes = (res: any, layoutMs: number): Scene => {
    const origins: Record<string, { x: number; y: number }> = { root: { x: 0, y: 0 } };
    const nodes: SceneNode[] = [];
    (function walk(n: any, ox: number, oy: number) {
      for (const c of n.children ?? []) {
        const ax = ox + c.x, ay = oy + c.y;
        origins[c.id] = { x: ax, y: ay };
        const el = kindOf.get(c.id)!;
        nodes.push({
          id: c.id, kind: el.kind, label: el.label ?? c.id,
          x: ax, y: ay, w: c.width, h: c.height,
          container: !!(c.children && c.children.length),
        });
        walk(c, ax, ay);
      }
    })(res, 0, 0);

    const edges: SceneEdge[] = [];
    (function collect(n: any) {
      for (const e of n.edges ?? []) {
        const o = origins[e.container] ?? { x: 0, y: 0 };
        const s = e.sections?.[0];
        const pts = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: any) => ({ x: p.x + o.x, y: p.y + o.y })) : [];
        const labels: SceneLabel[] = (e.labels ?? []).map((l: any) => ({
          flowId: e.id, text: l.text, x: l.x + o.x, y: l.y + o.y, w: l.width, h: l.height,
        }));
        edges.push({ id: e.id, pts, labels });
      }
      (n.children ?? []).forEach(collect);
    })(res);

    return { width: Math.ceil(res.width), height: Math.ceil(res.height), nodes, edges, layoutMs };
  };

  const t0 = Date.now();
  let res: any;
  if (target) {
    // Orientation is a HARD constraint (slide = landscape, page = portrait);
    // the ratio is only a soft target among correctly-oriented candidates.
    // Slide adds width-reducing candidates: narrow-wrapped labels trade the
    // slide's spare height for width (labels drive layer-gap width in RIGHT).
    const specs: any[] = disp === 'slide'
      ? [makeGraph('RIGHT'), makeGraph('DOWN'),
         makeGraph('RIGHT', { labelWrap: 16 }), makeGraph('RIGHT', { labelWrap: 14, tight: true }),
         makeGraph('RIGHT', { labelWrap: 14, tight: true, minLayers: true }),
         makeGraph('DOWN', { labelWrap: 16 }), makeGraph('DOWN', { labelWrap: 20, minLayers: true })]
      : [makeGraph('RIGHT'), makeGraph('DOWN'), makeGraph('DOWN', { labelWrap: 16 })];
    const candidates = await Promise.all(specs.map(g => elk.layout(g)));
    const wantLandscape = disp === 'slide';
    const oriented = candidates.filter(r => wantLandscape ? r.width >= r.height : r.height >= r.width);
    const pool = oriented.length ? oriented : candidates;
    // Fitness = scale-to-fit on the physical target (what readability actually
    // depends on), not abstract ratio distance. Bigger scale = bigger text.
    const frame = disp === 'slide' ? { w: 1280, h: 720 } : { w: 700, h: 1000 }; // 16:9 / A4 minus margins
    const fit = (r: { width: number; height: number }) => -Math.min(frame.w / r.width, frame.h / r.height);
    res = pool.reduce((a, b) => (fit(a) <= fit(b) ? a : b));
    // Slide: the folded composite layout (systems stacked as rows) usually
    // beats any single global layering — compare on the same fitness.
    if (disp === 'slide') {
      const fold = await foldedLayout(model, view, elk);
      if (fold && fit(fold) < fit(res)) {
        fold.layoutMs = Date.now() - t0;
        return fold;
      }
    }
  } else {
    res = await elk.layout(makeGraph(disp === 'tall' ? 'DOWN' : 'RIGHT'));
  }
  const layoutMs = Date.now() - t0;
  return sceneFromRes(res, layoutMs);
}
