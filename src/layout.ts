// Model -> ELK constraint compilation -> absolute-coordinate scene.
// Ported from the phase 0 spike; view conventions drive the ELK options.

import type { Model, Element, View } from './model.ts';
import { measure, wrapText, flowLabelBox, techText, fontSizes } from './text.ts';
import { foldedLayout } from './fold.ts';
import { getElk } from './elk.ts';

export interface SceneNode { id: string; kind: string; label: string; x: number; y: number; w: number; h: number; container: boolean; }
export interface SceneLabel { flowId: string; text: string; x: number; y: number; w: number; h: number; }
export interface SceneEdge { id: string; pts: { x: number; y: number }[]; labels: SceneLabel[]; }
export interface Scene { width: number; height: number; nodes: SceneNode[]; edges: SceneEdge[]; layoutMs: number; }

export async function layout(model: Model, view: View): Promise<Scene> {
  const elk = await getElk();
  const boName = new Map(model.businessObjects.map(b => [b.id, b.name]));
  const numbered = model.style.flowText === 'numbered';
  // `compact` opts into a denser layout: tighter inter-layer spacing plus
  // narrower-wrapped flow labels (traded for a little extra height), which
  // shrinks the label-driven gaps between layers. Off by default.
  const compact = model.style.compact;
  const COMPACT_WRAP = 10; // chars/line for flow labels when compact
  // Text sizes derive from the single base (style.font.size); bigger base =
  // bigger, more readable text everywhere, with layout measured to match.
  const { edge: FS_EDGE, node: FS_NODE, cont: FS_CONT, scale: FS_SCALE } = fontSizes(model.style.font.size);

  function toElkNode(e: Element): any {
    if (e.children.length) {
      const nLines = (e.label ?? e.id).split('\n').length;
      return {
        id: e.id,
        layoutOptions: { 'elk.padding': `[top=${(compact ? 11 : 13) + nLines * 14},left=${compact ? 7 : 9},bottom=${compact ? 7 : 9},right=${compact ? 7 : 9}]` },
        labels: [{ text: e.label ?? e.id, ...measure(e.label ?? e.id, FS_CONT) }],
        children: e.children.map(toElkNode),
      };
    }
    const m = measure(e.label ?? e.id, FS_NODE);
    const isActor = e.kind === 'actor';
    return {
      id: e.id,
      width: isActor ? Math.max(64, measure(e.label ?? e.id, FS_NODE - 1.5).width + 8) : Math.max(compact ? 98 : 108, m.width + (compact ? 10 : 12)),
      height: isActor ? 54 + ((e.label ?? e.id).split('\n').length - 1) * 11 : Math.max(compact ? 36 : 38, m.height + (compact ? 10 : 12)),
    };
  }

  // disposition -> direction. Direction is LOCKED per disposition so the actor
  // band (partition 0) is always on the expected side — a hard reading-order
  // invariant, not something left to the fitness search:
  //   wide  / slide -> RIGHT (actors LEFT)   |  tall / page -> DOWN (actors TOP)
  // slide/page still explore multiple candidates, but only within their locked
  // direction; the search tunes fit (label wrap, spacing), never the side.
  const disp = model.style.disposition;
  const TARGETS: Record<string, number | undefined> = { slide: 16 / 9, page: 0.71 };
  const target = TARGETS[disp];

  // Infrastructure and security views have no `actor` kind — their "users" are
  // modelled as `external` elements. Split externals by flow topology so those
  // user-facing sources read on the entry side (left for wide/slide, top for
  // tall/page), exactly like actors do, while downstream partners stay on the
  // exit side. An external is INGRESS iff it only feeds the system (has an
  // outgoing flow into it and no incoming flow); everything else is EGRESS.
  // Only applies to partitionByOrder views (infra/security); logical/application
  // keep externals right — there, users are actors and already sit left.
  const ingressExternal = new Set<string>();
  if (view.partitionByOrder) {
    for (const e of model.elements) {
      if (e.kind !== 'external') continue;
      const ids = new Set<string>();
      (function collect(x: Element) { ids.add(x.id); x.children.forEach(collect); })(e);
      const feedsIn = model.flows.some(f => ids.has(f.from) && !ids.has(f.to));
      const receives = model.flows.some(f => ids.has(f.to) && !ids.has(f.from));
      if (feedsIn && !receives) ingressExternal.add(e.id);
    }
  }
  const INGRESS_PART = -1, EGRESS_PART = 900; // left-of-everything / right-of-everything

  const makeGraph = (direction: 'RIGHT' | 'DOWN', opts?: { labelWrap?: number; tight?: boolean; minLayers?: boolean }) => ({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      ...(opts?.tight ? {
        'elk.layered.spacing.nodeNodeBetweenLayers': '14',
        'elk.spacing.nodeNode': '10',
        'elk.spacing.edgeEdge': '8',
        'elk.spacing.edgeNode': '9',
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
      'elk.layered.spacing.nodeNodeBetweenLayers': compact ? '10' : '16',
      'elk.spacing.nodeNode': compact ? '8' : '11',
      'elk.spacing.edgeEdge': compact ? '7' : '9',
      'elk.spacing.edgeNode': compact ? '8' : '10',
      'elk.spacing.edgeLabel': '2',
      'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.padding': '[top=22,left=10,bottom=10,right=10]',
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
      // partition: by declaration order (infra zones/sites) or by kind band.
      // In partitionByOrder views, actors (the users) pin to the entry edge, and
      // externals split by ingress/egress side (see ingressExternal above) so
      // user-facing sources read on the entry edge and partners on the exit edge.
      const p = view.partitionByOrder
        ? (e.kind === 'actor' || e.kind === 'actor-group'
            ? INGRESS_PART
            : e.kind === 'external'
              ? (ingressExternal.has(e.id) ? INGRESS_PART : EGRESS_PART)
              : (view.partitions[e.kind] !== undefined ? 90 + view.partitions[e.kind] : idx))
        : (view.partitions[e.kind] ?? 1);
      n.layoutOptions = { ...n.layoutOptions, 'elk.partitioning.partition': String(p) };
      return n;
    }),
    edges: model.flows.map(f => {
      if (numbered) {
        return {
          id: f.id, sources: [f.from], targets: [f.to],
          labels: [{ text: String(parseInt(f.id.slice(1), 10)), width: Math.round(26 * FS_SCALE), height: Math.round(17 * FS_SCALE) }],
        };
      }
      // compact wraps labels narrower (unless a candidate already sets a wrap),
      // trading a bit of height for much less width in the inter-layer gaps.
      const wrap = opts?.labelWrap ?? (compact ? COMPACT_WRAP : undefined);
      const raw = f.label && wrap ? wrapText(f.label, wrap) : f.label;
      const chips = (f.objects ?? []).map(o => boName.get(o.id) ?? o.id);
      const tech = techText(f.tech);
      // No prose label? Promote the protocol tail to BE the label — same font,
      // same on-the-arrow placement, same overlap resolution — so it never
      // detaches. With a label, the tail stays a sub-line beneath it (subTech).
      const text = raw || (tech ? tech : '');
      const subTech = raw ? tech : undefined;
      return {
        id: f.id, sources: [f.from], targets: [f.to],
        labels: text || chips.length ? [{ text, ...flowLabelBox(text, chips, FS_EDGE, subTech, FS_SCALE) }] : [],
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
          container: !!c.children?.length,
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
        const labels: SceneLabel[] = (e.labels ?? []).map((l: any) => {
          let x = l.x + o.x, y = l.y + o.y;
          // A (default): pin the number badge on the final approach segment, just
          // outside the target node, so the number sits where the flow lands.
          if (numbered && pts.length >= 2) {
            const b = pts[pts.length - 1], a = pts[pts.length - 2];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
            // Consistent placement: back from the arrowhead along the final
            // segment, then offset to the upper side so the number sits BESIDE
            // the line (never struck through) — same relationship for every flow.
            const back = Math.min(len - 2, 20 + l.width / 2);
            let px = -uy, py = ux;           // perpendicular to the segment
            if (py > 0) { px = -px; py = -py; } // choose the upper side
            const off = l.height / 2 + 2;
            x = b.x - ux * back + px * off - l.width / 2;
            y = b.y - uy * back + py * off - l.height / 2;
          }
          return { flowId: e.id, text: l.text, x, y, w: l.width, h: l.height };
        });
        edges.push({ id: e.id, pts, labels });
      }
      (n.children ?? []).forEach(collect);
    })(res);

    return { width: Math.ceil(res.width), height: Math.ceil(res.height), nodes, edges, layoutMs };
  };

  const t0 = Date.now();
  let res: any;
  if (target) {
    // Direction is locked (slide = RIGHT/landscape, page = DOWN/portrait) so the
    // actor band never flips sides. Candidates only vary fit knobs WITHIN that
    // direction: slide trades its spare height for width via narrow-wrapped
    // labels + tight spacing; page re-wraps labels to fill the column.
    const specs: any[] = disp === 'slide'
      ? [makeGraph('RIGHT'),
         makeGraph('RIGHT', { labelWrap: 16 }), makeGraph('RIGHT', { labelWrap: 14, tight: true }),
         makeGraph('RIGHT', { labelWrap: 14, tight: true, minLayers: true })]
      : [makeGraph('DOWN'), makeGraph('DOWN', { labelWrap: 16 })];
    const candidates = await Promise.all(specs.map(g => elk.layout(g)));
    // All candidates already share the locked direction; this filter only drops
    // pathological cases (e.g. a RIGHT graph that still came out taller than wide).
    const wantLandscape = disp === 'slide';
    const oriented = candidates.filter(r => wantLandscape ? r.width >= r.height : r.height >= r.width);
    const pool = oriented.length ? oriented : candidates;
    // Fitness = scale-to-fit on the physical target (what readability actually
    // depends on), not abstract ratio distance. Bigger scale = bigger text.
    const frame = disp === 'slide' ? { w: 1280, h: 720 } : { w: 700, h: 1000 }; // 16:9 / A4 minus margins
    const fit = (r: { width: number; height: number }) => -Math.min(frame.w / r.width, frame.h / r.height);
    res = pool.reduce((a, b) => (fit(a) <= fit(b) ? a : b));
    // Slide: the folded composite layout (systems stacked as rows) usually
    // beats any single global layering. Prefer the fold's slide-shaped canvas
    // unless the single-layer ribbon fits meaningfully better (>10%): the fold
    // reads far better on a 16:9 slide than a long ribbon, so a marginal fit edge
    // (which tighter spacing can create) must not flip a multi-system slide back
    // into a ribbon.
    if (disp === 'slide') {
      const fold = await foldedLayout(model, view, elk);
      if (fold && fit(res) >= fit(fold) * 1.10) {
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
