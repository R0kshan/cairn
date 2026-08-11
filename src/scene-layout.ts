/**
 * Stage 4: turns the validated `Model` into an absolute-positioned `Scene`
 * (nodes, edges, labels, canvas size) via elkjs layered layout. Builds the ELK
 * graph from measured node sizes, runs several candidate layouts for balanced
 * dispositions (`slide`/`page`) and picks the best fit — optionally deferring to
 * the folded layout (`slide-fold.ts`). `LaidOutNode`/`LaidOutEdge` describe an
 * ELK result after layout (coordinates populated) and are shared with slide-fold.
 */

import type { Model, Element } from "./models/ast.ts";
import type { ElkNode, ElkEdgeSection } from "elkjs/lib/elk.bundled.js";
import type { View } from "./views.ts";
import { measure, wrapText, flowLabelBox, techText, fontSizes } from "./text-metrics.ts";
import { foldedLayout } from "./slide-fold.ts";
import { getElk } from "./elk-engine.ts";
import { rerouteDetours, titleBoxesOf } from "./route-detour.ts";
import type { Box, Point, TitleBox } from "./geometry.ts";
import { compactVertical } from "./compact.ts";
import { optimiseRoutes, clearSideHugs, spreadAttachments, swapCrossingSiblingSeats, tidyEdges } from "./edge-tidy.ts";
import { inspect, type Profile } from "./readability.ts";
import { anchorFlowLabels } from "./label-anchor.ts";
import { subtreeIds, indexElementsById } from "./element-tree.ts";

/**
 * A node/edge as returned by elk *after* layout: every coordinate is populated,
 * unlike the input `ElkNode` where they are optional. Local to the render
 * pipeline; shared with slide-fold so both walk elk results the same way.
 */
export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: LaidOutNode[];
  edges?: LaidOutEdge[];
}
interface LaidOutLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface LaidOutEdge {
  id: string;
  container?: string;
  sections?: ElkEdgeSection[];
  labels?: LaidOutLabel[];
}

export interface SceneNode extends Box {
  id: string;
  kind: string;
  label: string;
  container: boolean;
}
export interface SceneLabel extends Box {
  flowId: string;
  text: string;
  /**
   * Height of the *text* rows, which sit at the top of the box; a protocol line
   * and chips fill the rest. Seating a label on its run means centring this, not
   * the box — centre the box and the run lands between text and chip, which is
   * neither on the line nor under it. 0 for a chips-only label.
   */
  textH: number;
}
export interface SceneEdge {
  id: string;
  pts: Point[];
  labels: SceneLabel[];
  /**
   * Set by `route-detour` on edges it sent through a top/bottom channel.
   * Those wrap around by design (invariant §11), so the attachment-direction
   * rule (§4c) and its `attachAway` gate exempt them.
   */
  detour?: boolean;
  /**
   * The route this flow had before `optimiseRoutes` moved it. Kept so the
   * renderer can undo a repair that cost some label its seat — that verdict is
   * only reachable after label settling, which happens during rendering.
   */
  repairedFrom?: Point[];
}
export interface Scene {
  width: number;
  height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  layoutMs: number;
  /**
   * Best (lowest) tier `optimiseRoutes` paid at across the repairs it kept. The
   * renderer audits those repairs for label collateral the router could not see,
   * and "a loss at tier T is payable only by a gain at a better tier" needs to
   * know what the repair bought. Absent when nothing was repaired.
   */
  repairTier?: number;
}

interface WalkedElkNode {
  id: string;
  x: number;
  y: number;
  node: SceneNode;
}

/**
 * IDs of top-level `external` elements that only ever feed data in (never
 * receive it back) — used by `partitionByOrder` views to place them upstream
 * of everything else instead of wherever elk's layered algorithm lands them.
 */
function computeIngressExternalElements(model: Model): Set<string> {
  const ingressExternalElements = new Set<string>();
  for (const element of model.elements) {
    if (element.kind !== "external") continue;
    const ids = new Set(subtreeIds(element));
    const feedsInto = model.flows.some((flow) => ids.has(flow.from) && !ids.has(flow.to));
    const receivesFrom = model.flows.some((flow) => ids.has(flow.to) && !ids.has(flow.from));
    if (feedsInto && !receivesFrom) ingressExternalElements.add(element.id);
  }
  return ingressExternalElements;
}

/** Converts an `Element` (and its children, recursively) into elk's input node shape. */
function toElkNode(
  element: Element,
  compact: boolean,
  containerFontSize: number,
  nodeFontSize: number,
): ElkNode {
  if (element.children.length) {
    const lineCount = (element.label ?? element.id).split("\n").length;
    return {
      id: element.id,
      layoutOptions: {
        "elk.padding": `[top=${(compact ? 11 : 13) + lineCount * 14},left=${compact ? 7 : 9},bottom=${compact ? 7 : 9},right=${compact ? 7 : 9}]`,
      },
      labels: [
        {
          text: element.label ?? element.id,
          ...measure(element.label ?? element.id, containerFontSize),
        },
      ],
      children: element.children.map((child) =>
        toElkNode(child, compact, containerFontSize, nodeFontSize),
      ),
    };
  }
  const measured = measure(element.label ?? element.id, nodeFontSize);
  const isActor = element.kind === "actor";
  return {
    id: element.id,
    width: isActor
      ? Math.max(64, measure(element.label ?? element.id, nodeFontSize - 1.5).width + 8)
      : Math.max(compact ? 98 : 108, measured.width + (compact ? 10 : 12)),
    height: isActor
      ? 54 + ((element.label ?? element.id).split("\n").length - 1) * 11
      : Math.max(compact ? 36 : 38, measured.height + (compact ? 10 : 12)),
  };
}

/**
 * Recursively resolves every laid-out descendant of `elkNode` to absolute
 * coordinates (elk positions are parent-relative), producing one `SceneNode`
 * per descendant alongside the absolute origin later used to place its edges.
 */
function walkElkNodes(
  elkNode: LaidOutNode,
  offsetX: number,
  offsetY: number,
  kindOf: Map<string, Element>,
): WalkedElkNode[] {
  return (elkNode.children ?? []).flatMap((child) => {
    const absoluteX = offsetX + child.x;
    const absoluteY = offsetY + child.y;
    const element = kindOf.get(child.id)!;
    const node: SceneNode = {
      id: child.id,
      kind: element.kind,
      label: element.label ?? child.id,
      x: absoluteX,
      y: absoluteY,
      width: child.width,
      height: child.height,
      container: !!child.children?.length,
    };
    return [
      { id: child.id, x: absoluteX, y: absoluteY, node },
      ...walkElkNodes(child, absoluteX, absoluteY, kindOf),
    ];
  });
}

/**
 * Recursively collects every edge beneath `elkNode`, resolving its points and
 * labels to absolute coordinates via `origins` (see `walkElkNodes`). Numbered
 * flows additionally nudge their badge off the line, perpendicular to its
 * last segment.
 */
function collectSceneEdges(
  elkNode: LaidOutNode,
  origins: Record<string, { x: number; y: number }>,
  numbered: boolean,
  edgeFontSize: number,
): SceneEdge[] {
  const ownEdges = (elkNode.edges ?? []).map((edge) => {
    const origin = (edge.container && origins[edge.container]) || { x: 0, y: 0 };
    const section = edge.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
          x: point.x + origin.x,
          y: point.y + origin.y,
        }))
      : [];
    const labels: SceneLabel[] = (edge.labels ?? []).map((label) => {
      let labelX = label.x + origin.x,
        labelY = label.y + origin.y;
      if (numbered && points.length >= 2) {
        const last = points[points.length - 1],
          secondLast = points[points.length - 2];
        const segmentLength = Math.hypot(last.x - secondLast.x, last.y - secondLast.y) || 1;
        const unitX = (last.x - secondLast.x) / segmentLength,
          unitY = (last.y - secondLast.y) / segmentLength;
        const rawStepBack = 20 + label.width / 2;
        const stepBack =
          rawStepBack < 0 ? 0 : rawStepBack > segmentLength - 2 ? segmentLength - 2 : rawStepBack;
        let perpX = -unitY,
          perpY = unitX;
        if (perpY > 0) {
          perpX = -perpX;
          perpY = -perpY;
        }
        const offset = label.height / 2 + 2;
        labelX = last.x - unitX * stepBack + perpX * offset - label.width / 2;
        labelY = last.y - unitY * stepBack + perpY * offset - label.height / 2;
      }
      return {
        flowId: edge.id,
        text: label.text,
        x: labelX,
        y: labelY,
        width: label.width,
        height: label.height,
        // Mirrors `measure()` in text-metrics, which is what sized the box.
        textH: label.text ? label.text.split("\n").length * (edgeFontSize + 3) + 4 : 0,
      };
    });
    return { id: edge.id, pts: points, labels };
  });
  const childEdges = (elkNode.children ?? []).flatMap((child) =>
    collectSceneEdges(child, origins, numbered, edgeFontSize),
  );
  return [...ownEdges, ...childEdges];
}

/**
 * Mirrors a scene across the diagonal. `route-detour` reasons in one orientation
 * — flows right-to-left, channels above or below — and a DOWN layout is that
 * problem rotated. Transposing in and out reuses the same rules and gated
 * invariants instead of a second implementation.
 *
 * Label boxes swap with everything else on the way in, so lane spacing budgets a
 * label's width where the drawing needs width. The text itself never rotates,
 * which is why title bands are computed before transposing.
 */
function transpose(scene: Scene, titleBoxes: TitleBox[]): void {
  for (const node of scene.nodes) {
    [node.x, node.y] = [node.y, node.x];
    [node.width, node.height] = [node.height, node.width];
  }
  for (const edge of scene.edges) {
    for (const point of edge.pts) [point.x, point.y] = [point.y, point.x];
    for (const label of edge.labels) {
      [label.x, label.y] = [label.y, label.x];
      [label.width, label.height] = [label.height, label.width];
    }
  }
  for (const box of titleBoxes) {
    [box.x, box.y] = [box.y, box.x];
    [box.width, box.height] = [box.height, box.width];
  }
  [scene.width, scene.height] = [scene.height, scene.width];
}

/**
 * The flows whose terminal segment departs *away* from their counterpart or
 * arrives from beyond it — the sweep's `attachAway` predicate, on the final
 * scene (channel reroutes are exempt, they wrap by design). Drives the
 * port-constraint second pass below: the population that pass exists to
 * prevent is exactly the one this counts.
 */
function attachAwayOf(scene: Scene, model: Model): Set<string> {
  const ATTACH_AWAY_TOL = 24;
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const flagged = new Set<string>();
  for (const e of scene.edges) {
    if (e.pts.length < 2 || e.detour) continue;
    const flow = model.flows.find((f) => f.id === e.id);
    const from = byId.get(flow?.from ?? "");
    const to = byId.get(flow?.to ?? "");
    if (!from || !to) continue;
    const centerOf = (n: SceneNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
    const away = (seg: { x: number; y: number }, target: { x: number; y: number }): boolean =>
      (Math.abs(seg.x) >= 0.5 && Math.abs(target.x) > ATTACH_AWAY_TOL && seg.x * target.x < 0) ||
      (Math.abs(seg.y) >= 0.5 && Math.abs(target.y) > ATTACH_AWAY_TOL && seg.y * target.y < 0);
    const p0 = e.pts[0];
    const p1 = e.pts[1];
    const pn = e.pts[e.pts.length - 1];
    const pm = e.pts[e.pts.length - 2];
    const toCenter = centerOf(to);
    const fromCenter = centerOf(from);
    if (away({ x: p1.x - p0.x, y: p1.y - p0.y }, { x: toCenter.x - p0.x, y: toCenter.y - p0.y }))
      flagged.add(e.id);
    if (away({ x: pn.x - pm.x, y: pn.y - pm.y }, { x: pn.x - fromCenter.x, y: pn.y - fromCenter.y }))
      flagged.add(e.id);
  }
  return flagged;
}

/**
 * Defects the sweep gates on that the house ladder deliberately does not model,
 * keyed for the same set-based verdict so `ladderAccepts` judges a wholesale
 * relayout the way the gate will. Two blind spots, both deliberate router design
 * (`readability.ts`): `hug:` is the §4i arrowhead rule, leaf-only at 8px/12px,
 * while the sweep's `sideHug` covers containers at 3px/24px; and `title:` checks
 * runs only while `titleStruck` covers labels too. A router picking per-edge
 * candidates can afford that; a choice between two whole layouts cannot — the
 * constrained pass was buying attachAway fixes with container hugs and labels
 * parked on title bands it could not see.
 */
function selectionExtras(scene: Scene, model: Model): Profile {
  const extra: Profile = new Map();
  const edgeEnds = new Map(model.flows.map((flow) => [flow.id, new Set([flow.from, flow.to])]));
  const bands = titleBoxesOf(scene, model);
  for (const e of scene.edges) {
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      const vert = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;
      const horiz = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
      if (!vert && !horiz) continue;
      for (const n of scene.nodes) {
        if (edgeEnds.get(e.id)?.has(n.id)) continue;
        const shared = vert
          ? Math.min(Math.max(a.y, b.y), n.y + n.height) - Math.max(Math.min(a.y, b.y), n.y)
          : Math.min(Math.max(a.x, b.x), n.x + n.width) - Math.max(Math.min(a.x, b.x), n.x);
        if (shared <= 24) continue;
        const gap = vert
          ? Math.min(Math.abs(a.x - n.x), Math.abs(a.x - (n.x + n.width)))
          : Math.min(Math.abs(a.y - n.y), Math.abs(a.y - (n.y + n.height)));
        if (gap < 3) extra.set(`sidehug:${e.id}:${i}@${n.id}`, 2);
      }
    }
    for (const l of e.labels) {
      if (!l.width || !l.height) continue;
      for (const band of bands)
        if (
          l.x < band.x + band.width &&
          band.x < l.x + l.width &&
          l.y < band.y + band.height &&
          band.y < l.y + l.height
        )
          extra.set(`titlelabel:${e.id}@${band.x},${band.y}`, 0);
    }
  }
  return extra;
}

/**
 * The ladder's verdict, adapted to a whole-layout choice. `ladderVerdict` keys
 * defects by identity *and position* — right for a router moving one edge, where
 * a moved crossing is a new one; wrong between two complete layouts, where every
 * coordinate shifts a few px and one crossing reads as gained at one address and
 * lost at another, refusing every relayout. Identity here drops positions and
 * segment indices, keeping multiplicity as a count so a pair gaining a *second*
 * crossing is still a gain. The rule is unchanged: walk tiers, refuse on any
 * gain, accept at the first tier that only lost.
 */
function relayoutVerdict(before: Profile, after: Profile): number {
  const normalize = (key: string) => key.replace(/@[-\d.,]+$/, "").replace(/:\d+(?=@|$)/, "");
  const tally = (profile: Profile) => {
    const out = new Map<string, { tier: number; count: number }>();
    for (const [key, tier] of profile) {
      const id = normalize(key);
      const entry = out.get(id) ?? { tier, count: 0 };
      entry.count++;
      out.set(id, entry);
    }
    return out;
  };
  const was = tally(before);
  const now = tally(after);
  for (let tier = 0; tier < 5; tier++) {
    let gained = false;
    let lost = false;
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const w = was.get(key);
      const n = now.get(key);
      // Judge a key at its own tier only — a tier-1 loss paid for a tier-0
      // win is the ladder working, not a gain.
      if ((w ?? n)!.tier !== tier) continue;
      if ((n?.count ?? 0) > (w?.count ?? 0)) gained = true;
      if ((n?.count ?? 0) < (w?.count ?? 0)) lost = true;
    }
    if (gained) return -1;
    if (lost) return tier;
  }
  return -1;
}

/**
 * Rebuild `graph` with explicit ports on the nodes `flagged` flows touch, so elk
 * routes them out the side *facing* the counterpart. elk's default for a
 * backward flow in a layered layout is to loop around the outside, departing
 * away from its target and arriving from beyond it (`attachAway`).
 *
 * `elk.port.side` is honored only at `FIXED_SIDE` or stricter, which constrains
 * every edge of the node — so every incident flow gets a port: flagged ones face
 * their counterpart (measured on the first-pass scene), unflagged ones keep the
 * side elk already chose, so a good route is not disturbed to fix a bad one.
 */
function constrainPorts(graph: ElkNode, scene: Scene, flagged: Set<string>, model: Model): void {
  type Side = "NORTH" | "SOUTH" | "EAST" | "WEST";
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const elkById = new Map<string, ElkNode>();
  const register = (node: ElkNode) => {
    elkById.set(node.id, node);
    for (const child of node.children ?? []) register(child);
  };
  register(graph);
  const centerOf = (n: SceneNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  const sideToward = (from: SceneNode, to: SceneNode): Side => {
    const dx = centerOf(to).x - centerOf(from).x;
    const dy = centerOf(to).y - centerOf(from).y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "WEST" : "EAST") : dy < 0 ? "NORTH" : "SOUTH";
  };
  const sideOn = (p: { x: number; y: number }, n: SceneNode): Side | null => {
    if (p.x > n.x - 2 && p.x < n.x + n.width + 2) {
      if (Math.abs(p.y - n.y) < 2) return "NORTH";
      if (Math.abs(p.y - (n.y + n.height)) < 2) return "SOUTH";
    }
    if (p.y > n.y - 2 && p.y < n.y + n.height + 2) {
      if (Math.abs(p.x - n.x) < 2) return "WEST";
      if (Math.abs(p.x - (n.x + n.width)) < 2) return "EAST";
    }
    return null;
  };
  // Only the flagged flows' nodes are pinned. Pinning *every* flow to its
  // first-pass side was measured worse (attachAway 303 -> 304, nearParallel
  // 63 -> 66, the application-compact regressions back): with no freedom left
  // on the other edges, elk cannot reorganise corridors around the new ports.
  const flaggedNodes = new Set<string>();
  for (const flow of model.flows)
    if (flagged.has(flow.id)) {
      flaggedNodes.add(flow.from);
      flaggedNodes.add(flow.to);
    }
  for (const nodeId of flaggedNodes) {
    const elkNode = elkById.get(nodeId);
    const sceneNode = nodeById.get(nodeId);
    if (!elkNode || !sceneNode) continue;
    const ports: NonNullable<ElkNode["ports"]> = [];
    for (const flow of model.flows) {
      if (flow.from !== nodeId && flow.to !== nodeId) continue;
      const role = flow.from === nodeId ? "src" : "dst";
      const other = nodeById.get(role === "src" ? flow.to : flow.from);
      if (!other) continue;
      let side = sideToward(sceneNode, other);
      if (!flagged.has(flow.id)) {
        const edge = scene.edges.find((e) => e.id === flow.id);
        const terminal =
          edge && edge.pts.length >= 2
            ? role === "src"
              ? edge.pts[0]
              : edge.pts[edge.pts.length - 1]
            : null;
        const actual = terminal ? sideOn(terminal, sceneNode) : null;
        if (actual) side = actual;
      }
      const portId = `${flow.id}${role === "src" ? "#out" : "#in"}`;
      // 1x1, not 0x0: a zero-size port breaks the scanline constraint's
      // hitbox math inside elk ("Invalid hitboxes for scanline constraint
      // calculation") on hierarchical graphs — measured on every themes/*
      // model, where the constrained pass crashed and fell back to the wrap.
      ports.push({ id: portId, width: 1, height: 1, layoutOptions: { "elk.port.side": side } });
      const elkEdge = (graph.edges ?? []).find((edge) => edge.id === flow.id);
      if (elkEdge) {
        if (role === "src") elkEdge.sources = [portId];
        else elkEdge.targets = [portId];
      }
    }
    if (!ports.length) continue;
    elkNode.layoutOptions = { ...elkNode.layoutOptions, "elk.portConstraints": "FIXED_SIDE" };
    elkNode.ports = [...(elkNode.ports ?? []), ...ports];
  }
}

export async function layout(model: Model, view: View): Promise<Scene> {
  const elk = await getElk();
  const businessObjectName = new Map(model.businessObjects.map((bo) => [bo.id, bo.name]));
  const numbered = model.style.flowText === "numbered";
  const compact = model.style.compact;
  const COMPACT_WRAP = 10;
  const {
    edge: edgeFontSize,
    node: nodeFontSize,
    cont: containerFontSize,
    scale: fontScale,
  } = fontSizes(model.style.font.size);

  const disposition = model.style.disposition;
  const ASPECT_TARGETS: Record<string, number | undefined> = {
    slide: 16 / 9,
    page: 0.71,
  };
  const aspectTarget = ASPECT_TARGETS[disposition];

  const ingressExternalElements = view.partitionByOrder
    ? computeIngressExternalElements(model)
    : new Set<string>();
  const INGRESS_PARTITION = -1,
    EGRESS_PARTITION = 900;

  const makeGraph = (
    direction: "RIGHT" | "DOWN",
    options?: { labelWrap?: number; tight?: boolean; minLayers?: boolean },
  ): ElkNode => ({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      ...(options?.tight
        ? {
            "elk.layered.spacing.nodeNodeBetweenLayers": "14",
            "elk.spacing.nodeNode": "10",
            "elk.spacing.edgeEdge": "8",
            "elk.spacing.edgeNode": "9",
          }
        : {}),
      ...(options?.minLayers ? { "elk.layered.layering.strategy": "LONGEST_PATH" } : {}),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.partitioning.activate": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.layered.feedbackEdges": "true",
      "elk.layered.thoroughness": "30",
      "elk.separateConnectedComponents": "false",
      "elk.layered.spacing.nodeNodeBetweenLayers": compact ? "10" : "16",
      "elk.spacing.nodeNode": compact ? "8" : "11",
      "elk.spacing.edgeEdge": compact ? "7" : "9",
      "elk.spacing.edgeNode": compact ? "8" : "10",
      "elk.spacing.edgeLabel": "2",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.edgeLabels.placement": "CENTER",
      "elk.padding": "[top=22,left=10,bottom=10,right=10]",
      ...(numbered && !options?.tight
        ? {
            "elk.spacing.nodeNode": "26",
            "elk.layered.spacing.nodeNodeBetweenLayers": "64",
            "elk.spacing.edgeEdge": "14",
            "elk.spacing.edgeNode": "18",
            "elk.layered.thoroughness": "80",
            "elk.layered.nodePlacement.favorStraightEdges": "true",
          }
        : {}),
    },
    children: model.elements.map((element, index) => {
      const elkNode = toElkNode(element, compact, containerFontSize, nodeFontSize);
      const partition = view.partitionByOrder
        ? element.kind === "actor" || element.kind === "actor-group"
          ? INGRESS_PARTITION
          : element.kind === "external"
            ? ingressExternalElements.has(element.id)
              ? INGRESS_PARTITION
              : EGRESS_PARTITION
            : view.partitions[element.kind] !== undefined
              ? 90 + view.partitions[element.kind]
              : index
        : (view.partitions[element.kind] ?? 1);
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        "elk.partitioning.partition": String(partition),
      };
      return elkNode;
    }),
    edges: model.flows.map((flow) => {
      if (numbered) {
        return {
          id: flow.id,
          sources: [flow.from],
          targets: [flow.to],
          labels: [
            {
              text: String(parseInt(flow.id.slice(1), 10)),
              width: Math.round(26 * fontScale),
              height: Math.round(17 * fontScale),
            },
          ],
        };
      }
      const wrap = options?.labelWrap ?? (compact ? COMPACT_WRAP : undefined);
      const raw = flow.label && wrap ? wrapText(flow.label, wrap) : flow.label;
      const chips = (flow.objects ?? []).map(
        (objectRef) => businessObjectName.get(objectRef.id) ?? objectRef.id,
      );
      const tech = techText(flow.tech);
      const text = raw || (tech ? tech : "");
      const subTitle = raw ? tech : undefined;
      return {
        id: flow.id,
        sources: [flow.from],
        targets: [flow.to],
        labels:
          text || chips.length
            ? [
                {
                  text,
                  ...flowLabelBox(text, chips, edgeFontSize, subTitle, fontScale),
                },
              ]
            : [],
      };
    }),
  });

  const kindOf = new Map(indexElementsById(model.elements));

  const sceneFromResult = (result: LaidOutNode, layoutMs: number): Scene => {
    const origins: Record<string, { x: number; y: number }> = {
      root: { x: 0, y: 0 },
    };
    const walkedNodes = walkElkNodes(result, 0, 0, kindOf);
    const nodes = walkedNodes.map((walked) => walked.node);
    for (const walked of walkedNodes) origins[walked.id] = { x: walked.x, y: walked.y };

    const edges = collectSceneEdges(result, origins, numbered, edgeFontSize);

    const scene: Scene = {
      width: Math.ceil(result.width),
      height: Math.ceil(result.height),
      nodes,
      edges,
      layoutMs,
    };
    // Issue #26 applies to every disposition. A DOWN layout wraps its backward
    // flows around the sides rather than the top, so it is routed through the
    // same pass with the scene mirrored across the diagonal.
    const titleBoxes = titleBoxesOf(scene, model);
    const sideways = disposition === "page" || disposition === "tall";
    if (sideways) transpose(scene, titleBoxes);
    rerouteDetours(scene, model, numbered, titleBoxes);
    if (sideways) transpose(scene, titleBoxes);
    // `rerouteDetours` shifts the whole scene when a top-channel lane sits above
    // y=0, so boxes measured before it are stale by that amount. Handing those
    // to `tidyEdges` makes its re-side pass accept runs that strike titles where
    // they now are — on logical-fr/slide, §4c sent F19's L through a band it
    // could not see. Re-derive before any pass that reads them.
    const routedTitles = titleBoxesOf(scene, model);
    // Straighten routing noise and separate flows sharing a node side, for
    // every edge — elk's as much as the rerouted ones.
    tidyEdges(scene, routedTitles);
    // Every pass above moves routes without moving the labels that name them.
    // Put each label back on its own flow before anything measures where labels
    // are — `compact` below is the first thing that does.
    anchorFlowLabels(scene, routedTitles);
    // Reclaim the bands elk sized for routes that no longer run there — every
    // disposition, since elk leaves spare corridors whether or not the reroute
    // above moved anything.
    compactVertical(scene);
    // The repair is tried and then audited, not refused outright: a route change
    // can cost a *different* flow's label its seat, so any flow whose label was
    // on its run before and is not after is put back. That keeps the ladder's
    // rule (a Tier 1 loss is bought only by a Tier 0 gain) without refusing every
    // move that merely *might* cost a label. Deep copy — `optimiseRoutes` squares
    // every edge in place, so a shallow snapshot is not a snapshot.
    const routesBefore = new Map(
      scene.edges.map((edge) => [edge.id, edge.pts.map((point) => ({ ...point }))]),
    );
    // Re-derived, not reused: the boxes above predate `compactVertical`, which
    // moves every container's y. Reusing them made a later pass dodge bands
    // where they used to be and strike them where they now are — 17 drawings
    // reported `titleStruck` before this was fixed.
    const settledTitles = titleBoxesOf(scene, model);
    // After compaction, not before: `compact` shrinks the gaps a route is judged
    // on, so validating above it judges geometry that compaction then narrows
    // into near-parallel runs and micro-jogs. Last pass that re-routes — only
    // the spread below still moves geometry, along a side its terminal sits on.
    optimiseRoutes(scene, settledTitles);
    // The ladder trades a lower-tier win for a tier-4 `tight` when every seat
    // it can reach sits within `MIN_ATTACH_GAP` of a sibling — honest, but it
    // leaves the side crowded. The same spread that ran inside `tidyEdges`
    // runs here again, after the pass that re-crowds.
    spreadAttachments(scene);
    // Record *every* edge the repair moved. Restricting it to edges whose label
    // was seated beforehand made the rollback partial, leaving a drawing half
    // repaired — a state neither pass ever evaluated, and the source of
    // `coincident` runs, a must-be-zero breach. Worth is judged whole-drawing in
    // the renderer; this only has to make the undo complete.
    for (const edge of scene.edges) {
      const original = routesBefore.get(edge.id);
      if (!original) continue;
      const moved =
        original.length !== edge.pts.length ||
        original.some(
          (point, index) =>
            Math.abs(point.x - edge.pts[index].x) > 0.01 ||
            Math.abs(point.y - edge.pts[index].y) > 0.01,
        );
      if (moved) edge.repairedFrom = original;
    }
    // `compactVertical` shrank the gaps this pass judges, so a run that cleared
    // its sides before compaction can hug one after. Placed *after* the repair
    // recording so the hug fix is not swept into the renderer's batch audit and
    // reverted as collateral — on application-large-fr/wide, F19's fix at y=445
    // was batch-reverted to y=451 over another edge's label harm. Here it is in
    // both audit states, so the comparison is unaffected and the fix permanent.
    clearSideHugs(scene, settledTitles);
    anchorFlowLabels(scene, settledTitles);
    // Crossings between two flows on the same leaf side, further out than the
    // §4b fan can see. Here for the same reason as `clearSideHugs`: outside the
    // renderer's batch audit, so an unrelated optimiser trade cannot revert the
    // swap. Only swaps that remove a crossing without shuffling it elsewhere.
    swapCrossingSiblingSeats(scene);
    return scene;
  };

  const startTime = Date.now();
  let result: LaidOutNode;
  let winnerDirection: "RIGHT" | "DOWN";
  let winnerOptions: { labelWrap?: number; tight?: boolean; minLayers?: boolean } | undefined;
  if (aspectTarget) {
    const graphSpecs: {
      direction: "RIGHT" | "DOWN";
      options?: { labelWrap?: number; tight?: boolean; minLayers?: boolean };
    }[] =
      disposition === "slide"
        ? [
            { direction: "RIGHT" },
            { direction: "RIGHT", options: { labelWrap: 16 } },
            { direction: "RIGHT", options: { labelWrap: 14, tight: true } },
            { direction: "RIGHT", options: { labelWrap: 14, tight: true, minLayers: true } },
          ]
        : [{ direction: "DOWN" }, { direction: "DOWN", options: { labelWrap: 16 } }];
    const candidates = (await Promise.all(
      graphSpecs.map((spec) => elk.layout(makeGraph(spec.direction, spec.options))),
    )) as unknown as LaidOutNode[];
    const preferWide = disposition === "slide";
    const orientedLayouts = candidates
      .map((layoutResult, index) => ({ layoutResult, index }))
      .filter(({ layoutResult }) =>
        preferWide
          ? layoutResult.width >= layoutResult.height
          : layoutResult.height >= layoutResult.width,
      );
    const viableLayouts = orientedLayouts.length
      ? orientedLayouts
      : candidates.map((layoutResult, index) => ({ layoutResult, index }));
    const frameSize =
      disposition === "slide" ? { width: 1280, height: 720 } : { width: 700, height: 1000 };
    const fitScore = (layoutResult: { width: number; height: number }) =>
      -Math.min(frameSize.width / layoutResult.width, frameSize.height / layoutResult.height);
    const winner = viableLayouts.reduce((candidateA, candidateB) =>
      fitScore(candidateA.layoutResult) <= fitScore(candidateB.layoutResult) ? candidateA : candidateB,
    );
    result = winner.layoutResult;
    winnerDirection = graphSpecs[winner.index].direction;
    winnerOptions = graphSpecs[winner.index].options;
    if (disposition === "slide") {
      const folded = await foldedLayout(model, view, elk);
      if (folded && fitScore(result) >= fitScore(folded) * 1.1) {
        folded.layoutMs = Date.now() - startTime;
        // The folded layout hand-routes its own connectors, so it keeps them —
        // but the endpoint invariants apply to it like everything else.
        tidyEdges(folded, titleBoxesOf(folded, model), true);
        anchorFlowLabels(folded, titleBoxesOf(folded, model));
        compactVertical(folded);
        // The folded layout hand-routes its connectors, so the optimiser is a
        // no-op on it by design (`folded`), but the call keeps the two pipelines
        // structurally identical.
        optimiseRoutes(folded, titleBoxesOf(folded, model), true);
        return folded;
      }
    }
  } else {
    winnerDirection = disposition === "tall" ? "DOWN" : "RIGHT";
    winnerOptions = undefined;
    result = (await elk.layout(makeGraph(winnerDirection))) as unknown as LaidOutNode;
  }
  const layoutMs = Date.now() - startTime;
  const scene = sceneFromResult(result, layoutMs);
  const away = attachAwayOf(scene, model);
  // The playground bundles this module for the browser, where `process` does
  // not exist; reach it through `globalThis` so the switch is simply absent
  // there instead of a ReferenceError. CLI-only debug aid — see CONTRIBUTING.md.
  const skipPortPass = !!(globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.CAIRN_NO_PORT_PASS;
  if (!away.size || skipPortPass) return scene;
  // `route-detour` only claims the wrap-arounds wasteful enough to deserve a
  // channel, leaving the merely-bad wrapped. Re-run the winning config with
  // those flows pinned to ports facing their counterpart, judged by the house
  // ladder rather than the metric being fixed: a relayout that clears wrong-side
  // departures but strikes a title or merges a run is refused. Opportunistic —
  // port constraints hit an elk scanline bug on some models, so a crash here
  // just keeps the first pass.
  try {
    const constrained = makeGraph(winnerDirection, winnerOptions);
    constrainPorts(constrained, scene, away, model);
    const reresult = (await elk.layout(constrained)) as unknown as LaidOutNode;
    const rescene = sceneFromResult(reresult, Date.now() - startTime);
    const allEdges = (s: Scene) => new Set(s.edges.map((edge) => edge.id));
    const before = inspect(scene, titleBoxesOf(scene, model)).local(allEdges(scene), new Map());
    const after = inspect(rescene, titleBoxesOf(rescene, model)).local(allEdges(rescene), new Map());
    for (const [key, tier] of selectionExtras(scene, model)) before.set(key, tier);
    for (const [key, tier] of selectionExtras(rescene, model)) after.set(key, tier);
    const verdict = relayoutVerdict(before, after);
    return verdict >= 0 ? rescene : scene;
  } catch {
    return scene;
  }
}
