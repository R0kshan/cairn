/**
 * Stage 4a: fixes elk's wrap-around routing of backward hierarchical edges
 * (issue #26). Under `INCLUDE_CHILDREN`, elk routes any right-to-left flow
 * crossing container boundaries out east of the outermost container and around
 * the whole drawing; no layered option changes that (`feedbackEdges`, cycle
 * breaking and thoroughness were all tested, all no-ops for hierarchical edges).
 *
 * This pass reroutes those through a channel: south out of the source into a
 * bottom lane then north into the target — west for left-column targets, or
 * north-then-south when nodes below block the south exit. Title bands are
 * obstacles for northbound risers. Deterministic: plain arithmetic, lanes
 * ordered by numeric flow id, byte-identical no-op when nothing qualifies.
 *
 * The pass runs in five phases, in this order: pick the candidates worth
 * rerouting, build the obstacle registry they must dodge, plan each one into a
 * channel, allocate the lanes those plans share, then emit the geometry.
 *
 * Read `documentation/internals/ROUTING.md` (why, and the elk options rejected)
 * and `ROUTING_IMPLEMENTATION.md` (the mechanism) before changing this file.
 */

import type { Model } from "./models/ast.ts";
import type { Scene, SceneEdge, SceneNode } from "./scene-layout.ts";
import { fontSizes, measure } from "./text-metrics.ts";
import { type TitleBox, pathLength, MIN_ATTACH_GAP } from "./geometry.ts";

const RATIO_THRESHOLD = 1.4;
const MIN_WASTE = 300;
const CHANNEL_GAP = 10;
const LINE_CLEARANCE = 12;
const MIN_PARALLEL_RUN = 40;
const RISER_DELTAS = [
  0, -8, 8, -16, 16, -24, 24, -32, 32, -40, 40, -48, 48, -56, 56, -64, 64, -72, 72,
];
// A descent may have to clear the target's own container — its border and its
// title, which overflows the box — so the search reaches well past the node.
const WEST_DESCENT_DELTAS = [-10, -18, -26, -34, -42, -50, -58, -66, -74, -82, -90, -98, -106];
const EAST_DESCENT_DELTAS = [10, 14, 18, 22, 26, 30, 34, 42, 50, 58, 66, 74, 82, 90, 98, 106];
// Entry y for a side (east/west) approach: start at the target's center and
// shift away from existing horizontals on that side. Flows arriving from below
// prefer the lower half (inbound passes under outbound), flows arriving from
// above prefer the upper half.
const ENTRY_Y_DELTAS_DOWN = [0, 6, 12, 18, 24, -6, -12, -18, -24];
const ENTRY_Y_DELTAS_UP = [0, -6, -12, -18, -24, 6, 12, 18, 24];
/** Container titles are drawn under the flows with no halo — never graze them. */
const TITLE_CLEARANCE = 8;
/** How much higher a lane must sit to justify turning up mid-drawing. */
const MIN_DEPTH_GAIN = 24;

/**
 * Title bands as drawn: top-left of each container, text running across.
 *
 * Call fresh at every point that needs them, never reuse an earlier result. The
 * scene is transposed around a DOWN-disposition pass while the title text stays
 * horizontal, and any pass that moves nodes (compaction, layout) invalidates a
 * captured set the same way.
 */
export function titleBoxesOf(scene: Scene, model: Model): TitleBox[] {
  const { cont: containerFontSize } = fontSizes(model.style.font.size);
  const compact = model.style.compact;
  return scene.nodes
    .filter((node) => node.container)
    .map((node) => ({
      x: node.x + 4,
      y: node.y,
      width: measure(node.label, containerFontSize).width + 12,
      height: (compact ? 11 : 13) + node.label.split("\n").length * 14,
    }));
}

/** Stand-in for a boundless coordinate, so "unblocked past this point" is a
 *  comparison, not a special case. */
const INF = 1e9;

const centerX = (node: SceneNode) => node.x + node.width / 2;
const centerY = (node: SceneNode) => node.y + node.height / 2;

const flowNumberOf = (edge: SceneEdge) => parseInt(edge.id.slice(1), 10);

interface Plan {
  edge: SceneEdge;
  source: SceneNode;
  target: SceneNode;
  exitX: number;
  /**
   * Set when the source is boxed in on both channel sides and the flow has
   * to leave sideways first: it departs the source's east edge at `y`, runs
   * to `exitX`, and only then turns into the channel.
   */
  exitVia?: { y: number };
  entry:
    | { kind: "south"; x: number }
    | { kind: "west"; x: number; y: number }
    | { kind: "east"; x: number; y: number }
    | { kind: "north"; x: number }
    | { kind: "westTop"; x: number; y: number }
    | { kind: "eastTop"; x: number; y: number };
}

/** A plan routed through the top channel, and its mirror through the bottom. */
type TopPlan = Plan & { entry: Extract<Plan["entry"], { kind: "north" | "westTop" | "eastTop" }> };
type BottomPlan = Plan & { entry: Extract<Plan["entry"], { kind: "south" | "west" | "east" }> };

const isTop = (plan: Plan): plan is TopPlan =>
  plan.entry.kind === "north" || plan.entry.kind === "westTop" || plan.entry.kind === "eastTop";
const isBottom = (plan: Plan): plan is BottomPlan => !isTop(plan);

// ---- phase 1: which flows are worth rerouting --------------------------------

interface Candidate {
  edge: SceneEdge;
  source: SceneNode;
  target: SceneNode;
}

/**
 * Right-to-left flows elk sent the long way round: those whose drawn length so
 * exceeds the direct distance that the detour is the route, not a detail.
 *
 * Pinned edges are never candidates. A channel replaces both terminals with the
 * lane's own entry and exit, which is precisely what the author fixed when they
 * wrote `A.top -> B.right` — and a backward flow is the case they are most
 * likely to be fixing. Documented as the one exception to invariant §11.
 */
function detourCandidates(scene: Scene, model: Model): Candidate[] {
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const flowById = new Map(model.flows.map((flow) => [flow.id, flow]));
  const candidates: Candidate[] = [];
  for (const edge of scene.edges) {
    const flow = flowById.get(edge.id);
    if (!flow || edge.pts.length < 2) continue;
    if (edge.pinned) continue;
    const source = nodeById.get(flow.from);
    const target = nodeById.get(flow.to);
    if (!source || !target) continue;
    if (centerX(target) >= centerX(source)) continue;
    const direct =
      Math.abs(centerX(source) - centerX(target)) + Math.abs(centerY(source) - centerY(target));
    const length = pathLength(edge.pts);
    if (length < RATIO_THRESHOLD * direct || length - direct < MIN_WASTE) continue;
    candidates.push({ edge, source, target });
  }
  candidates.sort(
    (candidateA, candidateB) => flowNumberOf(candidateA.edge) - flowNumberOf(candidateB.edge),
  );
  return candidates;
}

// ---- phase 2: the obstacle registry ------------------------------------------

/** What a side (east/west) approach to a node has to thread past. */
interface EntryProbe {
  target: SceneNode;
  fromBelow: boolean;
  xStart: number;
  xEnd: number;
  descentX: number;
  edgeX: number;
}

/**
 * Two risers may pass close if they barely overlap, but running alongside each
 * other for any distance reads as a single line — same rule as for horizontals,
 * applied to the shared vertical extent.
 */
function verticalConflict(
  segment: { x: number; top: number; bottom: number },
  x: number,
  top: number,
  bottom: number,
): boolean {
  const shared = Math.min(segment.bottom, bottom) - Math.max(segment.top, top);
  if (shared <= 0) return false;
  const gap = Math.abs(segment.x - x);
  return gap < 7 || (gap < LINE_CLEARANCE && shared > MIN_PARALLEL_RUN);
}

/** A southbound riser is blocked by any leaf node below `top`. */
const blockedBelowBy = (leafBoxes: SceneNode[], x: number, top: number): boolean =>
  leafBoxes.some(
    (node) => x >= node.x - 2 && x <= node.x + node.width + 2 && node.y + node.height > top + 1,
  );

/** A northbound one, by a leaf node or a title band above `bottom` in its corridor. */
const blockedAboveBy = (
  leafBoxes: SceneNode[],
  titleBoxes: TitleBox[],
  x: number,
  bottom: number,
): boolean =>
  leafBoxes.some((node) => x >= node.x - 2 && x <= node.x + node.width + 2 && node.y < bottom - 1) ||
  titleBoxes.some(
    (box) =>
      x >= box.x - TITLE_CLEARANCE && x <= box.x + box.width + TITLE_CLEARANCE && box.y < bottom - 1,
  );

const horizontalBlocked = (leafBoxes: SceneNode[], y: number, probe: EntryProbe): boolean =>
  leafBoxes.some(
    (node) =>
      node !== probe.target &&
      node.y - 2 <= y &&
      node.y + node.height + 2 >= y &&
      node.x < probe.xEnd &&
      node.x + node.width > probe.xStart,
  );

/**
 * A container that (geometrically) holds the target may be pierced by its entry
 * segment; crossing through any OTHER container's interior is not acceptable
 * (e.g. a west entry threading between two actors of an unrelated group).
 */
const crossesForeignContainer = (
  containerBoxes: SceneNode[],
  y: number,
  probe: EntryProbe,
): boolean => {
  const { target, xStart, xEnd } = probe;
  return containerBoxes.some(
    (box) =>
      !(
        box.x <= target.x &&
        target.x + target.width <= box.x + box.width &&
        box.y <= target.y &&
        target.y + target.height <= box.y + box.height
      ) &&
      box.y < y &&
      y < box.y + box.height &&
      box.x < xEnd &&
      box.x + box.width > xStart,
  );
};

/**
 * The verticals and horizontals already in the drawing, and the probes that ask
 * whether a proposed riser or entry can join them. Mutable: every plan that
 * lands registers its own segments, so the next candidate treats them as
 * obstacles and flows sharing a node attach at distinct points along its edge
 * instead of merging at its centre.
 */
interface Channel {
  scene: Scene;
  contentLeft: number;
  maxNodeBottom: number;
  minNodeTop: number;
  usedVerticals: { x: number; top: number; bottom: number }[];
  usedHorizontals: { y: number; left: number; right: number }[];
  addEdgeVerticals: (edge: SceneEdge) => void;
  riserConflicts: (x: number, top: number, bottom: number) => boolean;
  /**
   * Against the pre-plan snapshot: the redistribution pass validates slots for
   * risers that are themselves being repositioned, so they must not count as
   * their own obstacles.
   */
  baseRiserConflicts: (x: number, top: number, bottom: number) => boolean;
  blockedBelow: (x: number, top: number) => boolean;
  blockedAbove: (x: number, bottom: number) => boolean;
  findRiserX: (node: SceneNode, side: "south" | "north") => number | null;
  findEntryY: (probe: EntryProbe) => number | null;
}

function createChannel(scene: Scene, titleBoxes: TitleBox[], candidates: Candidate[]): Channel {
  const leafBoxes = scene.nodes.filter((node) => !node.container);
  const containerBoxes = scene.nodes.filter((node) => node.container);

  const usedVerticals: { x: number; top: number; bottom: number }[] = [];
  // Horizontal twin of the vertical registry: east/west entries must not ride
  // an existing horizontal segment (e.g. an elk-routed flow leaving the same
  // side of the target) — inbound and outbound flows stay visually separate.
  const usedHorizontals: { y: number; left: number; right: number }[] = [];
  const addEdgeVerticals = (edge: SceneEdge) => {
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const pointA = edge.pts[index];
      const pointB = edge.pts[index + 1];
      if (Math.abs(pointA.x - pointB.x) < 0.5 && Math.abs(pointA.y - pointB.y) >= 0.5)
        usedVerticals.push({
          x: pointA.x,
          top: Math.min(pointA.y, pointB.y),
          bottom: Math.max(pointA.y, pointB.y),
        });
      if (Math.abs(pointA.y - pointB.y) < 0.5 && Math.abs(pointA.x - pointB.x) >= 0.5)
        usedHorizontals.push({
          y: pointA.y,
          left: Math.min(pointA.x, pointB.x),
          right: Math.max(pointA.x, pointB.x),
        });
    }
  };

  const candidateIds = new Set(candidates.map((candidate) => candidate.edge.id));
  for (const edge of scene.edges) if (!candidateIds.has(edge.id)) addEdgeVerticals(edge);
  // Container vertical borders count as occupied verticals too — a riser or
  // descent running along a (dashed) box edge would make its arrow unreadable.
  for (const node of containerBoxes) {
    usedVerticals.push({ x: node.x, top: node.y, bottom: node.y + node.height });
    usedVerticals.push({ x: node.x + node.width, top: node.y, bottom: node.y + node.height });
  }
  const baseVerticals = usedVerticals.slice();

  const riserConflicts = (x: number, top: number, bottom: number) =>
    usedVerticals.some((segment) => verticalConflict(segment, x, top, bottom));
  const horizontalConflicts = (y: number, left: number, right: number) =>
    usedHorizontals.some(
      (segment) => Math.abs(segment.y - y) < 7 && segment.left < right && left < segment.right,
    );
  const blockedBelow = (x: number, top: number) => blockedBelowBy(leafBoxes, x, top);
  const blockedAbove = (x: number, bottom: number) =>
    blockedAboveBy(leafBoxes, titleBoxes, x, bottom);

  const findRiserX = (node: SceneNode, side: "south" | "north"): number | null => {
    const center = centerX(node);
    for (const delta of RISER_DELTAS) {
      const x = center + delta;
      if (x < node.x + 4 || x > node.x + node.width - 4) continue;
      if (side === "south") {
        if (blockedBelow(x, node.y + node.height)) continue;
        if (riserConflicts(x, node.y + node.height, INF)) continue;
      } else {
        if (blockedAbove(x, node.y)) continue;
        if (riserConflicts(x, -INF, node.y)) continue;
      }
      return x;
    }
    return null;
  };

  const findEntryY = (probe: EntryProbe): number | null => {
    const { target, fromBelow, xStart, xEnd, descentX, edgeX } = probe;
    for (const delta of fromBelow ? ENTRY_Y_DELTAS_DOWN : ENTRY_Y_DELTAS_UP) {
      const y = centerY(target) + delta;
      if (y < target.y + 4 || y > target.y + target.height - 4) continue;
      if (horizontalConflicts(y, xStart, xEnd)) continue;
      if (horizontalBlocked(leafBoxes, y, probe)) continue;
      if (crossesForeignContainer(containerBoxes, y, probe)) continue;
      // The descent approaching this entry must not cross a horizontal ATTACHED
      // to the same side of the target (inbound passes under outbound, or over
      // it when arriving from above) — otherwise the two flows intersect right
      // at the node's edge. Horizontals merely passing by are ordinary hopped
      // crossings and don't count.
      const descentCrosses = usedHorizontals.some(
        (segment) =>
          (Math.abs(segment.left - edgeX) < 3 || Math.abs(segment.right - edgeX) < 3) &&
          segment.left < descentX &&
          descentX < segment.right &&
          (fromBelow ? segment.y > y + 1 : segment.y < y - 1) &&
          segment.y > target.y - 2 &&
          segment.y < target.y + target.height + 2,
      );
      if (descentCrosses) continue;
      return y;
    }
    return null;
  };

  return {
    scene,
    contentLeft: Math.min(...scene.nodes.map((node) => node.x)),
    maxNodeBottom: Math.max(...scene.nodes.map((node) => node.y + node.height)),
    minNodeTop: Math.min(...scene.nodes.map((node) => node.y)),
    usedVerticals,
    usedHorizontals,
    addEdgeVerticals,
    riserConflicts,
    baseRiserConflicts: (x, top, bottom) =>
      baseVerticals.some((segment) => verticalConflict(segment, x, top, bottom)),
    blockedBelow,
    blockedAbove,
    findRiserX,
    findEntryY,
  };
}

// ---- phase 3: planning each candidate into a channel -------------------------

/** Carried across candidates: each west-gutter flow steps further left. */
interface PlanState {
  westCount: number;
}

/**
 * A descent beside `node` — east or west of it, arriving from below or above —
 * with an entry y that clears everything. The single gate for all five side
 * approaches the planner tries: duplicating this test is what §3 warns about,
 * and the five copies it replaces had already drifted in their `x < 4` guard.
 */
function findSideApproach(
  ch: Channel,
  node: SceneNode,
  east: boolean,
  fromBelow: boolean,
): { x: number; y: number } | null {
  const edgeX = east ? node.x + node.width : node.x;
  for (const delta of east ? EAST_DESCENT_DELTAS : WEST_DESCENT_DELTAS) {
    const x = edgeX + delta;
    // West descents reach far enough left to run off the canvas; east ones,
    // stepping outward from a positive edge, never can.
    if (!east && x < 4) continue;
    const y = ch.findEntryY({
      target: node,
      fromBelow,
      xStart: east ? edgeX : x,
      xEnd: east ? x : edgeX,
      descentX: x,
      edgeX,
    });
    if (y === null) continue;
    if (fromBelow ? ch.blockedBelow(x, y) : ch.blockedAbove(x, y)) continue;
    if (fromBelow ? ch.riserConflicts(x, y, INF) : ch.riserConflicts(x, -INF, y)) continue;
    return { x, y };
  }
  return null;
}

/**
 * Which channel to use is a choice, not a preference: both ends must reach the
 * lane, so a side costs the two risers it demands and the horizontal run is the
 * same either way. The near side spares the trip out to the far edge and back —
 * `medium-page`'s "Notify steps and decision" travelled 346px right to a channel
 * only to come 612px back left. Divert only when the gain is clear and the other
 * channel is certain to plan, so a diverted flow can never end up worse off.
 */
function prefersTopChannel(ch: Channel, candidate: Candidate): boolean {
  const { source, target } = candidate;
  const bottomRisers =
    ch.maxNodeBottom - (source.y + source.height) + (ch.maxNodeBottom - (target.y + target.height));
  const topRisers = source.y - ch.minNodeTop + (target.y - ch.minNodeTop);
  return (
    topRisers < bottomRisers * 0.75 &&
    ch.findRiserX(source, "north") !== null &&
    ch.findRiserX(target, "north") !== null
  );
}

/**
 * A source hemmed in on both channel sides can still leave sideways: out of its
 * east edge, clear of whatever sits beside it, then down into the channel. This
 * mirrors the east/west *entry* fallbacks — without it such a flow keeps elk's
 * route, which is how `medium-page`'s INTERINSURER→FRAUD stayed a 2275px wander
 * around the whole page.
 */
function planSidewaysExit(ch: Channel, source: SceneNode): { x: number; y: number } | null {
  const approach = findSideApproach(ch, source, true, true);
  if (!approach) return null;
  ch.usedHorizontals.push({ y: approach.y, left: source.x + source.width, right: approach.x });
  return approach;
}

/** How far down the content spanned by a lane between these two risers reaches. */
function laneDepth(ch: Channel, exitX: number, descentX: number): number {
  const spanLeftX = Math.min(exitX, descentX);
  const spanRightX = Math.max(exitX, descentX);
  const spanned = ch.scene.nodes.filter(
    (node) => node.x < spanRightX && node.x + node.width > spanLeftX,
  );
  return spanned.length
    ? Math.max(...spanned.map((node) => node.y + node.height))
    : ch.maxNodeBottom;
}

function planBottomChannel(
  ch: Channel,
  candidate: Candidate,
  exit: { exitX: number; exitVia?: { y: number } },
  state: PlanState,
): Plan | null {
  const { source, target } = candidate;
  const { exitX, exitVia } = exit;
  const base = { ...candidate, exitX, exitVia };
  const sourceRiser = () => ({ x: exitX, top: source.y + source.height, bottom: INF });

  const southX = ch.findRiserX(target, "south");
  if (southX !== null) {
    ch.usedVerticals.push(sourceRiser());
    ch.usedVerticals.push({ x: southX, top: target.y + target.height, bottom: INF });
    return { ...base, entry: { kind: "south", x: southX } };
  }

  // Coming back up beside the target (east) keeps the lane short, and a short
  // lane clears fewer nodes so it also sits higher; the far-left gutter instead
  // sweeps past groups the flow never had business with. Neither wins always —
  // take whichever leaves the lane higher, and keep the gutter on a tie so
  // settled drawings don't churn.
  const eastEntry = findSideApproach(ch, target, true, true);
  const westX = Math.max(4, ch.contentLeft - 12 - state.westCount * 8);
  const westY = ch.findEntryY({
    target,
    fromBelow: true,
    xStart: westX,
    xEnd: target.x,
    descentX: westX,
    edgeX: target.x,
  });

  // Only a real gain justifies the swap: turning up in the middle of the drawing
  // buys a shorter lane at the price of crossing whatever sits between, so a few
  // px of depth is not worth it.
  if (
    eastEntry &&
    (westY === null ||
      laneDepth(ch, exitX, eastEntry.x) < laneDepth(ch, exitX, westX) - MIN_DEPTH_GAIN)
  ) {
    ch.usedVerticals.push(sourceRiser());
    ch.usedVerticals.push({ x: eastEntry.x, top: eastEntry.y, bottom: INF });
    ch.usedHorizontals.push({
      y: eastEntry.y,
      left: target.x + target.width,
      right: eastEntry.x,
    });
    return { ...base, entry: { kind: "east", ...eastEntry } };
  }

  if (westY !== null) {
    state.westCount++;
    ch.usedVerticals.push(sourceRiser());
    ch.usedVerticals.push({ x: westX, top: westY, bottom: INF });
    ch.usedHorizontals.push({ y: westY, left: westX, right: target.x });
    return { ...base, entry: { kind: "west", x: westX, y: westY } };
  }

  // Last resort: come up in the gutter just left of the target and enter its
  // west side (bottom-channel mirror of the westTop descent).
  const gutter = findSideApproach(ch, target, false, true);
  if (!gutter) return null;
  ch.usedVerticals.push(sourceRiser());
  ch.usedVerticals.push({ x: gutter.x, top: gutter.y, bottom: INF });
  ch.usedHorizontals.push({ y: gutter.y, left: gutter.x, right: target.x });
  return { ...base, entry: { kind: "west", ...gutter } };
}

/** South exit blocked — mirror the route through a top channel instead. */
function planTopChannel(ch: Channel, candidate: Candidate): Plan | null {
  const { source, target } = candidate;
  const exitX = ch.findRiserX(source, "north");
  if (exitX === null) return null;
  const sourceRiser = () => ({ x: exitX, top: -INF, bottom: source.y });

  const entryX = ch.findRiserX(target, "north");
  if (entryX !== null) {
    ch.usedVerticals.push(sourceRiser());
    ch.usedVerticals.push({ x: entryX, top: -INF, bottom: target.y });
    return { ...candidate, exitX, entry: { kind: "north", x: entryX } };
  }

  // The target's own container title covers its whole top, so the flow comes
  // down beside the node instead. Try the side facing the source first (east —
  // these flows all travel leftward), which avoids running the lane past the
  // target only to hook back; otherwise come down on the far side, clearing the
  // container's own border and the title text that overflows it.
  for (const east of [true, false]) {
    const approach = findSideApproach(ch, target, east, false);
    if (!approach) continue;
    ch.usedVerticals.push(sourceRiser());
    ch.usedVerticals.push({ x: approach.x, top: -INF, bottom: approach.y });
    ch.usedHorizontals.push(
      east
        ? { y: approach.y, left: target.x + target.width, right: approach.x }
        : { y: approach.y, left: approach.x, right: target.x },
    );
    return { ...candidate, exitX, entry: { kind: east ? "eastTop" : "westTop", ...approach } };
  }
  return null;
}

function planCandidate(ch: Channel, candidate: Candidate, state: PlanState): Plan | null {
  const { source } = candidate;
  let exitVia: { y: number } | undefined;
  let exitX = prefersTopChannel(ch, candidate) ? null : ch.findRiserX(source, "south");
  if (exitX === null && ch.findRiserX(source, "north") === null) {
    const sideways = planSidewaysExit(ch, source);
    if (sideways) {
      exitVia = { y: sideways.y };
      exitX = sideways.x;
    }
  }
  if (exitX === null) return planTopChannel(ch, candidate);
  return planBottomChannel(ch, candidate, { exitX, exitVia }, state);
}

// Even attachment distribution: when several rerouted flows attach on the
// same side of a node, spread them evenly across that edge — the gap follows
// from the number of flows on that side instead of greedy center-first
// dodging. Slots are assigned left-to-right in current-x order (keeps risers
// from crossing each other); a slot that hits an obstacle keeps its greedy x.
function redistributeAttachments(plans: Plan[], ch: Channel): void {
  interface Attachment {
    plan: Plan;
    role: "exit" | "entry";
  }
  const attachGroups = new Map<string, { node: SceneNode; members: Attachment[] }>();
  const addAttachment = (plan: Plan, role: "exit" | "entry", node: SceneNode, side: string) => {
    const key = `${node.id}|${side}`;
    const group = attachGroups.get(key) ?? { node, members: [] };
    group.members.push({ plan, role });
    attachGroups.set(key, group);
  };
  for (const plan of plans) {
    addAttachment(plan, "exit", plan.source, isTop(plan) ? "north" : "south");
    if (plan.entry.kind === "south") addAttachment(plan, "entry", plan.target, "south");
    if (plan.entry.kind === "north") addAttachment(plan, "entry", plan.target, "north");
  }
  const setAttachmentX = (attachment: Attachment, x: number) => {
    if (attachment.role === "exit") attachment.plan.exitX = x;
    else (attachment.plan.entry as { x: number }).x = x;
  };
  // The far end of an attachment (the x its flow heads toward) — slots are
  // assigned in far-end order so flows leave their shared side without
  // crossing each other (left-going flow takes the left slot).
  const farEndX = (attachment: Attachment): number => {
    const { plan, role } = attachment;
    if (role === "entry") return plan.exitX;
    return plan.entry.x;
  };
  const flowNumber = (attachment: Attachment) => flowNumberOf(attachment.plan.edge);
  const sortedKeys = [...attachGroups.keys()].sort();
  for (const key of sortedKeys) {
    const { node, members } = attachGroups.get(key)!;
    if (members.length < 2) continue;
    const side = key.slice(key.indexOf("|") + 1);
    // Free positions along the side, sampled at 2px — obstacles and title
    // bands fragment the edge, so slots spread across what is usable.
    const freePositions: number[] = [];
    for (let x = node.x + 4; x <= node.x + node.width - 4; x += 2) {
      const clear =
        side === "south"
          ? !ch.blockedBelow(x, node.y + node.height) &&
            !ch.baseRiserConflicts(x, node.y + node.height, INF)
          : !ch.blockedAbove(x, node.y) && !ch.baseRiserConflicts(x, -INF, node.y);
      if (clear) freePositions.push(x);
    }
    if (freePositions.length < members.length) continue;
    // Spreading is only an improvement if the side is wide enough to keep
    // the flows apart. Where a title leaves a narrow strip, evenly spaced
    // slots would sit a few px from each other and read as one line — the
    // greedy positions chosen during planning already clear each other, so
    // keep those and let the crowded-out flow take a side approach instead.
    const usable = freePositions[freePositions.length - 1] - freePositions[0];
    if (usable / (members.length + 1) < MIN_ATTACH_GAP) continue;
    // Slot order = travel direction, then reach descending. Left-bound flows
    // take the left slots, so opposite directions diverge immediately; among
    // flows heading the same way the longest reach sits outermost, so their
    // channel spans nest instead of interleave. Nested spans can be
    // lane-ordered with no crossing at all; interleaved ones cannot.
    const sideCenterX = node.x + node.width / 2;
    const travelsLeft = (member: Attachment) => (farEndX(member) < sideCenterX ? 0 : 1);
    members.sort(
      (memberA, memberB) =>
        travelsLeft(memberA) - travelsLeft(memberB) ||
        farEndX(memberB) - farEndX(memberA) ||
        flowNumber(memberA) - flowNumber(memberB),
    );
    members.forEach((member, index) => {
      const pick =
        freePositions[
          Math.round(((index + 1) * (freePositions.length - 1)) / (members.length + 1))
        ];
      setAttachmentX(member, pick);
    });
  }
}

// ---- phase 4: lane allocation ------------------------------------------------

/**
 * Geometry a lane must not run into. `minOverlap` is how much shared x-span
 * makes this band a real obstacle: a label overlapped at all is a collision; a
 * horizontal segment only reads as a duplicate of our lane when they run
 * alongside each other for a while.
 */
interface Band {
  top: number;
  bottom: number;
  left: number;
  right: number;
  minOverlap: number;
  /** Set for node boxes, so a lane can be exempted from its own container. */
  nodeId?: string;
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Channels hug the node content. Geometry elk left *outside* it — its own
 * wrap-around routes and their labels — is deliberately not an anchor, or one
 * stray wrap pushes the whole channel off the drawing, wasting a band and
 * forcing our flows across that wrap. It becomes a blocking band instead,
 * nudging an individual lane only where their x-spans meet.
 */
function buildBlockingBands(scene: Scene, rerouted: Set<string>): Band[] {
  const bands: Band[] = [];
  for (const edge of scene.edges) {
    if (rerouted.has(edge.id)) continue;
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const pointA = edge.pts[index];
      const pointB = edge.pts[index + 1];
      if (Math.abs(pointA.y - pointB.y) < 0.5 && Math.abs(pointA.x - pointB.x) >= 0.5)
        bands.push({
          // Padded: a lane running a few px from an elk horizontal over a long
          // shared span reads as one thick line, not two flows.
          top: pointA.y - LINE_CLEARANCE,
          bottom: pointA.y + LINE_CLEARANCE,
          left: Math.min(pointA.x, pointB.x),
          right: Math.max(pointA.x, pointB.x),
          minOverlap: MIN_PARALLEL_RUN,
        });
    }
    for (const label of edge.labels)
      bands.push({
        top: label.y,
        bottom: label.y + label.height,
        left: label.x,
        right: label.x + label.width,
        minOverlap: 0,
      });
  }
  // Node boxes block too, now that a lane may be raised alongside the content
  // instead of always sitting past all of it.
  for (const node of scene.nodes)
    bands.push({
      top: node.y,
      bottom: node.y + node.height,
      left: node.x,
      right: node.x + node.width,
      minOverlap: 0,
      nodeId: node.id,
    });
  return bands;
}

function bandConflicts(bands: Band[], rect: Rect, exempt: Set<string>): boolean {
  return bands.some((band) => {
    const shared = Math.min(band.right, rect.right) - Math.max(band.left, rect.left);
    if (band.nodeId && exempt.has(band.nodeId)) {
      // The inside of this container is open to the lane, but its borders
      // are still lines: running alongside one reads as a doubled edge.
      if (shared <= MIN_PARALLEL_RUN) return false;
      return [band.top, band.bottom].some(
        (border) => border - LINE_CLEARANCE < rect.bottom && rect.top < border + LINE_CLEARANCE,
      );
    }
    return band.top < rect.bottom && rect.top < band.bottom && shared > band.minOverlap;
  });
}

const enclosersOf = (containerNodes: SceneNode[], node: SceneNode) =>
  containerNodes.filter(
    (box) =>
      box.id !== node.id &&
      box.x <= node.x &&
      node.x + node.width <= box.x + box.width &&
      box.y <= node.y &&
      node.y + node.height <= box.y + box.height,
  );

/**
 * Containers that geometrically hold both ends. A flow whose two ends live in
 * the same container has no business leaving it: that container is neither an
 * anchor nor an obstacle for its lane, which belongs in the free space inside
 * it. Without this a flow between two boxes of one data centre dives under the
 * whole drawing and drags the canvas down with it.
 */
function sharedEnclosers(
  containerNodes: SceneNode[],
  plan: { source: SceneNode; target: SceneNode },
): Set<string> {
  const around = new Set(enclosersOf(containerNodes, plan.source).map((box) => box.id));
  return new Set(
    enclosersOf(containerNodes, plan.target)
      .filter((box) => around.has(box.id))
      .map((box) => box.id),
  );
}

/** Lane allocation: non-overlapping x-intervals share a lane (first fit). */
function makeAllocator() {
  const lanes: { rangeStart: number; rangeEnd: number }[][] = [];
  return (intervalStart: number, intervalEnd: number): number => {
    const rangeStart = Math.min(intervalStart, intervalEnd) - 4;
    const rangeEnd = Math.max(intervalStart, intervalEnd) + 4;
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const hasOverlap = lanes[laneIndex].some(
        (existing) => existing.rangeStart < rangeEnd && rangeStart < existing.rangeEnd,
      );
      if (hasOverlap) continue;
      lanes[laneIndex].push({ rangeStart, rangeEnd });
      return laneIndex;
    }
    lanes.push([{ rangeStart, rangeEnd }]);
    return lanes.length - 1;
  };
}

const spanLeft = (plan: Plan) => Math.min(plan.exitX, plan.entry.x);
const spanRight = (plan: Plan) => Math.max(plan.exitX, plan.entry.x);
const enclosedBy = (inner: Plan, outer: Plan) =>
  spanLeft(outer) <= spanLeft(inner) &&
  spanRight(inner) <= spanRight(outer) &&
  spanRight(inner) - spanLeft(inner) < spanRight(outer) - spanLeft(outer);

/**
 * Lanes are handed out innermost span first, so a span that *contains* another
 * lands on a deeper lane. With the nesting the slot order produces, a riser can
 * never cross the lane of a flow it encloses, leaving only the crossings
 * genuinely interleaved spans force. Containment is a partial order, so this is
 * a topological pass, not a sort: flows that enclose nothing keep plain flow-id
 * order and their lanes do not move.
 */
function assignLanes(
  subset: Plan[],
  laneIndexOf: Map<string, number>,
  alloc: (start: number, end: number) => number,
): void {
  const remaining = [...subset].sort(
    (planA, planB) => flowNumberOf(planA.edge) - flowNumberOf(planB.edge),
  );
  while (remaining.length) {
    const innermost = remaining.findIndex(
      (plan) => !remaining.some((other) => other !== plan && enclosedBy(other, plan)),
    );
    const [plan] = remaining.splice(innermost < 0 ? 0 : innermost, 1);
    laneIndexOf.set(plan.edge.id, alloc(plan.exitX, plan.entry.x));
  }
}

interface LaneContext {
  scene: Scene;
  bands: Band[];
  containerNodes: SceneNode[];
  laneIndexOf: Map<string, number>;
}

function createLaneContext(scene: Scene, rerouted: Set<string>): LaneContext {
  return {
    scene,
    bands: buildBlockingBands(scene, rerouted),
    containerNodes: scene.nodes.filter((node) => node.container),
    laneIndexOf: new Map<string, number>(),
  };
}

/** What one lane occupies, once its members are known. */
interface LaneSpan {
  left: number;
  right: number;
  exempt: Set<string>;
  labelHeight: number;
  start: number;
}

/**
 * Each lane sits just outside the content it actually spans. Anchoring on the
 * drawing's full extent lets a node the lane never passes under — a tall actor
 * group off to one side — push it far out, leaving a band of nothing between the
 * lane and the boxes it serves.
 */
function spanAnchor(
  scene: Scene,
  span: { left: number; right: number; exempt: Set<string> },
  direction: 1 | -1,
  anchor: number,
): number {
  const spanned = scene.nodes.filter(
    (node) => !span.exempt.has(node.id) && node.x < span.right && node.x + node.width > span.left,
  );
  if (!spanned.length) return anchor;
  return direction > 0
    ? Math.max(...spanned.map((node) => node.y + node.height))
    : Math.min(...spanned.map((node) => node.y));
}

/** Push a lane out from its preferred spot until it and its label band are clear. */
function resolveLanePosition(lc: LaneContext, span: LaneSpan, direction: 1 | -1): number {
  const { left, right, exempt, labelHeight } = span;
  const fits = (candidate: number) =>
    !bandConflicts(
      lc.bands,
      direction > 0
        ? { top: candidate - 1, bottom: candidate + labelHeight + 3, left, right }
        : { top: candidate - labelHeight - 3, bottom: candidate + 1, left, right },
      exempt,
    );
  let position = span.start;
  // Before giving up on a spot, try tightening the approach gap. The room
  // inside a container is finite, and a lane that fits there on a 6px gap
  // is far better than one pushed out of the container for want of 2px.
  if (!fits(position))
    for (const gap of [8, 6, 4]) {
      const tighter = position - direction * (CHANNEL_GAP - gap);
      if (fits(tighter)) {
        position = tighter;
        break;
      }
    }
  // Otherwise move outward until the lane and its label band are clear.
  for (let guard = 0; guard < 80; guard++) {
    if (fits(position)) break;
    position += direction * 6;
  }
  return position;
}

/**
 * Where each lane of `subset` sits. Spacing uses the label heights that lane
 * carries, and it is pushed further only to clear geometry sharing its x-span.
 */
function laneOffsets(
  lc: LaneContext,
  subset: Plan[],
  direction: 1 | -1,
  anchor: number,
): number[] {
  const byLane = new Map<number, Plan[]>();
  for (const plan of subset) {
    const lane = lc.laneIndexOf.get(plan.edge.id)!;
    byLane.set(lane, [...(byLane.get(lane) ?? []), plan]);
  }
  const labelHeights: number[] = [];
  const positions: number[] = [];
  for (let lane = 0; lane < byLane.size; lane++) {
    const members = byLane.get(lane) ?? [];
    const labelHeight = Math.max(
      0,
      ...members.flatMap((plan) => plan.edge.labels.map((label) => label.height)),
    );
    const left = Math.min(...members.map(spanLeft));
    const right = Math.max(...members.map(spanRight));
    // Only a container holding *every* flow on this lane may be entered.
    const exempt = new Set<string>();
    if (members.length) {
      const perMember = members.map((plan) => sharedEnclosers(lc.containerNodes, plan));
      for (const id of perMember[0])
        if (perMember.every((enclosers) => enclosers.has(id))) exempt.add(id);
    }
    // Labels sit on the *outer* side of their lane, away from the drawing. The
    // top channel always did; the bottom channel used to put them between the
    // content and the lane, which pushed every bottom lane out by a whole label
    // and left a conspicuous gap against the container it hugged on the other
    // side.
    const ownPosition = spanAnchor(lc.scene, { left, right, exempt }, direction, anchor) +
      direction * CHANNEL_GAP;
    // Lanes stay ordered: a deeper lane never rises above a shallower one,
    // which is what keeps enclosing spans outside the ones they enclose.
    const start =
      lane === 0
        ? ownPosition
        : direction > 0
          ? Math.max(ownPosition, positions[lane - 1] + labelHeights[lane - 1] + 14)
          : Math.min(ownPosition, positions[lane - 1] - (labelHeights[lane - 1] + 14));
    labelHeights.push(labelHeight);
    positions.push(
      resolveLanePosition(lc, { left, right, exempt, labelHeight, start }, direction),
    );
  }
  return positions;
}

// ---- phase 5: emitting the geometry ------------------------------------------

function placeLaneLabels(
  edge: SceneEdge,
  span: { from: number; to: number },
  laneY: number,
  outward: 1 | -1,
): void {
  for (const label of edge.labels) {
    const segmentStart = Math.min(span.from, span.to);
    const segmentEnd = Math.max(span.from, span.to);
    const midpoint = (segmentStart + segmentEnd) / 2 - label.width / 2;
    label.x = Math.min(Math.max(midpoint, segmentStart + 4), segmentEnd - 4 - label.width);
    // Away from the drawing, so the lane itself can hug the content.
    label.y = outward > 0 ? laneY + 3 : laneY - label.height - 3;
  }
}

/** Numbered views tag the flow at its arrival instead of along the lane. */
function placeNumberedLabels(edge: SceneEdge, target: SceneNode, entry: Plan["entry"]): void {
  for (const label of edge.labels) {
    if (entry.kind === "north") {
      label.x = entry.x + 6;
      label.y = target.y - label.height - 6;
    } else if (entry.kind === "south") {
      label.x = entry.x + 6;
      label.y = target.y + target.height + 6;
    } else if (entry.kind === "east" || entry.kind === "eastTop") {
      label.x = target.x + target.width + 6;
      label.y = entry.y - label.height - 6;
    } else {
      label.x = target.x - label.width - 6;
      label.y = entry.y - label.height - 6;
    }
  }
}

function emitTopRoute(plan: TopPlan, laneY: number, numbered: boolean): void {
  const { edge, source, target, exitX, entry } = plan;
  edge.pts =
    entry.kind === "north"
      ? [
          { x: exitX, y: source.y },
          { x: exitX, y: laneY },
          { x: entry.x, y: laneY },
          { x: entry.x, y: target.y },
        ]
      : [
          { x: exitX, y: source.y },
          { x: exitX, y: laneY },
          { x: entry.x, y: laneY },
          { x: entry.x, y: entry.y },
          {
            x: entry.kind === "eastTop" ? target.x + target.width : target.x,
            y: entry.y,
          },
        ];
  if (numbered) placeNumberedLabels(edge, target, entry);
  else placeLaneLabels(edge, { from: exitX, to: entry.x }, laneY, -1);
}

function emitBottomRoute(plan: BottomPlan, laneY: number, numbered: boolean): void {
  const { edge, source, target, exitX, entry } = plan;
  const farX = entry.x;
  // A boxed-in source leaves sideways and turns down; otherwise it drops
  // straight out of the edge facing the channel.
  const head = plan.exitVia
    ? [
        { x: source.x + source.width, y: plan.exitVia.y },
        { x: exitX, y: plan.exitVia.y },
        { x: exitX, y: laneY },
      ]
    : [
        { x: exitX, y: source.y + source.height },
        { x: exitX, y: laneY },
      ];

  edge.detour = true;
  if (entry.kind === "south") {
    edge.pts = [...head, { x: farX, y: laneY }, { x: farX, y: target.y + target.height }];
  } else if (entry.kind === "east") {
    edge.pts = [
      ...head,
      { x: farX, y: laneY },
      { x: farX, y: entry.y },
      { x: target.x + target.width, y: entry.y },
    ];
  } else {
    edge.pts = [
      ...head,
      { x: farX, y: laneY },
      { x: farX, y: entry.y },
      { x: target.x, y: entry.y },
    ];
  }

  if (numbered) placeNumberedLabels(edge, target, entry);
  else placeLaneLabels(edge, { from: exitX, to: farX }, laneY, 1);
}

/**
 * Top-channel lanes (and their labels) may extend above y=0 — shift the whole
 * scene down so every coordinate stays positive. Callers guard on top plans
 * existing, so bottom-only reroutes stay byte-identical.
 */
function shiftAboveOrigin(scene: Scene): void {
  let minY = 4;
  for (const edge of scene.edges) {
    for (const point of edge.pts) minY = Math.min(minY, point.y);
    for (const label of edge.labels) minY = Math.min(minY, label.y);
  }
  if (minY >= 4) return;
  const shift = 4 - minY;
  for (const node of scene.nodes) node.y += shift;
  for (const edge of scene.edges) {
    for (const point of edge.pts) point.y += shift;
    for (const label of edge.labels) label.y += shift;
  }
}

function resizeScene(scene: Scene): void {
  let maxX = 0;
  let maxY = 0;
  for (const node of scene.nodes) {
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  for (const edge of scene.edges) {
    for (const point of edge.pts) {
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    for (const label of edge.labels) {
      maxX = Math.max(maxX, label.x + label.width);
      maxY = Math.max(maxY, label.y + label.height);
    }
  }
  scene.width = Math.ceil(maxX + 10);
  scene.height = Math.ceil(maxY + 10);
}

export function rerouteDetours(
  scene: Scene,
  model: Model,
  numbered: boolean,
  titleBoxes: TitleBox[] = [],
): void {
  const candidates = detourCandidates(scene, model);
  if (!candidates.length) return;

  const channel = createChannel(scene, titleBoxes, candidates);
  const state: PlanState = { westCount: 0 };
  const plans: Plan[] = [];
  for (const candidate of candidates) {
    const planned = planCandidate(channel, candidate, state);
    // Failed candidates keep elk's route — their verticals stay obstacles.
    if (planned) plans.push(planned);
    else channel.addEdgeVerticals(candidate.edge);
  }
  if (!plans.length) return;

  redistributeAttachments(plans, channel);

  const lanes = createLaneContext(scene, new Set(plans.map((plan) => plan.edge.id)));
  const bottomPlans = plans.filter(isBottom);
  const topPlans = plans.filter(isTop);
  assignLanes(bottomPlans, lanes.laneIndexOf, makeAllocator());
  assignLanes(topPlans, lanes.laneIndexOf, makeAllocator());

  const bottomLaneY = laneOffsets(lanes, bottomPlans, 1, channel.maxNodeBottom);
  const topLaneY = laneOffsets(lanes, topPlans, -1, channel.minNodeTop);

  for (const plan of plans) {
    const lane = lanes.laneIndexOf.get(plan.edge.id)!;
    if (isTop(plan)) emitTopRoute(plan, topLaneY[lane], numbered);
    else if (isBottom(plan)) emitBottomRoute(plan, bottomLaneY[lane], numbered);
  }

  if (topPlans.length) shiftAboveOrigin(scene);
  resizeScene(scene);
}
