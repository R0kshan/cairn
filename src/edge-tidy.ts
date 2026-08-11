/**
 * Stage 4c: makes every flow readable at its endpoints, whoever routed it.
 *
 * Three defects elk leaves behind — micro-jogs (offsets of a pixel or two,
 * collapsed by `straighten` up to `SNAP`), S-curves (two same-direction runs one
 * step apart, fixed by merging the *turn* so a wide staircase costs no more than
 * a narrow one), and shared attachment points (two flows on one spot, pushed to
 * `MIN_ATTACH_GAP`).
 *
 * Straightening and collapsing run before separation, which moves a terminal run
 * rigidly and must not reintroduce a jog just removed. Both validate the
 * *finished* polyline and revert wholesale — validating only the changed part
 * once merged two flows into one line.
 *
 * Deterministic: fixed iteration order, plain arithmetic, every movement clamped
 * to the node side it belongs to.
 */

import type { Scene, SceneEdge, SceneNode } from "./scene-layout.ts";
import { inspect, ladderVerdict } from "./readability.ts";
import type { Profile } from "./readability.ts";
import {
  type Point,
  type TitleBox,
  MIN_ATTACH_GAP,
  pathLength as sharedPathLength,
} from "./geometry.ts";

/** A coordinate delta this small is float noise, not a real offset — the
 *  tolerance every axis-alignment / collinearity check in this file uses. */
const ORTHOGONAL_EPSILON = 0.5;
/** A run must overlap this much of a node's side before it counts as hugging
 *  that side, rather than merely passing near a corner. */
const MIN_HUG_SPAN = 24;
/** Inset of a channel route's two mid-line turns from the shared midpoint,
 *  keeping them off the endpoints they connect. */
const CHANNEL_INSET = 24;
/** A segment this far off orthogonal is a rounding artefact, not a turn. */
const SNAP = 6;
/**
 * A step this short between two runs going the same way is a staircase, not a
 * detour. Kept at 6 deliberately: collapsing wider steps means moving a run by
 * that much, and a sweep over every example × disposition showed 20px trading
 * 264 staircases for 24 flows dragged through node boxes, 12 merged lines and
 * 14 shared attachment points. Widening this needs every mutation in the pass
 * guarded and iterated to a fixpoint, not a bigger number.
 */
const JOG_SNAP = 6;
/** Keep attachments off the corners — squeezed toward `MIN_SIDE_INSET` when a
 *  side has to seat more flows than it comfortably holds. */
const SIDE_INSET = 6;
const MIN_SIDE_INSET = 3;
/**
 * How far from a node a crossing between two flows on the same side still reads
 * as part of that node's fan. Mirrors the sweep's `FAN_REACH` exactly, so the
 * S-curve collapse and the `fanTangle` gate judge one condition — a guard
 * testing a different distance is how the two ended up calibrated against each
 * other instead of against the invariant (§3).
 */
const FAN_REACH = 48;

/** Where two orthogonal segments properly cross, or null (strict, so a shared
 *  endpoint is not a crossing — that's `attachShared`, not a tangle). */
const segmentsCross = (a1: Point, a2: Point, b1: Point, b2: Point): Point | null => {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(b1, b2, a1) > 0;
  const d2 = side(b1, b2, a2) > 0;
  const d3 = side(a1, a2, b1) > 0;
  const d4 = side(a1, a2, b2) > 0;
  if (d1 === d2 || d3 === d4) return null;
  const aVertical = Math.abs(a1.x - a2.x) < ORTHOGONAL_EPSILON;
  return aVertical ? { x: a1.x, y: b1.y } : { x: b1.x, y: a1.y };
};

type Side = "north" | "south" | "east" | "west";

const segmentLength = (a: Point, b: Point) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

/** The merge guard: a run this close (`gap`) with this much overlap
 *  (`shared`) reads as one line, not two — see READABILITY_METRICS.md. */
const wouldMerge = (gap: number, shared: number) =>
  (gap < 4 && shared > 6) || (gap < 11 && shared > 36);

/**
 * Collapses every deviation smaller than `SNAP` so the polyline runs straight
 * between real turns. Endpoints keep the border they sit on and may only slide
 * along it — the caller clamps them back inside the node afterwards.
 */
function straighten(
  points: Point[],
  runIsClear: (vertical: boolean, at: number, from: number, to: number) => boolean,
): Point[] {
  const pts = points.map((point) => ({ ...point }));
  const skipped = new Set<number>();

  // Near-diagonals become orthogonal. The interior point gives way, so an
  // endpoint never leaves its border.
  for (let index = 0; index + 1 < pts.length; index++) {
    const deltaX = pts[index + 1].x - pts[index].x;
    const deltaY = pts[index + 1].y - pts[index].y;
    if (Math.abs(deltaX) < ORTHOGONAL_EPSILON || Math.abs(deltaY) < ORTHOGONAL_EPSILON) continue;
    if (Math.min(Math.abs(deltaX), Math.abs(deltaY)) > SNAP) continue;
    const moveLater = index + 1 < pts.length - 1;
    const from = moveLater ? pts[index] : pts[index + 1];
    const to = moveLater ? pts[index + 1] : pts[index];
    if (Math.abs(deltaX) >= Math.abs(deltaY)) to.y = from.y;
    else to.x = from.x;
  }

  for (let guard = 0; guard < 60; guard++) {
    let changed = false;

    // Drop a point that no longer turns anything.
    for (let index = 1; index + 1 < pts.length; index++) {
      const straightX =
        Math.abs(pts[index].x - pts[index - 1].x) <= ORTHOGONAL_EPSILON &&
        Math.abs(pts[index + 1].x - pts[index].x) <= ORTHOGONAL_EPSILON;
      const straightY =
        Math.abs(pts[index].y - pts[index - 1].y) <= ORTHOGONAL_EPSILON &&
        Math.abs(pts[index + 1].y - pts[index].y) <= ORTHOGONAL_EPSILON;
      if (straightX || straightY) {
        pts.splice(index, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // Remove a jog: a short segment whose neighbours run the other way. The
    // longer neighbour keeps its position, so the line settles where most of
    // it already was.
    for (let index = 0; index + 1 < pts.length; index++) {
      const length = segmentLength(pts[index], pts[index + 1]);
      if (length === 0) {
        pts.splice(index + 1, 1);
        changed = true;
        break;
      }
      if (length > JOG_SNAP) continue;
      if (skipped.has(index)) continue;
      const hasBefore = index - 1 >= 0;
      const hasAfter = index + 2 < pts.length;
      if (!hasBefore && !hasAfter) continue;
      const beforeLength = hasBefore ? segmentLength(pts[index - 1], pts[index]) : -1;
      const afterLength = hasAfter ? segmentLength(pts[index + 1], pts[index + 2]) : -1;
      const anchors = (
        beforeLength >= afterLength
          ? [hasBefore ? pts[index - 1] : null, hasAfter ? pts[index + 2] : null]
          : [hasAfter ? pts[index + 2] : null, hasBefore ? pts[index - 1] : null]
      ).filter((point): point is Point => point !== null);
      const vertical = Math.abs(pts[index + 1].x - pts[index].x) < ORTHOGONAL_EPSILON;
      const touched = [pts[index], pts[index + 1]];
      if (hasBefore) touched.push(pts[index - 1]);
      if (hasAfter) touched.push(pts[index + 2]);
      // Straightness must not merge two flows into one line: settle on the
      // first anchor whose resulting run is free, else leave the jog.
      const spanOf = (point: Point) => (vertical ? point.x : point.y);
      const from = Math.min(...touched.map(spanOf));
      const to = Math.max(...touched.map(spanOf));
      const anchor = anchors.find((candidate) =>
        runIsClear(!vertical, vertical ? candidate.y : candidate.x, from, to),
      );
      if (!anchor) {
        skipped.add(index);
        continue;
      }
      for (const point of touched) {
        if (vertical) point.y = anchor.y;
        else point.x = anchor.x;
      }
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return pts;
}

/** The node side a terminal point sits on, if any. */
function sideOf(point: Point, nodes: SceneNode[]): { node: SceneNode; side: Side } | null {
  for (const node of nodes) {
    const withinX = point.x > node.x - 2 && point.x < node.x + node.width + 2;
    const withinY = point.y > node.y - 2 && point.y < node.y + node.height + 2;
    if (withinX && Math.abs(point.y - node.y) < 2) return { node, side: "north" };
    if (withinX && Math.abs(point.y - (node.y + node.height)) < 2) return { node, side: "south" };
    if (withinY && Math.abs(point.x - node.x) < 2) return { node, side: "west" };
    if (withinY && Math.abs(point.x - (node.x + node.width)) < 2) return { node, side: "east" };
  }
  return null;
}

/** Does an axis-aligned run at `at`, spanning `from`..`to`, cut through a leaf? */
function runHitsNodeIn(
  vertical: boolean,
  at: number,
  from: number,
  to: number,
  leaves: SceneNode[],
): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return leaves.some((node) => {
    const across = vertical
      ? at > node.x + 1 && at < node.x + node.width - 1
      : at > node.y + 1 && at < node.y + node.height - 1;
    if (!across) return false;
    return vertical
      ? node.y < hi - 1 && node.y + node.height > lo + 1
      : node.x < hi - 1 && node.x + node.width > lo + 1;
  });
}

function enforceOrthogonalOn(edge: SceneEdge, leaves: SceneNode[]): void {
  const pts = edge.pts;
  const seats = [sideOf(pts[0], leaves), sideOf(pts[pts.length - 1], leaves)];
  const borderAxis = (index: number): "x" | "y" | null => {
    const seat = index === 0 ? seats[0] : index === pts.length - 1 ? seats[1] : null;
    if (!seat) return null;
    return seat.side === "north" || seat.side === "south" ? "y" : "x";
  };
  for (let guard = 0; guard < 20; guard++) {
    let fixed = false;
    for (let index = 0; index + 1 < pts.length; index++) {
      const deltaX = pts[index + 1].x - pts[index].x;
      const deltaY = pts[index + 1].y - pts[index].y;
      if (Math.abs(deltaX) < ORTHOGONAL_EPSILON || Math.abs(deltaY) < ORTHOGONAL_EPSILON) continue;
      const axis: "x" | "y" = Math.abs(deltaX) >= Math.abs(deltaY) ? "y" : "x";
      const movable = (candidate: number) =>
        (candidate !== 0 && candidate !== pts.length - 1) || borderAxis(candidate) !== axis;
      // Squaring a segment moves a point, and after a wide jog collapse that
      // move can be large enough to drag the run across a node. Prefer the
      // end that keeps it clear; if neither does, squareness still wins —
      // a slanted flow is never acceptable.
      const options = [index + 1, index].filter(movable);
      if (!options.length) continue;
      const clear = options.find((candidate) => {
        const other = candidate === index + 1 ? index : index + 1;
        const at = pts[other][axis];
        const span =
          axis === "y" ? [pts[index].x, pts[index + 1].x] : [pts[index].y, pts[index + 1].y];
        return !runHitsNodeIn(axis === "x", at, span[0], span[1], leaves);
      });
      const target = clear ?? options[0];
      pts[target][axis] = pts[target === index + 1 ? index : index + 1][axis];
      fixed = true;
    }
    if (!fixed) break;
  }
}

interface Attachment {
  edge: SceneEdge;
  /** Index of the terminal point, and of the neighbour that follows it inward. */
  terminal: number;
  neighbour: number;
  along: number;
}

/**
 * Spread the attachments that share a node side (§4b), so each terminal keeps
 * `MIN_ATTACH_GAP` of its own — the ladder's tier-4 `tight` model, as a pass.
 *
 * Runs twice: once inside `tidyEdges`, before `compact`, and again after
 * `optimiseRoutes`, which deliberately trades a lower-tier defect for a
 * tier-4 `tight` when every reachable seat sits close to a sibling — the
 * repair that resolves the residue must run after the pass that creates it.
 * A side already compliant is skipped, so this converges rather than churns.
 */
export function spreadAttachments(scene: Scene): void {
  const leaves = scene.nodes.filter((node) => !node.container);
  if (!leaves.length) return;
  const runsExcept = (...edgeIds: string[]) => {
    const horizontal: { lo: number; hi: number; at: number }[] = [];
    const vertical: { lo: number; hi: number; at: number }[] = [];
    for (const edge of scene.edges) {
      if (edgeIds.includes(edge.id)) continue;
      for (let index = 0; index + 1 < edge.pts.length; index++) {
        const a = edge.pts[index];
        const b = edge.pts[index + 1];
        if (Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON && Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON)
          horizontal.push({ lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), at: a.y });
        else if (
          Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON &&
          Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON
        )
          vertical.push({ lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), at: a.x });
      }
    }
    return { horizontal, vertical };
  };
  const runHitsNode = (vertical: boolean, at: number, from: number, to: number) =>
    runHitsNodeIn(vertical, at, from, to, leaves);
  const runIsClear = (
    others: { lo: number; hi: number; at: number }[],
    at: number,
    from: number,
    to: number,
  ) =>
    !others.some((other) => {
      const gap = Math.abs(other.at - at);
      const shared =
        Math.min(other.hi, Math.max(from, to)) - Math.max(other.lo, Math.min(from, to));
      return wouldMerge(gap, shared);
    });
  const enforceOrthogonal = (edge: SceneEdge) => enforceOrthogonalOn(edge, leaves);

  // Group the endpoints landing on each node side.
  const groups = new Map<string, { node: SceneNode; side: Side; members: Attachment[] }>();
  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    for (const [terminal, neighbour] of [
      [0, 1],
      [edge.pts.length - 1, edge.pts.length - 2],
    ] as const) {
      const seat = sideOf(edge.pts[terminal], leaves);
      if (!seat) continue;
      const vertical = seat.side === "east" || seat.side === "west";
      const key = `${seat.node.id}|${seat.side}`;
      const group = groups.get(key) ?? { node: seat.node, side: seat.side, members: [] };
      group.members.push({
        edge,
        terminal,
        neighbour,
        along: vertical ? edge.pts[terminal].y : edge.pts[terminal].x,
      });
      groups.set(key, group);
    }
  }

  // Separating a two-point flow moves both of its ends, so a later side can
  // undo the spacing an earlier one just set. A couple of passes settles it;
  // a side already compliant is skipped, so this converges rather than churns.
  const sortedKeys = [...groups.keys()].sort();
  for (let round = 0; round < 3; round++)
    for (const key of sortedKeys) {
      const { node, side, members } = groups.get(key)!;
      if (members.length < 2) continue;
      const vertical = side === "east" || side === "west";
      for (const member of members)
        member.along = vertical
          ? member.edge.pts[member.terminal].y
          : member.edge.pts[member.terminal].x;
      const start = vertical ? node.y : node.x;
      const length = vertical ? node.height : node.width;
      // A crowded side gives up its corner margin before it gives up the gap.
      const needed = (members.length - 1) * MIN_ATTACH_GAP;
      const inset =
        length - 2 * SIDE_INSET >= needed
          ? SIDE_INSET
          : Math.max(MIN_SIDE_INSET, (length - needed) / 2);
      const low = start + inset;
      const high = start + length - inset;
      members.sort(
        (memberA, memberB) =>
          memberA.along - memberB.along ||
          parseInt(memberA.edge.id.slice(1), 10) - parseInt(memberB.edge.id.slice(1), 10),
      );
      if (
        members.every(
          (member, index) =>
            index === 0 || member.along - members[index - 1].along >= MIN_ATTACH_GAP,
        )
      )
        continue;

      // Least-movement spread: push forward, then back off against the far end.
      const wanted = members.map((member) => member.along);
      for (let index = 1; index < wanted.length; index++)
        wanted[index] = Math.max(wanted[index], wanted[index - 1] + MIN_ATTACH_GAP);
      wanted[wanted.length - 1] = Math.min(wanted[wanted.length - 1], high);
      for (let index = wanted.length - 2; index >= 0; index--)
        wanted[index] = Math.min(wanted[index], wanted[index + 1] - MIN_ATTACH_GAP);
      // Still too short: spread over the whole side at the widest gap it holds,
      // rather than giving up and leaving two flows on top of each other.
      if (wanted[0] < low) {
        const step = (high - low) / (members.length - 1);
        for (let index = 0; index < wanted.length; index++) wanted[index] = low + index * step;
      }

      // Two passes. The first keeps every guard; the second runs only for flows
      // still sharing a point afterwards, and drops the parallel-run guard for
      // them — two flows drifting alongside each other is a blemish, two flows
      // leaving a node at the same point is unreadable, so the blemish wins.
      for (const relaxed of [false, true]) {
        if (relaxed) {
          const sorted = [...members].sort((a, b) => a.along - b.along);
          const stillShared = sorted.some(
            (member, index) => index > 0 && member.along - sorted[index - 1].along < 6,
          );
          if (!stillShared) break;
        }
        members.forEach((member, index) => {
          const target = wanted[index];
          if (Math.abs(target - member.along) < 0.01) return;
          const { edge, terminal, neighbour } = member;
          const terminalPoint = edge.pts[terminal];
          const neighbourPoint = edge.pts[neighbour];
          const straightRun = vertical
            ? Math.abs(neighbourPoint.y - terminalPoint.y) < ORTHOGONAL_EPSILON
            : Math.abs(neighbourPoint.x - terminalPoint.x) < ORTHOGONAL_EPSILON;
          // Move the whole terminal run so it stays straight.
          if (!straightRun) return;
          if (edge.pts.length === 2) {
            // Nothing interior to absorb the shift, so the far end has to come
            // along; it may only do so while staying on its own node's side.
            const farSeat = sideOf(neighbourPoint, leaves);
            if (!farSeat) return;
            const farVertical = farSeat.side === "east" || farSeat.side === "west";
            if (farVertical !== vertical) return;
            const farStart = vertical ? farSeat.node.y : farSeat.node.x;
            const farLength = vertical ? farSeat.node.height : farSeat.node.width;
            if (
              target < farStart + MIN_SIDE_INSET ||
              target > farStart + farLength - MIN_SIDE_INSET
            )
              return;
          }
          // Siblings on this side are exempt: they are being spread apart on
          // purpose, and MIN_ATTACH_GAP — not the parallel-run rule — governs how
          // close they may end up. Without this the guard blocks the very
          // separation it is meant to protect.
          const others = runsExcept(...members.map((sibling) => sibling.edge.id));
          const runFrom = vertical ? terminalPoint.x : terminalPoint.y;
          const runTo = vertical ? neighbourPoint.x : neighbourPoint.y;
          const list = vertical ? others.horizontal : others.vertical;
          const clear =
            !runHitsNode(!vertical, target, runFrom, runTo) &&
            (relaxed
              ? !list.some(
                  (other) =>
                    Math.abs(other.at - target) < 4 &&
                    Math.min(other.hi, Math.max(runFrom, runTo)) -
                      Math.max(other.lo, Math.min(runFrom, runTo)) >
                      6,
                )
              : runIsClear(list, target, runFrom, runTo));
          // Leave the flow where elk put it rather than merge it into another.
          if (!clear) return;
          if (vertical) {
            terminalPoint.y = target;
            neighbourPoint.y = target;
          } else {
            terminalPoint.x = target;
            neighbourPoint.x = target;
          }
          member.along = target;
        });
      }
    }

  // A separation move can tilt a jog that straightening had to leave in place.
  for (const edge of scene.edges) if (edge.pts.length >= 2) enforceOrthogonal(edge);
}

/**
 * Push runs off the node and container sides they do not attach to (sweep
 * `sideHug`). Within 3px of a side over more than 24px of shared span, flow and
 * frame draw as one line — logical-archi had a riser at x=1027 riding
 * SUIV_FLUX's side at x=1026, medium-tall one along a layer for 207px.
 *
 * The move is a translation to a clearance, clamped by how far the terminal may
 * slide along its border. A leaf side clears outward only; a container side
 * clears toward whichever half the run already sits in. Anything unprovable
 * clean — sibling seats, jog collapse, leaf hit, re-hug, merged run, bought
 * crossing — stays in place as ladder debt.
 *
 * Called from `tidyEdges` and again after `compactVertical`, which shrinks the
 * gaps this pass judges: a run clear before compaction can hug a side after.
 */
interface HugRun {
  vert: boolean;
  at: number;
  lo: number;
  hi: number;
  i: number;
}

/** Shared state and predicates every `clearSideHugs` closure needs.
 *  `otherSideRuns` is mutated in place by `attemptHugFix`/`relocateRiser`/
 *  `resideAtSide` as edges move, so later checks in the same pass see the
 *  latest geometry. */
interface HugContext {
  scene: Scene;
  leaves: SceneNode[];
  tier0Blocked(pts: Point[], fromIdx: number, owns: Set<SceneNode>): boolean;
  sideRunsOf(edge: SceneEdge): HugRun[];
  hugTargetOf(
    run: { vert: boolean; at: number; lo: number; hi: number },
    node: SceneNode,
  ): number | null;
  hugTargetsOf(
    run: { vert: boolean; at: number; lo: number; hi: number },
    node: SceneNode,
  ): number[];
  runHitsNode(vertical: boolean, at: number, from: number, to: number): boolean;
  containerOf(node: SceneNode): SceneNode | null;
  otherSideRuns: Map<string, HugRun[]>;
}

function createHugContext(scene: Scene, titleBoxes: TitleBox[]): HugContext {
  const SIDE_CLEAR = 8;
  const leaves = scene.nodes.filter((node) => !node.container);
  /**
   * Tier-0 gate: the changed segments (from `fromIdx` on) may not strike a
   * container's name, nor cross a container holding neither endpoint — tier 0 is
   * never purchasable. The re-side machinery was measured introducing exactly
   * these on large-numbered/wide's F28. `owns` is the edge's endpoint nodes;
   * their containers are the only ones it may cross.
   */
  const tier0Blocked = (pts: Point[], fromIdx: number, owns: Set<SceneNode>): boolean => {
    const owned = new Set<SceneNode>();
    for (const n of owns) {
      for (const c of scene.nodes) {
        if (!c.container) continue;
        if (
          n.x >= c.x - 1 &&
          n.y >= c.y - 1 &&
          n.x + n.width <= c.x + c.width + 1 &&
          n.y + n.height <= c.y + c.height + 1
        )
          owned.add(c);
      }
    }
    for (let i = fromIdx; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const vert = Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON;
      if (Math.abs(a[vert ? "y" : "x"] - b[vert ? "y" : "x"]) < ORTHOGONAL_EPSILON) continue;
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const y2 = Math.max(a.y, b.y);
      for (const band of titleBoxes) {
        if (x1 < band.x + band.width && band.x < x2 && y1 < band.y + band.height && band.y < y2)
          return true;
      }
      const at = vert ? a.x : a.y;
      const lo = vert ? y1 : x1;
      const hi = vert ? y2 : x2;
      for (const c of scene.nodes) {
        if (!c.container || owned.has(c)) continue;
        const across = vert
          ? at > c.x + 1 && at < c.x + c.width - 1
          : at > c.y + 1 && at < c.y + c.height - 1;
        if (!across) continue;
        const hits = vert
          ? c.y < hi - 1 && c.y + c.height > lo + 1
          : c.x < hi - 1 && c.x + c.width > lo + 1;
        if (hits) return true;
      }
    }
    return false;
  };
  const sideRunsOf = (edge: SceneEdge) => {
    const out: { vert: boolean; at: number; lo: number; hi: number; i: number }[] = [];
    for (let i = 0; i + 1 < edge.pts.length; i++) {
      const a = edge.pts[i];
      const b = edge.pts[i + 1];
      if (Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON && Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON)
        out.push({ vert: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), i });
      else if (
        Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON &&
        Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON
      )
        out.push({ vert: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), i });
    }
    return out;
  };
  const hugTargetOf = (
    run: { vert: boolean; at: number; lo: number; hi: number },
    node: SceneNode,
  ): number | null => {
    const spanLo = run.vert ? node.y : node.x;
    const spanHi = run.vert ? node.y + node.height : node.x + node.width;
    const shared = Math.min(run.hi, spanHi) - Math.max(run.lo, spanLo);
    if (shared <= MIN_HUG_SPAN) return null;
    const nearLo = run.vert ? node.x : node.y;
    const nearHi = run.vert ? node.x + node.width : node.y + node.height;
    if (Math.abs(run.at - nearLo) < 3)
      return node.container
        ? run.at < nearLo
          ? nearLo - SIDE_CLEAR
          : nearLo + SIDE_CLEAR
        : nearLo - SIDE_CLEAR;
    if (Math.abs(run.at - nearHi) < 3)
      return node.container
        ? run.at > nearHi
          ? nearHi + SIDE_CLEAR
          : nearHi - SIDE_CLEAR
        : nearHi + SIDE_CLEAR;
    return null;
  };
  /**
   * Positions that clear a hugged side, most clearance first: 8px, then 3.5px —
   * just past the 3px the predicate flags. The tight fallback is what a narrow
   * corridor offers: F06's approach stub in medium-tall/tall sits in a 7px gap
   * where 8px off one side is 1px off the other.
   */
  const hugTargetsOf = (
    run: { vert: boolean; at: number; lo: number; hi: number },
    node: SceneNode,
  ): number[] => {
    const spanLo = run.vert ? node.y : node.x;
    const spanHi = run.vert ? node.y + node.height : node.x + node.width;
    const shared = Math.min(run.hi, spanHi) - Math.max(run.lo, spanLo);
    if (shared <= MIN_HUG_SPAN) return [];
    const nearLo = run.vert ? node.x : node.y;
    const nearHi = run.vert ? node.x + node.width : node.y + node.height;
    let sign = 0;
    let side = 0;
    if (Math.abs(run.at - nearLo) < 3) {
      side = nearLo;
      sign = node.container ? (run.at < nearLo ? -1 : 1) : -1;
    } else if (Math.abs(run.at - nearHi) < 3) {
      side = nearHi;
      sign = node.container ? (run.at > nearHi ? 1 : -1) : 1;
    } else return [];
    return [side + sign * SIDE_CLEAR, side + sign * 3.5];
  };
  const runHitsNode = (vertical: boolean, at: number, from: number, to: number) =>
    runHitsNodeIn(vertical, at, from, to, leaves);
  const otherSideRuns = new Map<string, ReturnType<typeof sideRunsOf>>();
  for (const edge of scene.edges) otherSideRuns.set(edge.id, sideRunsOf(edge));
  // The innermost container geometrically holding a node. A re-sided riser must
  // turn in open space *before* the layer's border, or it clutters the band that
  // layer's own entries use — logical-archi's F02/F11 both turned inside the
  // Central control layer, crowding the approaches into CFG_SYS. Innermost, not
  // outermost: every node also sits inside the whole system, whose border is not
  // the one the riser must clear.
  const containerOf = (node: SceneNode): SceneNode | null => {
    let best: SceneNode | null = null;
    for (const c of scene.nodes) {
      if (!c.container) continue;
      if (
        node.x >= c.x - 1 &&
        node.y >= c.y - 1 &&
        node.x + node.width <= c.x + c.width + 1 &&
        node.y + node.height <= c.y + c.height + 1
      ) {
        if (!best || c.width * c.height < best.width * best.height) best = c;
      }
    }
    return best;
  };

  return {
    scene,
    leaves,
    tier0Blocked,
    sideRunsOf,
    hugTargetOf,
    hugTargetsOf,
    runHitsNode,
    containerOf,
    otherSideRuns,
  };
}

function attemptHugFix(
  ctx: HugContext,
  edge: SceneEdge,
  run: HugRun,
  axis: "x" | "y",
  own: Set<SceneNode>,
  target: number,
): boolean {
  const { scene, leaves, tier0Blocked, runHitsNode, hugTargetOf, otherSideRuns, sideRunsOf } = ctx;
  // Every border the run rides offers a way off it; the first that validates
  // wins. Trying only the first hugged node skipped runs whose wall is shared —
  // medium-tall/tall's F06 rides three borders and only the third is clean.
  //
  // A hug fix may cost up to one new crossing: `sideHug` outranks `crossings`
  // because a run merged with a frame destroys attribution.
  const delta = target - run.at;
  if (Math.abs(delta) < ORTHOGONAL_EPSILON) {
    return false;
  }
  const pts = edge.pts.map((p) => ({ ...p }));
  pts[run.i][axis] += delta;
  pts[run.i + 1][axis] += delta;
  let ok = true;
  // The slid terminals must not land on sibling attachments — shared
  // seats are a must-be-zero invariant — nor on a corner, where the
  // arrowhead reads as belonging to either side.
  for (const [idx, isFirst] of [
    [run.i, true],
    [run.i + 1, false],
  ] as const) {
    const isTerminal = isFirst ? run.i === 0 : run.i + 1 === pts.length - 1;
    if (!isTerminal) continue;
    const seat = sideOf(edge.pts[idx], leaves);
    if (!seat) continue;
    const moved = pts[idx];
    const vertSide = seat.side === "east" || seat.side === "west";
    const spanLo = vertSide ? seat.node.y : seat.node.x;
    const spanHi = vertSide ? seat.node.y + seat.node.height : seat.node.x + seat.node.width;
    if (Math.abs(moved[vertSide ? "y" : "x"] - spanLo) < 2.5) {
      ok = false;
      break;
    }
    if (Math.abs(moved[vertSide ? "y" : "x"] - spanHi) < 2.5) {
      ok = false;
      break;
    }
    for (const other of scene.edges) {
      if (other.id === edge.id || other.pts.length < 2) continue;
      for (const q of [other.pts[0], other.pts[other.pts.length - 1]]) {
        const qSeat = sideOf(q, leaves);
        if (qSeat && qSeat.node === seat.node && qSeat.side === seat.side) {
          const along = run.vert ? q.x : q.y;
          if (Math.abs(along - pts[idx][axis]) < 6) ok = false;
        }
      }
    }
    if (!ok) break;
  }
  if (!ok) {
    return false;
  }
  // Neighbour segments stretch or shrink; they must not reverse or
  // collapse to a jog.
  for (const k of [run.i - 1, run.i + 1]) {
    if (k < 0 || k + 1 >= pts.length) continue;
    const before = edge.pts[k + 1][axis] - edge.pts[k][axis];
    const after = pts[k + 1][axis] - pts[k][axis];
    if (Math.abs(after) < ORTHOGONAL_EPSILON || before * after < 0) {
      ok = false;
      break;
    }
  }
  if (!ok) {
    return false;
  }
  // The moved run and its stretched neighbours must stay clear of leaf
  // boxes.
  if (runHitsNode(run.vert, target, run.lo, run.hi)) {
    return false;
  }
  if (tier0Blocked(pts, Math.max(0, run.i - 1), own)) return false;
  for (const k of [run.i - 1, run.i + 1]) {
    if (k < 0 || k + 1 >= pts.length) continue;
    const a = pts[k];
    const b = pts[k + 1];
    const v = Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON;
    const at = v ? a.x : a.y;
    const lo = v ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const hi = v ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    if (Math.abs(hi - lo) >= ORTHOGONAL_EPSILON && runHitsNode(v, at, lo, hi)) {
      ok = false;
      break;
    }
  }
  if (!ok) {
    return false;
  }
  // Must not land on another side, merge with another run, or buy its
  // clearance with a new crossing.
  for (const node of scene.nodes) {
    if (own.has(node)) continue;
    if (hugTargetOf({ ...run, at: target }, node) !== null) {
      ok = false;
      break;
    }
  }
  if (!ok) {
    return false;
  }
  const movedA = pts[run.i];
  const movedB = pts[run.i + 1];
  let newCrossings = 0;
  for (const other of scene.edges) {
    if (other.id === edge.id) continue;
    for (const o of otherSideRuns.get(other.id) ?? []) {
      if (o.vert === run.vert) {
        const shared = Math.min(run.hi, o.hi) - Math.max(run.lo, o.lo);
        const gapBefore = Math.abs(o.at - run.at);
        const gapAfter = Math.abs(o.at - target);
        // Merging is a must-be-zero breach. Parking parallel within
        // 10px is `nearParallel` — not a payable trade for a hug
        // cleared: it recreates the same visual confusion in the same
        // corridor. Refuse the move only when it *creates* the
        // proximity.
        if ((gapAfter < 3 && shared > 8) || (gapBefore >= 10 && gapAfter < 10 && shared > 40)) {
          ok = false;
          break;
        }
      } else {
        const oA = o.vert ? { x: o.at, y: o.lo } : { x: o.lo, y: o.at };
        const oB = o.vert ? { x: o.at, y: o.hi } : { x: o.hi, y: o.at };
        const crossedBefore = segmentsCross(edge.pts[run.i], edge.pts[run.i + 1], oA, oB);
        const crossedAfter = segmentsCross(movedA, movedB, oA, oB);
        if (!crossedBefore && crossedAfter) newCrossings++;
      }
    }
    if (!ok) break;
  }
  if (!ok) {
    return false;
  }
  if (newCrossings > 1) {
    return false;
  }
  edge.pts = pts;
  otherSideRuns.set(edge.id, sideRunsOf(edge));
  return true;
}

function relocateRiser(
  ctx: HugContext,
  edge: SceneEdge,
  foreign: SceneEdge,
  ePts: Point[],
  eRiserAt: number,
): boolean {
  const {
    scene,
    leaves,
    runHitsNode,
    tier0Blocked,
    hugTargetOf,
    containerOf,
    otherSideRuns,
    sideRunsOf,
  } = ctx;
  // Re-side fallback: with every translation blocked, move the terminal to an
  // adjacent perpendicular side and route a fresh riser to it. logical-archi's
  // F02 (SUIV_FLUX west, x=1027) had every translation land on CFG_SYS's corner
  // or hit F11's riser at x=1011; re-siding below the other entries works, at
  // one unavoidable crossing against F11 — a hug fix outranks a crossing.
  //
  // When that crossing is against a single foreign flow, relocate *its* vertical
  // interior riser westward instead, so the crossing lands low and clear of the
  // approach band. Bounded to that shape: a blocker that is a terminal riser, a
  // horizontal run, or needs an eastward move is not relocated and the candidate
  // is rejected whole — the hug stays as debt rather than forcing a dubious
  // route. `eRiserAt` is passed in, not guessed from point indices, since a
  // re-sided END terminal puts the riser at the route's tail.
  let r = -1;
  for (let i = 1; i + 2 < foreign.pts.length; i++) {
    const a = foreign.pts[i];
    const b = foreign.pts[i + 1];
    if (Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON || Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON)
      continue;
    if (Math.abs(foreign.pts[i - 1].y - a.y) >= ORTHOGONAL_EPSILON) continue;
    if (Math.abs(foreign.pts[i + 2].y - b.y) >= ORTHOGONAL_EPSILON) continue;
    r = i;
    break;
  }
  if (r < 0) return false;
  const oldX = foreign.pts[r].x;
  const loY = Math.min(foreign.pts[r].y, foreign.pts[r + 1].y);
  const hiY = Math.max(foreign.pts[r].y, foreign.pts[r + 1].y);
  for (let step = 8; step <= 400; step += 8) {
    const newX = oldX - step;
    if (newX < 4) break;
    // Must sit clear of E's riser to avoid a new near-parallel bundle.
    if (Math.abs(newX - eRiserAt) < 10) continue;
    // Must not sit inside either endpoint's innermost layer — the
    // riser turns in open space, keeping both layers' bands clear.
    const fSource = sideOf(foreign.pts[0], leaves);
    const fTarget = sideOf(foreign.pts[foreign.pts.length - 1], leaves);
    const cSource = fSource ? containerOf(fSource.node) : null;
    const cTarget = fTarget ? containerOf(fTarget.node) : null;
    const inLayer = (c: SceneNode | null, x: number) =>
      c !== null && x > c.x - 8 && x < c.x + c.width + 8;
    if (inLayer(cSource, newX) || inLayer(cTarget, newX)) continue;
    const pts = foreign.pts.map((p) => ({ ...p }));
    pts[r].x = newX;
    pts[r + 1].x = newX;
    let ok = true;
    // Neighbours must not reverse.
    for (const k of [r - 1, r + 1]) {
      if (k < 0 || k + 1 >= pts.length) continue;
      const before = foreign.pts[k + 1].x - foreign.pts[k].x;
      const after = pts[k + 1].x - pts[k].x;
      if (Math.abs(after) < ORTHOGONAL_EPSILON || before * after < 0) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // No leaf hits, no hugs on the moved riser.
    if (runHitsNode(true, newX, loY, hiY)) continue;
    // Tier-0: no title strike, no foreign-container crossing.
    {
      const fOwn = new Set<SceneNode>();
      for (const p of [foreign.pts[0], foreign.pts[foreign.pts.length - 1]]) {
        const s = sideOf(p, leaves);
        if (s) fOwn.add(s.node);
      }
      if (tier0Blocked(pts, Math.max(0, r - 1), fOwn)) continue;
    }
    const riserRun = { vert: true, at: newX, lo: loY, hi: hiY };
    let hug = false;
    for (const node of scene.nodes) {
      const fSeat = sideOf(foreign.pts[0], leaves);
      const fSeat2 = sideOf(foreign.pts[foreign.pts.length - 1], leaves);
      if ((fSeat?.node === node || fSeat2?.node === node) && !node.container) continue;
      if (hugTargetOf(riserRun, node) !== null) {
        hug = true;
        break;
      }
    }
    if (hug) continue;
    // The re-sided flow's candidate is fixed. Crossings against it must stay
    // exactly 1 (the intended trade) and against every other edge at most 1 more
    // — a hug fix outranks crossings, applied to the relocation: F11's descent
    // cannot leave the layer's left band without crossing F01's approach.
    let trade = 0;
    let otherNew = 0;
    for (const other of scene.edges) {
      if (other.id === foreign.id) continue;
      const otherPts = other.id === edge.id ? ePts : other.pts;
      for (let oi = 0; oi + 1 < otherPts.length; oi++) {
        for (let fi = 0; fi + 1 < pts.length; fi++) {
          const after = segmentsCross(pts[fi], pts[fi + 1], otherPts[oi], otherPts[oi + 1]);
          if (other.id === edge.id) {
            if (after) trade++;
          } else {
            const before = segmentsCross(
              foreign.pts[fi],
              foreign.pts[fi + 1],
              other.pts[oi],
              other.pts[oi + 1],
            );
            if (!before && after) otherNew++;
          }
        }
      }
    }
    if (trade !== 1 || otherNew > 1) {
      continue;
    }
    foreign.pts = pts;
    otherSideRuns.set(foreign.id, sideRunsOf(foreign));
    return true;
  }
  return false;
}

function tryResideCandidate(
  ctx: HugContext,
  edge: SceneEdge,
  run: HugRun,
  own: Set<SceneNode>,
  isStart: boolean,
  neighbourIdx: number,
  replaceMapOf: (pts: Point[]) => number[],
  newTerminalValue: number,
  newTerminalAlong: number,
  riserAt: number,
): boolean {
  const { scene, leaves, runHitsNode, tier0Blocked, hugTargetOf, otherSideRuns, sideRunsOf } = ctx;
  let pts: Point[];
  let fromIdx: number;
  if (isStart) {
    const rest = edge.pts.slice(neighbourIdx).map((p) => ({ ...p }));
    const rejoin = { ...rest[0] };
    if (run.vert) rejoin.x = riserAt;
    else rejoin.y = riserAt;
    pts = run.vert
      ? [
          { x: newTerminalValue, y: newTerminalAlong },
          { x: riserAt, y: newTerminalAlong },
          rejoin,
          ...rest.slice(1),
        ]
      : [
          { x: newTerminalAlong, y: newTerminalValue },
          { x: newTerminalAlong, y: riserAt },
          rejoin,
          ...rest.slice(1),
        ];
    fromIdx = 0;
  } else {
    pts = edge.pts.slice(0, neighbourIdx + 1).map((p) => ({ ...p }));
    if (run.vert) pts[pts.length - 1].x = riserAt;
    else pts[pts.length - 1].y = riserAt;
    if (run.vert) {
      pts.push({ x: riserAt, y: newTerminalAlong });
      pts.push({ x: newTerminalValue, y: newTerminalAlong });
    } else {
      pts.push({ x: newTerminalAlong, y: riserAt });
      pts.push({ x: newTerminalAlong, y: newTerminalValue });
    }
    fromIdx = neighbourIdx;
  }
  const replaceMap = replaceMapOf(pts);
  let ok = true;
  // No leaf hits on the new or moved segments.
  for (let i = fromIdx; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const v = Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON;
    if (Math.abs(a[v ? "y" : "x"] - b[v ? "y" : "x"]) < ORTHOGONAL_EPSILON) continue;
    const at = v ? a.x : a.y;
    const lo = v ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const hi = v ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    if (runHitsNode(v, at, lo, hi)) {
      ok = false;
      break;
    }
  }
  if (!ok) return false;
  // Tier-0: no title strike, no foreign-container crossing.
  if (tier0Blocked(pts, fromIdx, own)) return false;
  // The rejoin segment must not reverse or collapse.
  if (isStart) {
    const rest = edge.pts.slice(neighbourIdx);
    if (rest.length >= 2) {
      const axis = run.vert ? "x" : "y";
      const before = rest[1][axis] - rest[0][axis];
      const after = rest[1][axis] - riserAt;
      if (Math.abs(after) < ORTHOGONAL_EPSILON || before * after < 0) return false;
    }
  } else if (neighbourIdx > 0) {
    const axis = run.vert ? "x" : "y";
    const before = edge.pts[neighbourIdx][axis] - edge.pts[neighbourIdx - 1][axis];
    const after = pts[neighbourIdx][axis] - pts[neighbourIdx - 1][axis];
    if (Math.abs(after) < ORTHOGONAL_EPSILON || before * after < 0) return false;
  }
  // No hugs on the new or moved segments (own nodes exempt).
  let hug = false;
  for (let i = fromIdx; i + 1 < pts.length && !hug; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segVert =
      Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON && Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON;
    const segHoriz =
      Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON && Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON;
    if (!segVert && !segHoriz) continue;
    const segRun = {
      vert: segVert,
      at: segVert ? a.x : a.y,
      lo: segVert ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
      hi: segVert ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
    };
    for (const node of scene.nodes) {
      if (own.has(node)) continue;
      if (hugTargetOf(segRun, node) !== null) {
        hug = true;
        break;
      }
    }
  }
  if (hug) return false;
  // New crossings: 0 → accept; exactly 1 vs one foreign flow
  // whose riser can relocate → relocate and accept; else
  // reject.
  const crossedBeforePairs = new Set<string>();
  const crossedAfterPairs = new Set<string>();
  for (const other of scene.edges) {
    if (other.id === edge.id) continue;
    for (let oi = 0; oi + 1 < other.pts.length; oi++) {
      for (let ni = fromIdx; ni + 1 < pts.length; ni++) {
        const oldIdx = replaceMap[ni];
        const before =
          oldIdx >= 0
            ? segmentsCross(
                edge.pts[oldIdx],
                edge.pts[oldIdx + 1],
                other.pts[oi],
                other.pts[oi + 1],
              )
            : false;
        const after = segmentsCross(pts[ni], pts[ni + 1], other.pts[oi], other.pts[oi + 1]);
        if (!before && after) crossedAfterPairs.add(other.id);
        if (before && !after) crossedBeforePairs.add(other.id);
      }
    }
  }
  const gained = [...crossedAfterPairs].filter((id) => !crossedBeforePairs.has(id));
  const newTerminal = isStart ? pts[0] : pts[pts.length - 1];
  if (gained.length === 0) {
    // Shared-seat check on the new terminal.
    const newSeat = sideOf(newTerminal, leaves);
    if (!newSeat) return false;
    let seatOk = true;
    for (const other of scene.edges) {
      if (other.id === edge.id || other.pts.length < 2) continue;
      for (const q of [other.pts[0], other.pts[other.pts.length - 1]]) {
        const qSeat = sideOf(q, leaves);
        if (qSeat && qSeat.node === newSeat.node && qSeat.side === newSeat.side) {
          const along = newSeat.side === "east" || newSeat.side === "west" ? q.y : q.x;
          const myAlong =
            newSeat.side === "east" || newSeat.side === "west" ? newTerminal.y : newTerminal.x;
          if (Math.abs(along - myAlong) < 6) seatOk = false;
        }
      }
      if (!seatOk) break;
    }
    if (!seatOk) return false;
    edge.pts = pts;
    otherSideRuns.set(edge.id, sideRunsOf(edge));
    return true;
  }
  if (gained.length === 1) {
    const foreign = scene.edges.find((e) => e.id === gained[0]);
    if (foreign && relocateRiser(ctx, edge, foreign, pts, riserAt)) {
      edge.pts = pts;
      otherSideRuns.set(edge.id, sideRunsOf(edge));
      return true;
    }
  }
  return false;
}

function resideAtSide(
  ctx: HugContext,
  edge: SceneEdge,
  run: HugRun,
  own: Set<SceneNode>,
  terminalNode: SceneNode,
): boolean {
  const { scene, leaves, containerOf } = ctx;
  if (edge.pts.length < 3) return false;
  const isStart = run.i === 0;
  const terminalIdx = isStart ? 0 : edge.pts.length - 1;
  const neighbourIdx = isStart ? 1 : edge.pts.length - 2;
  if (neighbourIdx < 0 || neighbourIdx >= edge.pts.length) return false;
  const seat = sideOf(edge.pts[terminalIdx], leaves);
  if (!seat || seat.node !== terminalNode) return false;
  const vertSeat = seat.side === "north" || seat.side === "south";
  const newSides = vertSeat ? (["west", "east"] as const) : (["north", "south"] as const);
  for (const newSide of newSides) {
    const newTerminalValue =
      newSide === "west"
        ? terminalNode.x
        : newSide === "east"
          ? terminalNode.x + terminalNode.width
          : newSide === "north"
            ? terminalNode.y
            : terminalNode.y + terminalNode.height;
    const spanLo = newSide === "west" || newSide === "east" ? terminalNode.y : terminalNode.x;
    const spanHi =
      newSide === "west" || newSide === "east"
        ? terminalNode.y + terminalNode.height
        : terminalNode.x + terminalNode.width;
    // Candidate seats along the new side, from the midpoint outward.
    // Each must clear the behaviour test's spacing rule — the same
    // `tight` rule the sweep gates — and the side's corners.
    const sideLength = spanHi - spanLo;
    const siblings = scene.edges
      .filter((e) => e.id !== edge.id && e.pts.length >= 2)
      .flatMap((e) => [e.pts[0], e.pts[e.pts.length - 1]])
      .map((p) => {
        const s = sideOf(p, leaves);
        if (!s || s.node !== terminalNode || s.side !== newSide) return null;
        return s.side === "east" || s.side === "west" ? p.y : p.x;
      })
      .filter((v): v is number => v !== null);
    const required = Math.min(12, (sideLength - 6) / (siblings.length + 1)) * 0.8;
    const alongs: number[] = [];
    const mid = (spanLo + spanHi) / 2;
    for (let k = 0; k * 8 + 8 <= sideLength / 2 + 8; k++) {
      for (const candidate of [mid + k * 8, mid - k * 8]) {
        if (candidate < spanLo || candidate > spanHi) continue;
        if (Math.abs(candidate - spanLo) < 2.5 || Math.abs(candidate - spanHi) < 2.5) continue;
        if (siblings.some((s) => Math.abs(s - candidate) < Math.max(6, required))) continue;
        if (!alongs.includes(candidate)) alongs.push(candidate);
      }
    }
    const nodeContainer = containerOf(terminalNode);
    // The riser must turn in open space before the terminal node's
    // layer border — never inside the layer's left band (or top/bottom
    // band for a north/south re-side).
    const clearsLayer = (riserAt: number): boolean => {
      if (!nodeContainer) return true;
      if (newSide === "west" && riserAt > nodeContainer.x - 8) return false;
      if (newSide === "east" && riserAt < nodeContainer.x + nodeContainer.width + 8) return false;
      if (newSide === "north" && riserAt < nodeContainer.y + 8) return false;
      if (newSide === "south" && riserAt > nodeContainer.y + nodeContainer.height - 8) return false;
      return true;
    };
    // Map each candidate segment to the old segment it replaces (for
    // the crossing diff). Re-siding the START terminal prepends
    // [new departure, approach, riser, rejoin]; re-siding the END
    // terminal appends [riser, approach] after the neighbour.
    const replaceMapOf = (pts: Point[]): number[] => {
      const map: number[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        if (isStart) map.push(k >= 2 ? k - 1 : -1);
        else map.push(k < edge.pts.length - 1 ? k : -1);
      }
      return map;
    };
    for (const newTerminalAlong of alongs) {
      // Scan both directions from the hugging run's position; the
      // validations decide which side actually has room.
      for (const dir of [-1, 1]) {
        for (let step = 8; step <= 400; step += 8) {
          const riserAt = run.at + dir * step;
          if (riserAt < 4) break;
          if (!clearsLayer(riserAt)) continue;
          if (
            tryResideCandidate(
              ctx,
              edge,
              run,
              own,
              isStart,
              neighbourIdx,
              replaceMapOf,
              newTerminalValue,
              newTerminalAlong,
              riserAt,
            )
          )
            return true;
        }
      }
    }
  }
  return false;
}

export function clearSideHugs(scene: Scene, titleBoxes: TitleBox[] = []): void {
  const ctx = createHugContext(scene, titleBoxes);
  const { leaves, sideRunsOf, hugTargetsOf } = ctx;

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    const own = new Set<SceneNode>();
    for (const p of [edge.pts[0], edge.pts[edge.pts.length - 1]]) {
      const seat = sideOf(p, leaves);
      if (seat) own.add(seat.node);
    }
    for (let guard = 0; guard < 8; guard++) {
      const runsHere = sideRunsOf(edge);
      let applied = false;
      for (const run of runsHere) {
        const targets: number[] = [];
        for (const node of scene.nodes) {
          if (own.has(node)) continue;
          for (const t of hugTargetsOf(run, node)) if (!targets.includes(t)) targets.push(t);
        }
        if (!targets.length) continue;
        const axis: "x" | "y" = run.vert ? "x" : "y";
        // The slide must keep the terminal inside its side's span. A clamped
        // target is accepted as long as it still clears the hug — the
        // re-check below rejects anything inside 3px.
        let clampLo = -Infinity;
        let clampHi = Infinity;
        for (const [idx, isFirst] of [
          [run.i, true],
          [run.i + 1, false],
        ] as const) {
          const isTerminal = isFirst ? run.i === 0 : run.i + 1 === edge.pts.length - 1;
          if (!isTerminal) continue;
          const seat = sideOf(edge.pts[idx], leaves);
          if (!seat) continue;
          const slides = run.vert
            ? seat.side === "north" || seat.side === "south"
            : seat.side === "west" || seat.side === "east";
          if (!slides) {
            clampLo = Infinity;
            clampHi = -Infinity;
            break;
          }
          clampLo = Math.max(clampLo, run.vert ? seat.node.x : seat.node.y);
          clampHi = Math.min(
            clampHi,
            run.vert ? seat.node.x + seat.node.width : seat.node.y + seat.node.height,
          );
        }
        if (clampLo > clampHi) {
          continue;
        }
        for (const rawTarget of targets) {
          const target = Math.min(Math.max(rawTarget, clampLo), clampHi);
          if (attemptHugFix(ctx, edge, run, axis, own, target)) {
            applied = true;
            break;
          }
        }
        // Translation blocked (corner landings, crossings, stub walls): re-side
        // the terminal on its own node to an adjacent perpendicular side.
        if (!applied) {
          const isTerminal = run.i === 0 || run.i + 1 === edge.pts.length - 1;
          if (isTerminal) {
            const terminalIdx = run.i === 0 ? 0 : edge.pts.length - 1;
            const terminalSeat = sideOf(edge.pts[terminalIdx], leaves);
            if (terminalSeat) {
              if (resideAtSide(ctx, edge, run, own, terminalSeat.node)) {
                applied = true;
              }
            }
          }
        }
        if (applied) break;
      }
      if (!applied) break;
    }
  }
}

/**
 * Swap the seats of two flows sharing a leaf side when that clears a crossing.
 * §4b only catches crossings within `FAN_REACH` (48px) of the shared side;
 * logical-archi's F05/F06 cross 226px down-river, outside the fan but
 * unmistakable. Inbound goes above outbound when the outbound descends, so its
 * vertical stops climbing through the inbound's horizontal.
 *
 * Strictly opportunistic: taken only when both routes stop crossing, neither
 * gains a crossing or a hug, and neither new seat collides with a third edge's
 * attachment. A looser gate measured worse globally (crossings 287→501) — the
 * "shuffle the tangle" pattern.
 *
 * Called after the repair-recording loop, like `clearSideHugs`, so the
 * renderer's batch audit cannot revert the swap as unrelated collateral.
 */
export function swapCrossingSiblingSeats(scene: Scene): void {
  const leaves = scene.nodes.filter((node) => !node.container);
  type Seat = { node: SceneNode; side: Side; along: number };
  const seatOf = (p: Point): Seat | null => {
    const s = sideOf(p, leaves);
    if (!s) return null;
    return {
      node: s.node,
      side: s.side,
      along: s.side === "east" || s.side === "west" ? p.y : p.x,
    };
  };
  const buildSwap = (edge: SceneEdge, terminalIdx: number, newAlong: number): Point[] | null => {
    // terminalIdx is 0 (start) or last (end). The neighbour at the bend shares
    // the terminal's along, so both move together to keep the immediate
    // segment orthogonal.
    const pts = edge.pts.map((p) => ({ ...p }));
    const last = pts.length - 1;
    const ti = terminalIdx === 0 ? 0 : last;
    const ni = terminalIdx === 0 ? 1 : last - 1;
    if (ni < 0 || ni > last) return null;
    const s = seatOf(edge.pts[ti]);
    if (!s) return null;
    const v = s.side === "east" || s.side === "west";
    const oldAlong = v ? pts[ti].y : pts[ti].x;
    const delta = newAlong - oldAlong;
    if (Math.abs(delta) < ORTHOGONAL_EPSILON) return null;
    if (v) {
      pts[ti].y += delta;
      pts[ni].y += delta;
    } else {
      pts[ti].x += delta;
      pts[ni].x += delta;
    }
    return pts;
  };
  const crossingsOf = (a: Point[], b: Point[]): number => {
    let count = 0;
    for (let i = 0; i + 1 < a.length; i++)
      for (let j = 0; j + 1 < b.length; j++)
        if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) count++;
    return count;
  };
  const wouldHug = (pts: Point[]): boolean => {
    const own = new Set<SceneNode>();
    for (const p of [pts[0], pts[pts.length - 1]]) {
      const s = sideOf(p, leaves);
      if (s) own.add(s.node);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const vert =
        Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON && Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON;
      const horiz =
        Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON && Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON;
      if (!vert && !horiz) continue;
      for (const node of leaves) {
        if (own.has(node)) continue;
        const shared = vert
          ? Math.min(Math.max(a.y, b.y), node.y + node.height) -
            Math.max(Math.min(a.y, b.y), node.y)
          : Math.min(Math.max(a.x, b.x), node.x + node.width) -
            Math.max(Math.min(a.x, b.x), node.x);
        if (shared <= MIN_HUG_SPAN) continue;
        const gap = vert
          ? Math.min(Math.abs(a.x - node.x), Math.abs(a.x - (node.x + node.width)))
          : Math.min(Math.abs(a.y - node.y), Math.abs(a.y - (node.y + node.height)));
        if (gap < 3) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < scene.edges.length; i++) {
    const A = scene.edges[i];
    if (A.pts.length < 2) continue;
    const aStart = seatOf(A.pts[0]);
    const aEnd = seatOf(A.pts[A.pts.length - 1]);
    if (!aStart && !aEnd) continue;
    for (let j = i + 1; j < scene.edges.length; j++) {
      const B = scene.edges[j];
      if (B.pts.length < 2) continue;
      const bStart = seatOf(B.pts[0]);
      const bEnd = seatOf(B.pts[B.pts.length - 1]);
      if (!bStart && !bEnd) continue;
      // Find a matching shared side (one of A's terminals pairs with one of B's).
      const match =
        aStart && bStart && aStart.node === bStart.node && aStart.side === bStart.side
          ? { aIdx: 0, bIdx: 0, seat: aStart }
          : aStart && bEnd && aStart.node === bEnd.node && aStart.side === bEnd.side
            ? { aIdx: 0, bIdx: 1, seat: aStart }
            : aEnd && bStart && aEnd.node === bStart.node && aEnd.side === bStart.side
              ? { aIdx: 1, bIdx: 0, seat: aEnd }
              : aEnd && bEnd && aEnd.node === bEnd.node && aEnd.side === bEnd.side
                ? { aIdx: 1, bIdx: 1, seat: aEnd }
                : null;
      if (!match) continue;
      const aAlong = match.aIdx === 0 ? aStart!.along : aEnd!.along;
      const bAlong = match.bIdx === 0 ? bStart!.along : bEnd!.along;
      if (Math.abs(aAlong - bAlong) < ORTHOGONAL_EPSILON) continue;
      // Only proceed if A and B actually cross right now.
      if (crossingsOf(A.pts, B.pts) === 0) continue;
      const aCandidate = buildSwap(A, match.aIdx, bAlong);
      const bCandidate = buildSwap(B, match.bIdx, aAlong);
      if (!aCandidate || !bCandidate) continue;
      // The mutual crossing must go away.
      if (crossingsOf(aCandidate, bCandidate) > 0) continue;
      // No new crossings with any third edge.
      let ok = true;
      for (const other of scene.edges) {
        if (other.id === A.id || other.id === B.id) continue;
        const before = crossingsOf(A.pts, other.pts) + crossingsOf(B.pts, other.pts);
        const after = crossingsOf(aCandidate, other.pts) + crossingsOf(bCandidate, other.pts);
        if (after > before) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // No new hugs on either route.
      if (wouldHug(aCandidate) || wouldHug(bCandidate)) continue;
      // No shared-seat collision: neither new terminal may collide with a
      // third edge's attachment on the same side.
      const aNewSeat = seatOf(aCandidate[match.aIdx === 0 ? 0 : aCandidate.length - 1]);
      const bNewSeat = seatOf(bCandidate[match.bIdx === 0 ? 0 : bCandidate.length - 1]);
      if (!aNewSeat || !bNewSeat) continue;
      for (const other of scene.edges) {
        if (other.id === A.id || other.id === B.id) continue;
        for (const p of [other.pts[0], other.pts[other.pts.length - 1]]) {
          const s = seatOf(p);
          if (!s) continue;
          for (const ns of [aNewSeat, bNewSeat]) {
            if (s.node === ns.node && s.side === ns.side && Math.abs(s.along - ns.along) < 6) {
              ok = false;
              break;
            }
          }
          if (!ok) break;
        }
        if (!ok) break;
      }
      if (!ok) continue;
      A.pts = aCandidate;
      B.pts = bCandidate;
    }
  }
}

interface RunSpan {
  lo: number;
  hi: number;
  at: number;
}

/** Shared state and predicates every `tidyEdges` phase reads or calls,
 *  built once per invocation. `bandFor` lives here (not in the phase that
 *  first needs it) because §4f re-checks the same title bands §4e clears. */
interface TidyContext {
  scene: Scene;
  leaves: SceneNode[];
  titleBoxes: TitleBox[];
  folded: boolean;
  runsExcept(...edgeIds: string[]): { horizontal: RunSpan[]; vertical: RunSpan[] };
  runHitsNode(vertical: boolean, at: number, from: number, to: number): boolean;
  runIsClear(others: RunSpan[], at: number, from: number, to: number): boolean;
  enforceOrthogonal(edge: SceneEdge): void;
  bandFor(a: Point, b: Point): TitleBox | null;
}

function createTidyContext(
  scene: Scene,
  leaves: SceneNode[],
  titleBoxes: TitleBox[],
  folded: boolean,
): TidyContext {
  // Runs belonging to every *other* flow, so a move can be checked before it
  // is applied: neither straightening nor separation may park a flow on top of
  // another one — a merged line is worse than the jog or the shared endpoint
  // it was meant to fix.
  const runsExcept = (...edgeIds: string[]) => {
    const horizontal: { lo: number; hi: number; at: number }[] = [];
    const vertical: { lo: number; hi: number; at: number }[] = [];
    for (const edge of scene.edges) {
      if (edgeIds.includes(edge.id)) continue;
      for (let index = 0; index + 1 < edge.pts.length; index++) {
        const a = edge.pts[index];
        const b = edge.pts[index + 1];
        if (Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON && Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON)
          horizontal.push({ lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), at: a.y });
        else if (
          Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON &&
          Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON
        )
          vertical.push({ lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), at: a.x });
      }
    }
    return { horizontal, vertical };
  };
  // Mirrors the two readability metrics exactly: a run must not become
  // collinear with another (touching at all over a shared stretch), nor drift
  // alongside one for long enough to read as a single thick line.
  // A straightened or shifted run must not be dragged across a node either.
  // Widening the jog threshold without this put 26 flows through boxes.
  const runHitsNode = (vertical: boolean, at: number, from: number, to: number) =>
    runHitsNodeIn(vertical, at, from, to, leaves);
  const runIsClear = (
    others: { lo: number; hi: number; at: number }[],
    at: number,
    from: number,
    to: number,
  ) =>
    !others.some((other) => {
      const gap = Math.abs(other.at - at);
      const shared =
        Math.min(other.hi, Math.max(from, to)) - Math.max(other.lo, Math.min(from, to));
      return wouldMerge(gap, shared);
    });

  // Orthogonality, to a fixpoint: aligning one segment can tilt its
  // neighbour, and a jog left in place (because straightening it would merge
  // two flows) tilts when a separation move shifts one of its ends. A
  // terminal may slide along its side but never leave the border it sits on.
  const enforceOrthogonal = (edge: SceneEdge) => enforceOrthogonalOn(edge, leaves);

  const bandFor = (a: Point, b: Point) => {
    if (Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON) return null; // vertical runs are handled by the caller
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return (
      titleBoxes.find(
        (band) =>
          a.y > band.y && a.y < band.y + band.height && lo < band.x + band.width && hi > band.x,
      ) ?? null
    );
  };

  return {
    scene,
    leaves,
    titleBoxes,
    folded,
    runsExcept,
    runHitsNode,
    runIsClear,
    enforceOrthogonal,
    bandFor,
  };
}

function straightenAndCollapseEdge(ctx: TidyContext, edge: SceneEdge): void {
  const { scene, leaves, runsExcept, runHitsNode, runIsClear, enforceOrthogonal } = ctx;
  if (edge.pts.length < 2) return;
  const before = edge.pts.map((point) => ({ ...point }));
  const others = runsExcept(edge.id);
  const after = straighten(
    edge.pts,
    (vertical, at, from, to) =>
      !runHitsNode(vertical, at, from, to) &&
      runIsClear(vertical ? others.vertical : others.horizontal, at, from, to),
  );
  // Straightening may slide an endpoint along its border; keep it on the
  // node, away from the corners.
  for (const [index, original] of [
    [0, before[0]] as const,
    [after.length - 1, before[before.length - 1]] as const,
  ]) {
    const seat = sideOf(original, leaves);
    if (!seat) continue;
    const { node, side } = seat;
    const point = after[index];
    if (side === "north" || side === "south") {
      point.y = original.y;
      point.x = Math.min(Math.max(point.x, node.x + SIDE_INSET), node.x + node.width - SIDE_INSET);
    } else {
      point.x = original.x;
      point.y = Math.min(Math.max(point.y, node.y + SIDE_INSET), node.y + node.height - SIDE_INSET);
    }
  }
  edge.pts = after;
  enforceOrthogonal(edge);

  // Collapse S-curves: two same-direction runs one short step apart, where a
  // single turn would serve. `straighten` stops at `JOG_SNAP` because it moves
  // a run by the step's width; this moves the *turn*, so a wide staircase
  // collapses as readily as a narrow one.
  //
  // Interior turns only: collapsing one that touches an endpoint changes which
  // node side the flow enters — the separation pass's business, and reversing
  // its decisions from here once merged flows.
  const beforeSimplify = edge.pts.map((point) => ({ ...point }));

  // The fan condition a collapse must not worsen, measured as the sweep's
  // `fanTangle` gate does: crossings with a sibling on the same node side,
  // within `FAN_REACH`. A distance guard around the merged corner was tried
  // twice and wrong both ways — it blocked harmless collapses passing a
  // stranger's box (SALES_ADMIN→CRM_CONTRACTS) and missed harmful ones whose
  // corner sat far while the run swept its own fan.
  const fans: { node: SceneNode; siblings: SceneEdge[] }[] = [];
  for (const terminal of [edge.pts[0], edge.pts[edge.pts.length - 1]]) {
    const seat = sideOf(terminal, leaves);
    if (!seat) continue;
    const siblings = scene.edges.filter(
      (other) =>
        other !== edge &&
        other.pts.length >= 2 &&
        [other.pts[0], other.pts[other.pts.length - 1]].some((p) => {
          const otherSeat = sideOf(p, leaves);
          return otherSeat?.node === seat.node && otherSeat?.side === seat.side;
        }),
    );
    if (siblings.length) fans.push({ node: seat.node, siblings });
  }
  const fanCrossings = (pts: Point[]): number => {
    let count = 0;
    for (const { node, siblings } of fans)
      for (const sibling of siblings)
        for (let i = 0; i + 1 < pts.length; i++)
          for (let j = 0; j + 1 < sibling.pts.length; j++) {
            const hit = segmentsCross(pts[i], pts[i + 1], sibling.pts[j], sibling.pts[j + 1]);
            if (!hit) continue;
            const dx = Math.max(0, node.x - hit.x, hit.x - (node.x + node.width));
            const dy = Math.max(0, node.y - hit.y, hit.y - (node.y + node.height));
            if (dx * dx + dy * dy <= FAN_REACH * FAN_REACH) count++;
          }
    return count;
  };
  const fanBefore = fans.length ? fanCrossings(beforeSimplify) : 0;

  // Foreign labels already seated on their own run — the positions later
  // passes *keep*, since `label-anchor` and the settler both leave a seated,
  // attributable label alone. A run collapsed through one creates a pierce
  // placement may not undo (F13 in medium/tall has no clean seat anywhere).
  // Floating labels are skipped: they are about to move anyway.
  const seatedForeignLabels: { x: number; y: number; width: number; height: number }[] = [];
  const segGapSq = (
    box: { x: number; y: number; width: number; height: number },
    a: Point,
    b: Point,
  ) => {
    const gapX = Math.max(0, box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - (box.x + box.width));
    const gapY = Math.max(0, box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - (box.y + box.height));
    return gapX * gapX + gapY * gapY;
  };
  for (const other of scene.edges) {
    if (other === edge || other.pts.length < 2) continue;
    for (const label of other.labels) {
      if (!label.width || !label.height) continue;
      let own = Number.POSITIVE_INFINITY;
      for (let index = 0; index + 1 < other.pts.length; index++)
        own = Math.min(own, segGapSq(label, other.pts[index], other.pts[index + 1]));
      if (own <= SNAP * SNAP) seatedForeignLabels.push(label);
    }
  }

  // Full-polyline validation: orthogonal, clear of leaves, not merged into
  // another flow, no new fan tangle, no seated foreign label pierced. Used
  // after every individual collapse step, because each step must be
  // reversible on its own — one bad collapse must not cost the good ones.
  const outside = runsExcept(edge.id);
  const polylineOk = (pts: Point[]): boolean => {
    if (pts.length < 2) return false;
    for (let index = 0; index + 1 < pts.length; index++) {
      const a = pts[index];
      const b = pts[index + 1];
      const deltaX = Math.abs(a.x - b.x);
      const deltaY = Math.abs(a.y - b.y);
      if (deltaX >= ORTHOGONAL_EPSILON && deltaY >= ORTHOGONAL_EPSILON) return false;
      const runVertical = deltaX < ORTHOGONAL_EPSILON;
      const at = runVertical ? a.x : a.y;
      const from = runVertical ? a.y : a.x;
      const to = runVertical ? b.y : b.x;
      if (runHitsNode(runVertical, at, from, to)) return false;
      if (!runIsClear(runVertical ? outside.vertical : outside.horizontal, at, from, to))
        return false;
      for (const label of seatedForeignLabels) if (segGapSq(label, a, b) <= 1) return false;
    }
    if (fans.length && fanCrossings(pts) > fanBefore) return false;
    return true;
  };

  // Each S-curve has two collapsed shapes: extend the first run and turn at
  // the far corner, or turn at the near corner and extend the last. They
  // sweep opposite regions, so when one is blocked — a seated label, a fan,
  // another flow — the other often isn't. F02 in medium/tall is the measured
  // case: the far corner drives its run through a seated label that has no
  // escape seat, the near corner passes under it untouched.
  for (let guard = 0; guard < 20; guard++) {
    let changed = false;
    for (let index = 2; index + 2 < edge.pts.length - 1 && !changed; index++) {
      const a = edge.pts[index - 1];
      const b = edge.pts[index];
      const c = edge.pts[index + 1];
      const d = edge.pts[index + 2];
      const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < ORTHOGONAL_EPSILON;
      // Outer runs parallel to each other, middle run across them.
      if (horizontal(a, b) !== horizontal(c, d)) continue;
      if (horizontal(a, b) === horizontal(b, c)) continue;
      const outerAlong = horizontal(a, b) ? (b.x - a.x) * (d.x - c.x) : (b.y - a.y) * (d.y - c.y);
      // Same direction: a genuine staircase, not a there-and-back detour.
      if (outerAlong <= 0) continue;
      const corners = horizontal(a, b)
        ? [
            { x: d.x, y: a.y },
            { x: a.x, y: d.y },
          ]
        : [
            { x: a.x, y: d.y },
            { x: d.x, y: a.y },
          ];
      for (const merged of corners) {
        // Interior turns only. Extending to terminal-adjacent S-curves removed
        // the seat-side jogs it aimed at and broke `labelAdrift`: the extended
        // runs slid out from under labels with nowhere attributable to go. A
        // seat-side jog is the separation pass's cost to fix, not this one's.
        const attempt = [...edge.pts.slice(0, index), merged, ...edge.pts.slice(index + 2)];
        // A collapse can leave three collinear points — including a
        // doubled-back stub when the merged corner overshoots the next turn.
        // Drop the middles: the drawn line becomes the direct span, which is
        // the whole point of collapsing.
        for (let k = 1; k + 1 < attempt.length; ) {
          const p = attempt[k - 1];
          const q = attempt[k];
          const r = attempt[k + 1];
          const collinearX =
            Math.abs(p.x - q.x) < ORTHOGONAL_EPSILON && Math.abs(q.x - r.x) < ORTHOGONAL_EPSILON;
          const collinearY =
            Math.abs(p.y - q.y) < ORTHOGONAL_EPSILON && Math.abs(q.y - r.y) < ORTHOGONAL_EPSILON;
          if (collinearX || collinearY) attempt.splice(k, 1);
          else k++;
        }
        if (!polylineOk(attempt)) continue;
        edge.pts = attempt;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  enforceOrthogonal(edge);
}

function straightenAndCollapse(ctx: TidyContext): void {
  for (const edge of ctx.scene.edges) {
    straightenAndCollapseEdge(ctx, edge);
  }
}

interface ReaimContext {
  scene: Scene;
  leaves: SceneNode[];
  titleBoxes: TitleBox[];
  runsExcept: TidyContext["runsExcept"];
  runHitsNode: TidyContext["runHitsNode"];
  runIsClear: TidyContext["runIsClear"];
  containers: SceneNode[];
  awayTol: number;
  seatedLabelBoxes(except: SceneEdge): { x: number; y: number; width: number; height: number }[];
  wrapAround(pts: Point[], srcNode: SceneNode, dstNode: SceneNode): boolean;
}

function createReaimContext(ctx: TidyContext): ReaimContext {
  const { scene, leaves, titleBoxes, runsExcept, runHitsNode, runIsClear } = ctx;
  // Re-aim wrap-around terminals (§4c): a flow sometimes sets off *away* from
  // its counterpart, out the far side and back in from beyond — elk's layer
  // assignment winning over geometry, or `route-detour`'s channels never
  // considering a direct route however close the target. Try the direct L or Z
  // between facing sides, keeping it only if clean by every rule here plus
  // `route-detour`'s obstacle model (title bands, container borders), strictly
  // shorter and wrap-free. Channels remain the fallback; all-or-nothing per
  // edge, no half-reroute.
  const AWAY_TOL = 24;
  const containers = scene.nodes.filter((node) => node.container);
  const seatedLabelBoxes = (except: SceneEdge) => {
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (const other of scene.edges) {
      if (other === except || other.pts.length < 2) continue;
      for (const label of other.labels) {
        if (!label.width || !label.height) continue;
        let own = Number.POSITIVE_INFINITY;
        for (let index = 0; index + 1 < other.pts.length; index++) {
          const a = other.pts[index];
          const b = other.pts[index + 1];
          const gapX = Math.max(
            0,
            label.x - Math.max(a.x, b.x),
            Math.min(a.x, b.x) - (label.x + label.width),
          );
          const gapY = Math.max(
            0,
            label.y - Math.max(a.y, b.y),
            Math.min(a.y, b.y) - (label.y + label.height),
          );
          own = Math.min(own, gapX * gapX + gapY * gapY);
        }
        if (own <= SNAP * SNAP) boxes.push(label);
      }
    }
    return boxes;
  };
  const isAway = (seg: Point, target: Point) =>
    (Math.abs(seg.x) >= ORTHOGONAL_EPSILON &&
      Math.abs(target.x) > AWAY_TOL &&
      seg.x * target.x < 0) ||
    (Math.abs(seg.y) >= ORTHOGONAL_EPSILON &&
      Math.abs(target.y) > AWAY_TOL &&
      seg.y * target.y < 0);
  const wrapAround = (pts: Point[], srcNode: SceneNode, dstNode: SceneNode) => {
    const srcC = { x: srcNode.x + srcNode.width / 2, y: srcNode.y + srcNode.height / 2 };
    const dstC = { x: dstNode.x + dstNode.width / 2, y: dstNode.y + dstNode.height / 2 };
    const p0 = pts[0];
    const p1 = pts[1];
    const pn = pts[pts.length - 1];
    const pm = pts[pts.length - 2];
    return (
      isAway({ x: p1.x - p0.x, y: p1.y - p0.y }, { x: dstC.x - p0.x, y: dstC.y - p0.y }) ||
      isAway({ x: pn.x - pm.x, y: pn.y - pm.y }, { x: pn.x - srcC.x, y: pn.y - srcC.y })
    );
  };

  return {
    scene,
    leaves,
    titleBoxes,
    runsExcept,
    runHitsNode,
    runIsClear,
    containers,
    awayTol: AWAY_TOL,
    seatedLabelBoxes,
    wrapAround,
  };
}

function segmentsAreClean(
  rctx: ReaimContext,
  pts: Point[],
  outside: ReturnType<TidyContext["runsExcept"]>,
  labelBoxes: { x: number; y: number; width: number; height: number }[],
): boolean {
  const { runHitsNode, runIsClear, titleBoxes, containers } = rctx;
  let ok = true;
  for (let index = 0; ok && index + 1 < pts.length; index++) {
    const a = pts[index];
    const b = pts[index + 1];
    const deltaX = Math.abs(a.x - b.x);
    const deltaY = Math.abs(a.y - b.y);
    if (deltaX >= ORTHOGONAL_EPSILON && deltaY >= ORTHOGONAL_EPSILON) ok = false;
    else {
      const runVertical = deltaX < ORTHOGONAL_EPSILON;
      const at = runVertical ? a.x : a.y;
      const from = runVertical ? a.y : a.x;
      const to = runVertical ? b.y : b.x;
      if (runHitsNode(runVertical, at, from, to)) {
        ok = false;
      } else if (!runIsClear(runVertical ? outside.vertical : outside.horizontal, at, from, to)) {
        ok = false;
      } else {
        for (const box of labelBoxes) {
          const gapX = Math.max(
            0,
            box.x - Math.max(a.x, b.x),
            Math.min(a.x, b.x) - (box.x + box.width),
          );
          const gapY = Math.max(
            0,
            box.y - Math.max(a.y, b.y),
            Math.min(a.y, b.y) - (box.y + box.height),
          );
          if (gapX * gapX + gapY * gapY <= 1) {
            ok = false;
            break;
          }
        }
        // route-detour's obstacle model, honoured by anything that claims
        // to beat a channel: no run through a container's title band —
        // edges draw last and titles carry no halo, so a run through one
        // strikes through the words — and no vertical run riding along a
        // container's dashed vertical border (7px minimum, matching the
        // channel planner's own clearance).
        if (ok)
          for (const band of titleBoxes) {
            const gapX = Math.max(
              0,
              band.x - Math.max(a.x, b.x),
              Math.min(a.x, b.x) - (band.x + band.width),
            );
            const gapY = Math.max(
              0,
              band.y - Math.max(a.y, b.y),
              Math.min(a.y, b.y) - (band.y + band.height),
            );
            if (gapX * gapX + gapY * gapY <= 1) {
              ok = false;
              break;
            }
          }
        if (ok && runVertical)
          for (const box of containers) {
            const yLo = Math.min(a.y, b.y);
            const yHi = Math.max(a.y, b.y);
            if (yHi < box.y || yLo > box.y + box.height) continue;
            if (Math.abs(at - box.x) < 7 || Math.abs(at - (box.x + box.width)) < 7) {
              ok = false;
              break;
            }
          }
      }
    }
  }
  return ok;
}

// Candidate seats on the sides facing the counterpart, on each axis where it
// is genuinely offset. Several seats per side and several crossing lines per
// Z, in fixed order, because the direct corridor is often partly occupied: a
// rigid centre-and-midline candidate reads "blocked" where a seat slid 18px
// finds the lane a human would use. The separation pass spreads siblings
// afterwards, so seats need not anticipate neighbours.
function generateReaimCandidates(
  AWAY_TOL: number,
  src: SceneNode,
  dst: SceneNode,
  srcC: Point,
  dstC: Point,
): Point[][] {
  const SEAT_OFFSETS = [0, -18, 18, -36, 36];
  const seatOn = (node: SceneNode, side: Side, offset: number): Point => {
    const alongX = Math.min(
      Math.max(node.x + node.width / 2 + offset, node.x + SIDE_INSET),
      node.x + node.width - SIDE_INSET,
    );
    const alongY = Math.min(
      Math.max(node.y + node.height / 2 + offset, node.y + SIDE_INSET),
      node.y + node.height - SIDE_INSET,
    );
    return side === "north"
      ? { x: alongX, y: node.y }
      : side === "south"
        ? { x: alongX, y: node.y + node.height }
        : side === "west"
          ? { x: node.x, y: alongY }
          : { x: node.x + node.width, y: alongY };
  };
  const facingSides = (from: SceneNode, toward: Point): Side[] => {
    const dx = toward.x - (from.x + from.width / 2);
    const dy = toward.y - (from.y + from.height / 2);
    const sides: Side[] = [];
    const xSide: Side | null = Math.abs(dx) > AWAY_TOL ? (dx > 0 ? "east" : "west") : null;
    const ySide: Side | null = Math.abs(dy) > AWAY_TOL ? (dy > 0 ? "south" : "north") : null;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (xSide) sides.push(xSide);
      if (ySide) sides.push(ySide);
    } else {
      if (ySide) sides.push(ySide);
      if (xSide) sides.push(xSide);
    }
    return sides;
  };
  const normalOf = (side: Side): Point =>
    side === "north"
      ? { x: 0, y: -1 }
      : side === "south"
        ? { x: 0, y: 1 }
        : side === "west"
          ? { x: -1, y: 0 }
          : { x: 1, y: 0 };

  const candidates: Point[][] = [];
  for (const srcSide of facingSides(src, dstC))
    for (const dstSide of facingSides(dst, srcC)) {
      const na = normalOf(srcSide);
      const nb = normalOf(dstSide);
      const horizontalA = na.x !== 0;
      const horizontalB = nb.x !== 0;
      for (const srcOffset of SEAT_OFFSETS)
        for (const dstOffset of SEAT_OFFSETS) {
          const a = seatOn(src, srcSide, srcOffset);
          const b = seatOn(dst, dstSide, dstOffset);
          if (horizontalA !== horizontalB) {
            // Perpendicular normals → single-corner L.
            const corner = horizontalA ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
            candidates.push([a, corner, b]);
          } else if (na.x === -nb.x && na.y === -nb.y) {
            // Opposed normals → Z; the crossing line tries the midline and a
            // lane hugging each node, 12px off, matching lane spacing.
            if (horizontalA) {
              for (const mid of [(a.x + b.x) / 2, Math.min(a.x, b.x) + 12, Math.max(a.x, b.x) - 12])
                candidates.push([a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]);
            } else {
              for (const mid of [(a.y + b.y) / 2, Math.min(a.y, b.y) + 12, Math.max(a.y, b.y) - 12])
                candidates.push([a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]);
            }
          }
        }
    }
  return candidates;
}

function reaimEdge(rctx: ReaimContext, edge: SceneEdge): void {
  const { scene, leaves, runsExcept, awayTol: AWAY_TOL, seatedLabelBoxes, wrapAround } = rctx;
  if (edge.pts.length < 2) return;
  const srcSeat = sideOf(edge.pts[0], leaves);
  const dstSeat = sideOf(edge.pts[edge.pts.length - 1], leaves);
  if (!srcSeat || !dstSeat || srcSeat.node === dstSeat.node) return;
  // Two reasons to re-side a flow: a wrap-around (§4c) sends the eye the
  // wrong way, and a flow crossing a sibling — sharing one of its
  // endpoints — tangles with traffic it's guaranteed to run alongside.
  //
  // The second is what a round trip between distant nodes needs: `logical`'s
  // COMPENSATION↔SUPERVISOR crossed because the return leg rose to the
  // container's west side at x=1550 while the outbound ran left at y=439
  // from x=1628, and every riser position between them crosses it (§4f
  // leaves it alone for exactly that reason) — only entering from the other
  // side fixes it, a terminal-side decision, so this pass's.
  const siblingCrossings = (pts: Point[]) => {
    let total = 0;
    for (const other of scene.edges) {
      if (other === edge || other.pts.length < 2) continue;
      // Only the *return leg* — the flow joining the same two nodes the other
      // way. A round trip is the one case where a crossing is never necessary,
      // since the legs can always nest. Widening it to any flow sharing an
      // endpoint was measured and rejected: three `large-slide` drawings lost
      // ground (longDetour, attachAway) to tangles that were not avoidable.
      const ends = [other.pts[0], other.pts[other.pts.length - 1]].map(
        (p) => sideOf(p, leaves)?.node,
      );
      const isReturnLeg =
        ends.includes(srcSeat.node) && ends.includes(dstSeat.node) && ends[0] !== ends[1];
      if (!isReturnLeg) continue;
      for (let i = 0; i + 1 < pts.length; i++)
        for (let j = 0; j + 1 < other.pts.length; j++)
          if (segmentsCross(pts[i], pts[i + 1], other.pts[j], other.pts[j + 1])) total++;
    }
    return total;
  };
  const wrapped = wrapAround(edge.pts, srcSeat.node, dstSeat.node);
  const tangledBefore = siblingCrossings(edge.pts);
  if (!wrapped && tangledBefore === 0) return;

  const src = srcSeat.node;
  const dst = dstSeat.node;
  const srcC = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
  const dstC = { x: dst.x + dst.width / 2, y: dst.y + dst.height / 2 };

  const candidates = generateReaimCandidates(AWAY_TOL, src, dst, srcC, dstC);

  const outside = runsExcept(edge.id);
  const labelBoxes = seatedLabelBoxes(edge);
  const currentLength = sharedPathLength(edge.pts);
  for (const candidate of candidates) {
    // Degenerate corners (seat aligned with counterpart) leave zero-length
    // segments; drop them before judging.
    const pts = candidate.filter(
      (p, index) =>
        index === 0 ||
        Math.abs(p.x - candidate[index - 1].x) >= ORTHOGONAL_EPSILON ||
        Math.abs(p.y - candidate[index - 1].y) >= ORTHOGONAL_EPSILON,
    );
    if (pts.length < 2) continue;
    // First segment must leave through the seat's side, not slide along it.
    if (wrapAround(pts, src, dst)) {
      continue;
    }
    // "Better" depends on why the flow is being re-sided. A wrap-around is a
    // detour, so its replacement must be shorter. A tangle is not about length
    // — untangling a round trip means entering from the far side, usually a
    // little *longer* than cutting across your partner. So a tangle-driven
    // candidate must remove crossings and may spend at most a node's width
    // (64px) doing it; beyond that the cure reads worse than the tangle.
    const untangles = tangledBefore > 0 && siblingCrossings(pts) < tangledBefore;
    if (untangles) {
      if (sharedPathLength(pts) > currentLength + 64) continue;
    } else if (sharedPathLength(pts) >= currentLength - 12) {
      continue;
    }
    if (!segmentsAreClean(rctx, pts, outside, labelBoxes)) continue;
    // A Z's crossing lane is an interior segment the jog metric counts, and
    // the separation pass may later shift either seat by up to 12px along
    // its side, shortening the lane with it. Demand enough length that it
    // can never read as a staircase step.
    if (pts.length >= 4) {
      let shortInterior = false;
      for (let index = 1; index + 2 < pts.length; index++) {
        const length =
          Math.abs(pts[index + 1].x - pts[index].x) + Math.abs(pts[index + 1].y - pts[index].y);
        if (length <= 32) shortInterior = true;
      }
      if (shortInterior) {
        continue;
      }
    }
    // The new seats must not tangle with their siblings — the same fan
    // condition the collapse validates and the sweep gates. A wrap traded
    // for a tangle at the node is the reseat mistake all over again.
    let tangled = false;
    for (const terminal of [pts[0], pts[pts.length - 1]]) {
      const seat = sideOf(terminal, leaves);
      if (!seat) continue;
      for (const other of scene.edges) {
        if (other === edge || other.pts.length < 2 || tangled) continue;
        const seated = [other.pts[0], other.pts[other.pts.length - 1]].some((p) => {
          const otherSeat = sideOf(p, leaves);
          return otherSeat?.node === seat.node && otherSeat?.side === seat.side;
        });
        if (!seated) continue;
        for (let i = 0; i + 1 < pts.length && !tangled; i++)
          for (let j = 0; j + 1 < other.pts.length && !tangled; j++) {
            const hit = segmentsCross(pts[i], pts[i + 1], other.pts[j], other.pts[j + 1]);
            if (!hit) continue;
            const dx = Math.max(0, seat.node.x - hit.x, hit.x - (seat.node.x + seat.node.width));
            const dy = Math.max(0, seat.node.y - hit.y, hit.y - (seat.node.y + seat.node.height));
            if (dx * dx + dy * dy <= FAN_REACH * FAN_REACH) tangled = true;
          }
      }
    }
    if (tangled) {
      continue;
    }
    // New seats must not disturb the sides they join: every existing seat must
    // already be `MIN_ATTACH_GAP` away, leaving the separation pass nothing to
    // move. Rerouting one flow by jogging three neighbours' runs is a bad
    // trade (application-large: +2 staircases from one adopted seat), and the
    // offset grid usually finds a seat in a real gap instead.
    let disturbs = false;
    for (const terminal of [pts[0], pts[pts.length - 1]]) {
      const seat = sideOf(terminal, leaves);
      if (!seat || disturbs) continue;
      const vertical = seat.side === "east" || seat.side === "west";
      const along = vertical ? terminal.y : terminal.x;
      for (const other of scene.edges) {
        if (other === edge || other.pts.length < 2 || disturbs) continue;
        for (const p of [other.pts[0], other.pts[other.pts.length - 1]]) {
          const otherSeat = sideOf(p, leaves);
          if (otherSeat?.node !== seat.node || otherSeat?.side !== seat.side) continue;
          if (Math.abs((vertical ? p.y : p.x) - along) < MIN_ATTACH_GAP) {
            disturbs = true;
            break;
          }
        }
      }
    }
    if (disturbs) {
      continue;
    }
    // The reroute must bring this edge's labels along: each needs a seat on
    // the new route that no foreign run crosses and no node covers. Stranding
    // one beyond `ADRIFT` trades a wrap (ratchet) for an unattributable label
    // (hard invariant) — on logical-archi a 290px label had no clean seat on
    // the direct route and broke `labelAdrift` downstream.
    let labelsSeatable = true;
    for (const label of edge.labels) {
      if (!label.width || !label.height || !labelsSeatable) continue;
      let seatable = false;
      for (let index = 0; index + 1 < pts.length && !seatable; index++) {
        const seat = {
          x: (pts[index].x + pts[index + 1].x) / 2 - label.width / 2,
          y: (pts[index].y + pts[index + 1].y) / 2 - label.height / 2,
          width: label.width,
          height: label.height,
        };
        const coveredByNode = leaves.some(
          (node) =>
            seat.x < node.x + node.width &&
            node.x < seat.x + seat.width &&
            seat.y < node.y + node.height &&
            node.y < seat.y + seat.height,
        );
        if (coveredByNode) continue;
        let piercedSeat = false;
        for (const list of [outside.horizontal, outside.vertical]) {
          const listVertical = list === outside.vertical;
          for (const run of list) {
            const runX1 = listVertical ? run.at : run.lo;
            const runX2 = listVertical ? run.at : run.hi;
            const runY1 = listVertical ? run.lo : run.at;
            const runY2 = listVertical ? run.hi : run.at;
            const gapX = Math.max(0, seat.x - runX2, runX1 - (seat.x + seat.width));
            const gapY = Math.max(0, seat.y - runY2, runY1 - (seat.y + seat.height));
            if (gapX * gapX + gapY * gapY <= 1) {
              piercedSeat = true;
              break;
            }
          }
          if (piercedSeat) break;
        }
        if (!piercedSeat) seatable = true;
      }
      if (!seatable) labelsSeatable = false;
    }
    if (!labelsSeatable) {
      continue;
    }
    edge.pts = pts.map((p) => ({ ...p }));
    // No longer a channel route: the attachment-direction rule now owns it.
    edge.detour = false;
    break;
  }
}

function reaimWrapAroundTerminals(ctx: TidyContext): void {
  const { scene } = ctx;
  const rctx = createReaimContext(ctx);
  for (const edge of scene.edges) reaimEdge(rctx, edge);
}

/** Shifts one coincident run's shared axis to `newAt`, reconnecting any
 *  terminal that was seated on a node border. */
function shiftCoincidentRun(
  leaves: SceneNode[],
  pts: Point[],
  b: { vert: boolean; at: number },
  newAt: number,
): void {
  if (b.vert) {
    // Identify the vertical segment(s) at x==b.at and shift them
    const segments: [number, number][] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (
        Math.abs(pts[i].x - b.at) < ORTHOGONAL_EPSILON &&
        Math.abs(pts[i + 1].x - b.at) < ORTHOGONAL_EPSILON &&
        Math.abs(pts[i].y - pts[i + 1].y) >= ORTHOGONAL_EPSILON
      )
        segments.push([i, i + 1]);
    }
    if (!segments.length) return;
    const se = segments[0],
      ee = segments[segments.length - 1];
    const loIdx = pts[se[0]].y < pts[se[1]].y ? se[0] : se[1];
    const hiIdx = pts[ee[0]].y > pts[ee[1]].y ? ee[0] : ee[1];
    const loSeat = sideOf(pts[loIdx], leaves);
    const hiSeat = sideOf(pts[hiIdx], leaves);
    const loFree = !loSeat || loSeat.side === "west" || loSeat.side === "east";
    const hiFree = !hiSeat || hiSeat.side === "west" || hiSeat.side === "east";
    // Only shift if at least one end is free (not on a constrained border)
    if (!loFree && !hiFree) return;
    // Don't shift if it would push the run off the drawing
    if (newAt < 4) return;
    // Shift all points in the vertical segment range
    for (const [si, ei] of segments) {
      pts[si].x = newAt;
      pts[ei].x = newAt;
    }
    // If a terminal point was on a node border and the shift moved it off,
    // add a horizontal segment to reconnect.
    if (loSeat) {
      const targetX = loSeat.side === "west" ? loSeat.node.x : loSeat.node.x + loSeat.node.width;
      if (Math.abs(pts[loIdx].x - targetX) > ORTHOGONAL_EPSILON) {
        const newPt = { x: targetX, y: pts[loIdx].y };
        pts.splice(loIdx, 0, newPt);
      }
    }
    if (hiSeat && hiIdx !== loIdx) {
      const targetX = hiSeat.side === "west" ? hiSeat.node.x : hiSeat.node.x + hiSeat.node.width;
      const idx = hiIdx > loIdx ? hiIdx + (loSeat ? 1 : 0) : hiIdx;
      if (Math.abs(pts[idx].x - targetX) > ORTHOGONAL_EPSILON) {
        const newPt = { x: targetX, y: pts[idx].y };
        pts.splice(idx, 0, newPt);
      }
    }
  } else {
    // Horizontal run: shift y by delta, adjust vertical neighbours
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i].y - b.at) < ORTHOGONAL_EPSILON) pts[i].y = newAt;
    }
  }
}

function decoincideParallelRuns(ctx: TidyContext): void {
  const { scene, leaves, enforceOrthogonal } = ctx;
  // Post-pass: push apart parallel runs from different edges that are within 3px
  // with >8px shared overlap (coincident). For each pair, shift the corner point
  // of one run by 8px and add an intermediate segment to keep node attachments.
  const runs: { edge: SceneEdge; vert: boolean; at: number; lo: number; hi: number }[] = [];
  for (const edge of scene.edges) {
    for (let i = 0; i + 1 < edge.pts.length; i++) {
      const a = edge.pts[i],
        b = edge.pts[i + 1];
      if (Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON && Math.abs(a.y - b.y) >= ORTHOGONAL_EPSILON)
        runs.push({ edge, vert: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      if (Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON && Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON)
        runs.push({ edge, vert: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  }

  const coincidentPairs: [(typeof runs)[0], (typeof runs)[0]][] = [];
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[i].edge.id === runs[j].edge.id) continue;
      if (runs[i].vert !== runs[j].vert) continue;
      const gap = Math.abs(runs[i].at - runs[j].at);
      const shared = Math.min(runs[i].hi, runs[j].hi) - Math.max(runs[i].lo, runs[j].lo);
      if (gap < 3 && shared > 8) coincidentPairs.push([runs[i], runs[j]]);
    }

  for (const [a, b] of coincidentPairs) {
    // Try to push edge B's run away from A's by 8px
    const delta = a.at > b.at ? -8 : 8;
    const newAt = b.at + delta;
    const pts = b.edge.pts;
    shiftCoincidentRun(leaves, pts, b, newAt);
  }

  // Fix any orthogonality broken by the de-coincidence shifts
  for (const edge of scene.edges) if (edge.pts.length >= 2) enforceOrthogonal(edge);
}

/** Tries sliding the interior run at `index` to just below or above `band`,
 *  keeping the move only if the finished polyline stays clean. */
function tryLiftOffBand(
  ctx: TidyContext,
  edge: SceneEdge,
  index: number,
  band: TitleBox,
  outside: ReturnType<TidyContext["runsExcept"]>,
): boolean {
  const { runHitsNode, runIsClear, bandFor } = ctx;
  for (const target of [band.y + band.height + 6, band.y - 6]) {
    const attempt = edge.pts.map((p) => ({ ...p }));
    attempt[index].y = target;
    attempt[index + 1].y = target;
    let ok = true;
    for (let k = 0; ok && k + 1 < attempt.length; k++) {
      const p = attempt[k];
      const q = attempt[k + 1];
      const deltaX = Math.abs(p.x - q.x);
      const deltaY = Math.abs(p.y - q.y);
      if (deltaX >= ORTHOGONAL_EPSILON && deltaY >= ORTHOGONAL_EPSILON) ok = false;
      else {
        const runVertical = deltaX < ORTHOGONAL_EPSILON;
        const at = runVertical ? p.x : p.y;
        const from = runVertical ? p.y : p.x;
        const to = runVertical ? q.y : q.x;
        if (runHitsNode(runVertical, at, from, to)) ok = false;
        else if (!runIsClear(runVertical ? outside.vertical : outside.horizontal, at, from, to))
          ok = false;
        else if (!runVertical && bandFor(p, q)) ok = false;
      }
    }
    // Shifting a run lengthens one neighbour and shortens the other, and a
    // neighbour shortened past `JOG_SNAP` is a staircase step — trading a
    // struck title for a visible wobble. Measured: without this, 9 drawings
    // gained a sub-6px jog.
    if (ok)
      for (let k = 1; k + 2 <= attempt.length - 1; k++) {
        const length =
          Math.abs(attempt[k + 1].x - attempt[k].x) + Math.abs(attempt[k + 1].y - attempt[k].y);
        if (length > 0 && length <= JOG_SNAP) {
          ok = false;
          break;
        }
      }
    if (!ok) continue;
    edge.pts = attempt;
    return true;
  }
  return false;
}

function liftRunsOffTitleBands(ctx: TidyContext): void {
  const { scene, runsExcept, enforceOrthogonal, bandFor } = ctx;
  // Lift runs off container title bands (INVARIANTS §4e). Edges are drawn last
  // and a title carries no halo, so a run crossing one strikes through the
  // container's name — in `infrastructure-large` a flow ran the length of the
  // "K8s cluster business" title with its own label parked on top of it.
  //
  // `route-detour` has always treated title bands as obstacles when planning a
  // channel; elk never learned to, so the runs it plans itself go straight
  // through. This repairs those: slide the offending *interior* run clear of
  // the band, nearest edge first, and keep the move only if the finished
  // polyline is still clean by every rule this pass enforces.
  for (const edge of scene.edges) {
    if (edge.pts.length < 4) continue; // needs an interior run to move
    for (let index = 1; index + 2 < edge.pts.length; index++) {
      const a = edge.pts[index];
      const b = edge.pts[index + 1];
      const band = bandFor(a, b);
      if (!band) continue;
      const outside = runsExcept(edge.id);
      // Below the band first: a container's body is routable, its name is not,
      // and dropping into the body keeps the flow inside the box it was
      // crossing anyway. Above only if the band sits at the very top.
      tryLiftOffBand(ctx, edge, index, band, outside);
    }
  }
  for (const edge of scene.edges) if (edge.pts.length >= 2) enforceOrthogonal(edge);
}

function nestCorridorRisers(ctx: TidyContext): void {
  const { scene, runsExcept, runHitsNode, runIsClear, enforceOrthogonal, bandFor } = ctx;
  // Nest corridor risers (§4f): flows crossing a corridor usually keep their
  // relative order end to end, and never need to cross when they do.
  // `infrastructure-large` had three such flows crossing four times, purely
  // because the deepest-descending one turned last instead of first.
  //
  // The rule `route-detour` applies to its channels (travel direction first,
  // reach descending, so spans nest), here for ordinary traffic. Safe where two
  // earlier attempts were not: the lanes are a fixed set, so no new corridor is
  // invented; and permutations are scored, never reasoned about — hand-derived
  // orderings were wrong twice, since a pairwise swap fixes its own pair and
  // costs 2 elsewhere when the answer is a 3-cycle. Every permutation is
  // applied, validated and counted; the best wins only if strictly better.
  const riserIndexOf = (edge: SceneEdge): number => {
    let found = -1;
    for (let index = 1; index + 2 < edge.pts.length; index++) {
      const a = edge.pts[index];
      const b = edge.pts[index + 1];
      if (Math.abs(a.x - b.x) >= ORTHOGONAL_EPSILON || Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON)
        continue;
      if (Math.abs(edge.pts[index - 1].y - a.y) >= ORTHOGONAL_EPSILON) continue;
      if (Math.abs(edge.pts[index + 2].y - b.y) >= ORTHOGONAL_EPSILON) continue;
      // Keep the *last* riser, nearest the target: that is the lane the flow
      // approaches on, so it is what orders the flow against its neighbours.
      // Requiring exactly one riser made the first version a no-op on the very
      // case it was written for — the flow at the centre of the tangle turned
      // twice and was excluded, leaving a pair only a 3-cycle could fix.
      found = index;
    }
    return found;
  };
  const crossCount = (a: Point[], b: Point[]): number => {
    let total = 0;
    for (let i = 0; i + 1 < a.length; i++)
      for (let j = 0; j + 1 < b.length; j++)
        if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) total++;
    return total;
  };
  const flowRank = (edge: SceneEdge) => Number.parseInt(edge.id.slice(1), 10) || 0;

  const risers = scene.edges
    .map((edge) => ({ edge, riser: riserIndexOf(edge) }))
    .filter((entry) => entry.riser >= 0)
    .sort((a, b) => flowRank(a.edge) - flowRank(b.edge));

  // Groups are the connected components of "these two flows actually cross".
  // Grouping by geometry instead would need a corridor width to guess at; this
  // needs nothing, and by construction only touches flows that have a defect.
  const parent = risers.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  for (let i = 0; i < risers.length; i++)
    for (let j = i + 1; j < risers.length; j++)
      if (crossCount(risers[i].edge.pts, risers[j].edge.pts) > 0) parent[find(i)] = find(j);

  const riserGroups = new Map<number, number[]>();
  for (let index = 0; index < risers.length; index++) {
    const root = find(index);
    riserGroups.set(root, [...(riserGroups.get(root) ?? []), index]);
  }

  const permutationsOf = (n: number): number[][] => {
    if (n === 1) return [[0]];
    const out: number[][] = [];
    for (const rest of permutationsOf(n - 1))
      for (let slot = 0; slot < n; slot++)
        out.push([...rest.slice(0, slot), n - 1, ...rest.slice(slot)]);
    return out.sort((a, b) => a.join().localeCompare(b.join()));
  };

  for (const key of [...riserGroups.keys()].sort((a, b) => a - b)) {
    const members: { edge: SceneEdge; riser: number }[] = riserGroups
      .get(key)!
      .map((index) => risers[index]);
    // 2..4 keeps the permutation count at 24 and the scoring exhaustive. Larger
    // tangles are not a lane-ordering problem — they need elk to lay them out
    // differently — and guessing at them is how a pass starts shuffling damage.
    if (members.length < 2 || members.length > 4) continue;
    const ids = members.map((member) => member.edge.id);
    const outsiders = scene.edges.filter((edge) => !ids.includes(edge.id));
    const outside = runsExcept(...ids);

    const scoreOf = (shapes: Point[][]) => {
      let total = 0;
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) total += crossCount(shapes[i], shapes[j]);
        for (const other of outsiders) total += crossCount(shapes[i], other.pts);
      }
      return total;
    };
    const clean = (pts: Point[]) => {
      for (let index = 0; index + 1 < pts.length; index++) {
        const a = pts[index];
        const b = pts[index + 1];
        const deltaX = Math.abs(a.x - b.x);
        const deltaY = Math.abs(a.y - b.y);
        if (deltaX >= ORTHOGONAL_EPSILON && deltaY >= ORTHOGONAL_EPSILON) return false;
        const runVertical = deltaX < ORTHOGONAL_EPSILON;
        const at = runVertical ? a.x : a.y;
        const from = runVertical ? a.y : a.x;
        const to = runVertical ? b.y : b.x;
        if (runHitsNode(runVertical, at, from, to)) return false;
        if (!runIsClear(runVertical ? outside.vertical : outside.horizontal, at, from, to))
          return false;
        if (!runVertical && bandFor(a, b)) return false;
        const length = deltaX + deltaY;
        if (index > 0 && index + 2 < pts.length && length > 0 && length <= JOG_SNAP) return false;
      }
      return true;
    };

    const lanes = members.map((member) => member.edge.pts[member.riser].x);
    const current: Point[][] = members.map((member) => member.edge.pts.map((p) => ({ ...p })));
    let bestScore = scoreOf(current);
    let best: Point[][] | null = null;
    for (const permutation of permutationsOf(members.length)) {
      if (permutation.every((lane, index) => lane === index)) continue;
      const shapes: Point[][] = members.map((member, index) => {
        const pts: Point[] = member.edge.pts.map((p) => ({ ...p }));
        pts[member.riser].x = lanes[permutation[index]];
        pts[member.riser + 1].x = lanes[permutation[index]];
        return pts;
      });
      if (!shapes.every(clean)) continue;
      const score = scoreOf(shapes);
      if (score < bestScore) {
        bestScore = score;
        best = shapes;
      }
    }
    if (!best) continue;
    members.forEach((member, index) => {
      member.edge.pts = best![index];
    });
  }

  for (const edge of scene.edges) if (edge.pts.length >= 2) enforceOrthogonal(edge);
}

interface UnweaveContext {
  scene: Scene;
  leaves: SceneNode[];
  titleBoxes: TitleBox[];
  folded: boolean;
  runsExcept: TidyContext["runsExcept"];
  runHitsNode: TidyContext["runHitsNode"];
  runIsClear: TidyContext["runIsClear"];
  enforceOrthogonal: TidyContext["enforceOrthogonal"];
  UNWEAVE_TURNS: number;
  BAND_MARGIN: number;
  ALL_SIDES: Side[];
  foreignContainerHits(pts: Point[], ownEnds: (SceneNode | undefined)[]): number;
  unweaveSeat(node: SceneNode, side: Side, offset: number): Point;
  unweaveRoutes(a: Point, aSide: Side, b: Point, bSide: Side): Point[][];
  crossingPartners(pts: Point[], exceptId: string): Set<string>;
}

function createUnweaveContext(ctx: TidyContext): UnweaveContext {
  const {
    scene,
    leaves,
    titleBoxes,
    folded,
    runsExcept,
    runHitsNode,
    runIsClear,
    enforceOrthogonal,
  } = ctx;
  // Unweave (§4g): two nodes are always joinable by a straight run, an L or a Z,
  // so three turns means a flow left through a side that did not face where it
  // was going.
  //
  // Runs last, deliberately. An earlier attempt sat beside the §4c reroute at
  // the top of this pass and validated candidates that four later mutations —
  // attachment separation, de-coincidence, title lifting, riser nesting — then
  // reshaped: routes proven crossing-free when chosen were not when drawn, at 16
  // per-drawing regressions. Down here, what is validated is what is rendered.
  //
  // Rule: no candidate may add a crossing; among those that turn less than the
  // route they replace, the shortest wins. Size is the tie-break, never the gate.
  //
  // §4h rides along: a run may cross a container holding one of its endpoints —
  // that is how anything leaves a zone — and no other. `Kafka → Backup server`
  // cut through `PostgreSQL standby` unseen, because `throughBox` and every
  // guard here test leaf nodes only; container interiors are routable by design.
  const boxed = scene.nodes.filter((node) => node.container);
  const holdsOf = new Map<string, Set<string>>();
  for (const box of boxed) {
    const held = new Set<string>();
    for (const node of scene.nodes)
      if (
        node !== box &&
        node.x >= box.x - 1 &&
        node.y >= box.y - 1 &&
        node.x + node.width <= box.x + box.width + 1 &&
        node.y + node.height <= box.y + box.height + 1
      )
        held.add(node.id);
    holdsOf.set(box.id, held);
  }
  const foreignContainerHits = (pts: Point[], ownEnds: (SceneNode | undefined)[]) => {
    let total = 0;
    for (const box of boxed) {
      const held = holdsOf.get(box.id)!;
      if (ownEnds.some((node) => node && (node === box || held.has(node.id)))) continue;
      for (let index = 0; index + 1 < pts.length; index++) {
        const a = pts[index];
        const b = pts[index + 1];
        if (
          Math.min(a.x, b.x) < box.x + box.width - 1 &&
          box.x + 1 < Math.max(a.x, b.x) &&
          Math.min(a.y, b.y) < box.y + box.height - 1 &&
          box.y + 1 < Math.max(a.y, b.y)
        )
          total++;
      }
    }
    return total;
  };

  const UNWEAVE_TURNS = 3;
  const BAND_MARGIN = 38;
  const ALL_SIDES: Side[] = ["north", "south", "east", "west"];
  const unweaveSeat = (node: SceneNode, side: Side, offset: number): Point => {
    const alongX = Math.min(
      Math.max(node.x + node.width / 2 + offset, node.x + SIDE_INSET),
      node.x + node.width - SIDE_INSET,
    );
    const alongY = Math.min(
      Math.max(node.y + node.height / 2 + offset, node.y + SIDE_INSET),
      node.y + node.height - SIDE_INSET,
    );
    return side === "north"
      ? { x: alongX, y: node.y }
      : side === "south"
        ? { x: alongX, y: node.y + node.height }
        : side === "west"
          ? { x: node.x, y: alongY }
          : { x: node.x + node.width, y: alongY };
  };
  const outward = (side: Side): Point =>
    side === "north"
      ? { x: 0, y: -1 }
      : side === "south"
        ? { x: 0, y: 1 }
        : side === "west"
          ? { x: -1, y: 0 }
          : { x: 1, y: 0 };
  /** L when the two sides face across each other, Z when they oppose. */
  const unweaveRoutes = (a: Point, aSide: Side, b: Point, bSide: Side): Point[][] => {
    const na = outward(aSide);
    const nb = outward(bSide);
    const aHoriz = na.x !== 0;
    const bHoriz = nb.x !== 0;
    if (aHoriz !== bHoriz) return [[a, aHoriz ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, b]];
    if (na.x !== -nb.x || na.y !== -nb.y) return []; // same outward side: a wrap, not a route
    if (aHoriz)
      return [(a.x + b.x) / 2, Math.min(a.x, b.x) + 12, Math.max(a.x, b.x) - 12].map((mid) => [
        a,
        { x: mid, y: a.y },
        { x: mid, y: b.y },
        b,
      ]);
    return [(a.y + b.y) / 2, Math.min(a.y, b.y) + 12, Math.max(a.y, b.y) - 12].map((mid) => [
      a,
      { x: a.x, y: mid },
      { x: b.x, y: mid },
      b,
    ]);
  };
  /**
   * *Which* flows a route crosses, not how many times.
   *
   * Counting was not enough. Unweaving `Hub de paiement → PostgreSQL primaire`
   * traded two crossings with one flow for one with another: the drawing's total
   * fell, the per-drawing gate saw an improvement, and a brand-new crossing
   * appeared beside the node in an area that had been clean. A total cannot see
   * that — only the *set* of partners can. So a candidate may drop crossings
   * freely and may never gain a partner it did not already cross.
   */
  const crossingPartners = (pts: Point[], exceptId: string) => {
    const partners = new Set<string>();
    for (const other of scene.edges) {
      if (other.id === exceptId || other.pts.length < 2) continue;
      for (let i = 0; i + 1 < pts.length; i++)
        for (let j = 0; j + 1 < other.pts.length; j++)
          if (segmentsCross(pts[i], pts[i + 1], other.pts[j], other.pts[j + 1]))
            partners.add(other.id);
    }
    return partners;
  };

  return {
    scene,
    leaves,
    titleBoxes,
    folded,
    runsExcept,
    runHitsNode,
    runIsClear,
    enforceOrthogonal,
    UNWEAVE_TURNS,
    BAND_MARGIN,
    ALL_SIDES,
    foreignContainerHits,
    unweaveSeat,
    unweaveRoutes,
    crossingPartners,
  };
}

function unweaveEdge(uctx: UnweaveContext, edge: SceneEdge): void {
  const {
    scene,
    leaves,
    titleBoxes,
    folded,
    runsExcept,
    runHitsNode,
    runIsClear,
    enforceOrthogonal,
    UNWEAVE_TURNS,
    BAND_MARGIN,
    ALL_SIDES,
    foreignContainerHits,
    unweaveSeat,
    unweaveRoutes,
    crossingPartners,
  } = uctx;
  if (folded || edge.pts.length < 2) return;
  const currentTurns = edge.pts.length - 2;
  const srcSeat = sideOf(edge.pts[0], leaves);
  const dstSeat = sideOf(edge.pts[edge.pts.length - 1], leaves);
  if (!srcSeat || !dstSeat || srcSeat.node === dstSeat.node) return;
  const ownEnds = [srcSeat.node, dstSeat.node];
  // Re-route for either reason: the flow weaves (§4g), or it cuts through a
  // container that is none of its business (§4h). §4h is Tier 0 — it destroys
  // the reading of a component — so it justifies a reroute that turns no less.
  const foreignBefore = foreignContainerHits(edge.pts, ownEnds);
  if (currentTurns < UNWEAVE_TURNS && foreignBefore === 0) return;

  const partnersNow = crossingPartners(edge.pts, edge.id);
  const outside = runsExcept(edge.id);
  // Seats already taken on each side, so a candidate never lands on top of a
  // neighbour — `attachShared` is a must-be-zero invariant.
  const takenOn = (node: SceneNode, side: Side) => {
    const along: number[] = [];
    for (const other of scene.edges) {
      if (other.id === edge.id || other.pts.length < 2) continue;
      for (const p of [other.pts[0], other.pts[other.pts.length - 1]]) {
        const seat = sideOf(p, leaves);
        if (seat?.node !== node || seat.side !== side) continue;
        along.push(side === "east" || side === "west" ? p.y : p.x);
      }
    }
    return along;
  };
  const clearOfNeighbours = (point: Point, node: SceneNode, side: Side) => {
    const vertical = side === "east" || side === "west";
    const at = vertical ? point.y : point.x;
    return takenOn(node, side).every((other) => Math.abs(other - at) >= MIN_ATTACH_GAP);
  };
  const cleanRoute = (pts: Point[]) => {
    for (let index = 0; index + 1 < pts.length; index++) {
      const a = pts[index];
      const b = pts[index + 1];
      const deltaX = Math.abs(a.x - b.x);
      const deltaY = Math.abs(a.y - b.y);
      if (deltaX >= ORTHOGONAL_EPSILON && deltaY >= ORTHOGONAL_EPSILON) return false;
      const runVertical = deltaX < ORTHOGONAL_EPSILON;
      const at = runVertical ? a.x : a.y;
      const from = runVertical ? a.y : a.x;
      const to = runVertical ? b.y : b.x;
      if (runHitsNode(runVertical, at, from, to)) return false;
      if (!runIsClear(runVertical ? outside.vertical : outside.horizontal, at, from, to))
        return false;
      // Titles, both orientations. `bandFor` only judges horizontals — a
      // riser through a container's name strikes it just as thoroughly, and
      // skipping that check is what put `titleStruck` up across `large-slide`.
      // Judged exactly as the sweep judges `titleStruck` — a box overlap, not
      // a strict interior test. The two disagreeing is how a run laid along a
      // band's very edge passed here and was counted there.
      for (const band of titleBoxes) {
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x);
        const y1 = Math.min(a.y, b.y);
        const y2 = Math.max(a.y, b.y);
        // With margin: `compact` runs after this pass and shifts bands and
        // runs by a per-row amount, so a route that merely grazes a title now
        // can be pushed onto it later.
        if (
          x1 < band.x + band.width + BAND_MARGIN &&
          band.x - BAND_MARGIN < x2 &&
          y1 < band.y + band.height + BAND_MARGIN &&
          band.y - BAND_MARGIN < y2
        )
          return false;
      }
      // Interior segments must clear the *staircase* threshold, not merely the
      // micro-jog one: a Z whose crossing lane is 15px long reads as a step
      // and is counted by `jog<=20`.
      const length = deltaX + deltaY;
      if (index > 0 && index + 2 < pts.length && length > 0 && length <= 20) return false;
    }
    return true;
  };
  /** Crossings with flows seated on the same node side, inside its fan (§4b). */
  const fanTanglesOf = (pts: Point[]) => {
    let total = 0;
    for (const terminal of [pts[0], pts[pts.length - 1]]) {
      const seat = sideOf(terminal, leaves);
      if (!seat) continue;
      for (const other of scene.edges) {
        if (other.id === edge.id || other.pts.length < 2) continue;
        const sibling = [other.pts[0], other.pts[other.pts.length - 1]].some((p) => {
          const s = sideOf(p, leaves);
          return s?.node === seat.node && s.side === seat.side;
        });
        if (!sibling) continue;
        for (let i = 0; i + 1 < pts.length; i++)
          for (let j = 0; j + 1 < other.pts.length; j++) {
            const hit = segmentsCross(pts[i], pts[i + 1], other.pts[j], other.pts[j + 1]);
            if (!hit) continue;
            const dx = Math.max(0, seat.node.x - hit.x, hit.x - (seat.node.x + seat.node.width));
            const dy = Math.max(0, seat.node.y - hit.y, hit.y - (seat.node.y + seat.node.height));
            if (dx * dx + dy * dy <= FAN_REACH * FAN_REACH) total++;
          }
      }
    }
    return total;
  };
  const fanTanglesNow = fanTanglesOf(edge.pts);
  /**
   * Can every label this flow carries find a seat on the new route clear of
   * node boxes and container titles? `label-anchor` runs later and keeps a
   * label on its run even at the cost of covering a title (§4d outranks §4e),
   * so a route that strands its labels pays for its straightness in struck
   * titles — measured on `logical-archi`.
   */
  const labelsSeatable = (pts: Point[]) => {
    for (const label of edge.labels) {
      if (!label.width || !label.height) continue;
      const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
      let seatable = false;
      for (let index = 0; index + 1 < pts.length && !seatable; index++) {
        const seat = {
          x: (pts[index].x + pts[index + 1].x) / 2 - label.width / 2,
          y: (pts[index].y + pts[index + 1].y) / 2 - lead,
          width: label.width,
          height: label.height,
        };
        const hits =
          (margin: number) => (box: { x: number; y: number; width: number; height: number }) =>
            seat.x < box.x + box.width + margin &&
            box.x - margin < seat.x + seat.width &&
            seat.y < box.y + box.height + margin &&
            box.y - margin < seat.y + seat.height;
        // Bands get the same margin the runs get: `compact` shifts label and
        // band by different per-row amounts, so a seat that merely clears a
        // title now can be sitting on it by the time it is drawn.
        if (!leaves.some(hits(0)) && !titleBoxes.some(hits(BAND_MARGIN))) seatable = true;
      }
      if (!seatable) return false;
    }
    return true;
  };

  let best: Point[] | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (const srcSide of ALL_SIDES)
    for (const dstSide of ALL_SIDES)
      for (const srcOffset of [0, -18, 18, -36, 36])
        for (const dstOffset of [0, -18, 18, -36, 36]) {
          const a = unweaveSeat(srcSeat.node, srcSide, srcOffset);
          const b = unweaveSeat(dstSeat.node, dstSide, dstOffset);
          if (!clearOfNeighbours(a, srcSeat.node, srcSide)) continue;
          if (!clearOfNeighbours(b, dstSeat.node, dstSide)) continue;
          for (const raw of unweaveRoutes(a, srcSide, b, dstSide)) {
            const pts = raw.filter(
              (p, index) =>
                index === 0 ||
                Math.abs(p.x - raw[index - 1].x) >= ORTHOGONAL_EPSILON ||
                Math.abs(p.y - raw[index - 1].y) >= ORTHOGONAL_EPSILON,
            );
            if (pts.length < 2) continue;
            // Never cut through a stranger's container, and never buy turns
            // with one: §4h outranks §4g.
            const foreignAfter = foreignContainerHits(pts, ownEnds);
            if (foreignAfter > foreignBefore) continue;
            const clearsForeign = foreignAfter < foreignBefore;
            // Clearing a container buys a *equal* turn count, never a worse
            // one: §4h outranks §4g, but paying for it with a new weave just
            // moves the reader's problem down a tier.
            if (clearsForeign ? pts.length - 2 > currentTurns : pts.length - 2 >= currentTurns)
              continue;
            const length = sharedPathLength(pts);
            if (length >= bestLength) continue;
            if (!cleanRoute(pts)) continue;
            const partners = crossingPartners(pts, edge.id);
            if ([...partners].some((id) => !partnersNow.has(id))) continue;
            if (fanTanglesOf(pts) > fanTanglesNow) continue;
            if (!labelsSeatable(pts)) continue;
            best = pts;
            bestLength = length;
          }
        }
  if (best) {
    edge.pts = best;
    enforceOrthogonal(edge);
  }
}

function unweaveAndClearContainers(ctx: TidyContext): void {
  const uctx = createUnweaveContext(ctx);
  const { scene } = uctx;
  for (const edge of [...scene.edges].sort(
    (a, b) => (Number.parseInt(a.id.slice(1), 10) || 0) - (Number.parseInt(b.id.slice(1), 10) || 0),
  )) {
    unweaveEdge(uctx, edge);
  }
}

export function tidyEdges(
  scene: Scene,
  titleBoxes: TitleBox[] = [],
  /**
   * Folded slide layouts (`slide-fold`) hand-route their connectors on a lane
   * grid rather than letting elk plan them. Unweaving (§4g) re-sides a terminal
   * on the assumption that the route is elk's to rearrange; on that grid it
   * costs a lane and the neighbours reflow, which showed up as struck titles.
   * Those layouts keep their weaves.
   */
  folded = false,
): void {
  const leaves = scene.nodes.filter((node) => !node.container);
  if (!leaves.length) return;
  const ctx = createTidyContext(scene, leaves, titleBoxes, folded);

  straightenAndCollapse(ctx);
  reaimWrapAroundTerminals(ctx);

  // Separate flows sharing a node side. Kept as its own function: the same
  // pass runs again after `optimiseRoutes` (see `spreadAttachments`).
  spreadAttachments(scene);

  decoincideParallelRuns(ctx);

  // Push runs off the node and container sides they do not attach to. Kept as
  // its own function: like `spreadAttachments`, it must run again after
  // `compactVertical` — compaction shrinks the gaps this pass judges.
  clearSideHugs(scene, titleBoxes);

  liftRunsOffTitleBands(ctx);
  nestCorridorRisers(ctx);
  unweaveAndClearContainers(ctx);
}

/**
 * Is every label of this flow sitting on its own run (INVARIANTS §4d)? Same
 * measurement the sweep's `labelOffLine` uses: the *text* centre against the
 * polyline, not the box centre.
 */
export function labelsSeated(edge: SceneEdge): boolean {
  const SLACK_SQ = 2 * 2;
  return edge.labels.every((label) => {
    const cx = label.x + label.width / 2;
    const cy = label.y + (label.textH > 0 ? label.textH / 2 : label.height / 2);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < edge.pts.length; i++) {
      const p = edge.pts[i];
      const q = edge.pts[i + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((cx - p.x) * dx + (cy - p.y) * dy) / len));
      const ex = cx - (p.x + t * dx);
      const ey = cy - (p.y + t * dy);
      best = Math.min(best, ex * ex + ey * ey);
    }
    return best <= SLACK_SQ;
  });
}

/**
 * Stage 3c: ladder-driven route repair. Runs as its own pass, **after**
 * `label-anchor` and `compact`, because those two reshape geometry: a route
 * this optimiser validated while it still sat inside `tidyEdges` was not the
 * route that got drawn, and the corpus said so — 36 per-drawing regressions on
 * `infrastructure-large` alone, including crossings the ladder explicitly
 * refuses to gain. No pass after this may re-route edges; later passes may only
 * slide terminals along an existing side (spreadAttachments), clear a side hug
 * (clearSideHugs), or swap sibling seats (swapCrossingSiblingSeats). The caller
 * re-anchors labels onto the routes it settles on.
 */
export function optimiseRoutes(scene: Scene, titleBoxes: TitleBox[] = [], folded = false): void {
  const leaves = scene.nodes.filter((node) => !node.container);
  const enforceOrthogonal = (edge: SceneEdge) => enforceOrthogonalOn(edge, leaves);

  // Ladder-driven route repair (§4): one optimiser, one acceptance rule,
  // replacing the private tests this pass used to carry — "strictly shorter",
  // "fewer crossings", "clears a container" — which disagreed and produced
  // defects that moved rather than went (see `readability.ts`).
  //
  // Two properties, both learned by getting them wrong. It runs last, because
  // everything above still reshapes geometry and an earlier version at the top
  // cost 16 per-drawing regressions. And it moves flows in groups, because a
  // corridor frees up only when several move together: the crossing between two
  // flows into one database cannot be fixed one at a time, since whichever moves
  // first collides with the one that has not.
  if (!folded) {
    const inspector = inspect(scene, titleBoxes);
    /** Flows `route-detour` already sent through a channel — their flag is not ours to touch. */
    const preRouted = new Set(scene.edges.filter((edge) => edge.detour).map((edge) => edge.id));
    // Three seats a side, not five. The optimiser evaluates every candidate
    // against the whole scene, so the candidate count is the cost driver; 25
    // seat pairs per side pair tripled build time for a handful of extra
    // solutions the ±18 offsets already reach.
    const SEAT_OFFSETS = [0, -18, 18];
    /**
     * How far a derived seat steps past the name it is escaping.
     *
     * `ARROW_ROOM`, not a token 4px: the step becomes the first leg of whatever
     * route uses the seat, and a leg under 14px is charged as `cramped` (§4i).
     * At 4px the optimiser cleared a struck title, was immediately handed a
     * tier-2 cramped terminal for the 12px leg it had just created, and bought
     * its way out with a two-turn detour — trading the tidy route for an ugly
     * one to fix a defect the seat itself introduced.
     */
    const SEAT_CLEAR = 14;
    const SIDES: Side[] = ["north", "south", "east", "west"];

    /**
     * Container names lying across a node side, merged into the one interval a
     * seat has to escape — or `null` when the side is clear.
     *
     * Judged at the side's centre, which is where the default seat sits: a name
     * that does not cover the centre is not what is pushing the flow off, and
     * widening the search for it only costs candidates.
     */
    const blockedSpan = (node: SceneNode, side: Side): [number, number] | null => {
      const alongX = side === "north" || side === "south";
      const centre = alongX ? node.x + node.width / 2 : node.y + node.height / 2;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const band of titleBoxes) {
        const bandLo = alongX ? band.x : band.y;
        const bandHi = alongX ? band.x + band.width : band.y + band.height;
        if (centre < bandLo || centre > bandHi) continue;
        lo = Math.min(lo, bandLo);
        hi = Math.max(hi, bandHi);
      }
      return lo <= hi ? [lo, hi] : null;
    };

    /**
     * Where a flow may attach to a side: three fixed seats, plus the two that
     * step clear of a container's name when one lies across that side.
     *
     * Derived, not added to the fixed list, for the reason `laneBeyond` exists:
     * a wider fixed list is guesswork that costs candidates everywhere to help
     * in a few places, and 25 seat pairs per side pair tripled build time.
     *
     * Every side pair gets the same reach. Giving it to same-facing sides only
     * left `infrastructure-small-tall` with no L or Z able to get out from under
     * the "Public zone" name, so a U won by default and a flow that should have
     * stepped 44px sideways bulged out of its column.
     */
    const seatOffsetCache = new Map<string, number[]>();
    const seatOffsetsFor = (node: SceneNode, side: Side): number[] => {
      const key = `${node.id}|${side}`;
      const hit = seatOffsetCache.get(key);
      if (hit) return hit;
      const span = blockedSpan(node, side);
      const alongX = side === "north" || side === "south";
      const centre = alongX ? node.x + node.width / 2 : node.y + node.height / 2;
      const made = span
        ? [...SEAT_OFFSETS, span[0] - SEAT_CLEAR - centre, span[1] + SEAT_CLEAR - centre]
        : SEAT_OFFSETS;
      seatOffsetCache.set(key, made);
      return made;
    };

    const seatOn = (node: SceneNode, side: Side, offset: number): Point => {
      const alongX = Math.min(
        Math.max(node.x + node.width / 2 + offset, node.x + SIDE_INSET),
        node.x + node.width - SIDE_INSET,
      );
      const alongY = Math.min(
        Math.max(node.y + node.height / 2 + offset, node.y + SIDE_INSET),
        node.y + node.height - SIDE_INSET,
      );
      return side === "north"
        ? { x: alongX, y: node.y }
        : side === "south"
          ? { x: alongX, y: node.y + node.height }
          : side === "west"
            ? { x: node.x, y: alongY }
            : { x: node.x + node.width, y: alongY };
    };
    const outward = (side: Side) =>
      side === "north" ? 1 : side === "south" ? 2 : side === "west" ? 3 : 4;
    const horizontalSide = (side: Side) => side === "east" || side === "west";

    // Extent of the drawing, for the channel a same-facing U escapes into.
    const contentTop = Math.min(...scene.nodes.map((node) => node.y));
    const contentBottom = Math.max(...scene.nodes.map((node) => node.y + node.height));
    const contentLeft = Math.min(...scene.nodes.map((node) => node.x));
    const contentRight = Math.max(...scene.nodes.map((node) => node.x + node.width));
    /** Clear of the outermost border without leaving the canvas. */
    const CHANNEL_MARGIN = 10;
    /** How far past the nearer seat a mid-drawing channel has to sit to be worth a turn. */
    const CHANNEL_STEP = 24;

    /** Room a lane keeps from whatever it clears — past `HUG_CLEAR`, so the two never read as one line. */
    const CHANNEL_CLEAR = 10;

    /** Bumped by every accepted move; invalidates every cache keyed on the scene's geometry. */
    let generation = 0;

    /**
     * How far past a foreign run a lane has to sit for the label it carries to
     * clear that run (§4j) — half the label, plus enough that the box edge does
     * not graze the line.
     *
     * Derived from the edge's own labels rather than a constant, because that
     * is what the defect is measured against: a 142px label needs 73px of room
     * and a bare `(AMQP)` needs 26, and a single number would either strand the
     * wide ones or shove the narrow ones across the drawing for nothing. An
     * unlabelled flow reaches nothing extra — `CHANNEL_CLEAR` already keeps the
     * lines apart, and §4j is a rule about words.
     */
    const STRADDLE_MARGIN = 2;
    const runReach = (edge: SceneEdge, vertical: boolean): number => {
      let reach = CHANNEL_CLEAR;
      for (const label of edge.labels) {
        if (!label.width || !label.height) continue;
        const across = (vertical ? label.height : label.width) / 2 + STRADDLE_MARGIN;
        if (across > reach) reach = across;
      }
      return reach;
    };

    /**
     * Every run already parallel to a lane on this axis, as obstacles the
     * lane must clear.
     *
     * Memoised per edge × axis: `laneBeyond` is called once per same-facing
     * seat pair, up to a hundred times for one edge, and rebuilding this from
     * every segment each time is the difference between a cheap check and a
     * visible build cost.
     *
     * Invalidated by `generation`, the same counter the unmoved-profile cache
     * uses, since these are other flows' routes and an accepted move changes
     * them.
     */
    interface LaneBlock {
      alongLo: number;
      alongHi: number;
      acrossLo: number;
      acrossHi: number;
    }
    const runBlockCache = new Map<string, { at: number; blocks: LaneBlock[] }>();
    const parallelRunBlocks = (edge: SceneEdge, vertical: boolean): LaneBlock[] => {
      const key = `${edge.id}|${vertical}`;
      const hit = runBlockCache.get(key);
      if (hit && hit.at === generation) return hit.blocks;
      // The lane runs across the span, so it is vertical exactly when the span
      // axis is not — and a foreign run is parallel to it on the same terms.
      const laneVertical = !vertical;
      const slack = runReach(edge, vertical) - CHANNEL_CLEAR;
      const blocks: LaneBlock[] = [];
      for (const other of scene.edges) {
        if (other.id === edge.id || other.pts.length < 2) continue;
        for (let index = 0; index + 1 < other.pts.length; index++) {
          const a = other.pts[index];
          const b = other.pts[index + 1];
          const runVertical = Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON;
          const runHorizontal = Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON;
          if (runVertical === runHorizontal) continue;
          if (runVertical !== laneVertical) continue;
          const at = laneVertical ? a.x : a.y;
          const from = laneVertical ? a.y : a.x;
          const to = laneVertical ? b.y : b.x;
          blocks.push({
            alongLo: Math.min(from, to),
            alongHi: Math.max(from, to),
            acrossLo: at - slack,
            acrossHi: at + slack,
          });
        }
      }
      runBlockCache.set(key, { at: generation, blocks });
      return blocks;
    };

    /**
     * The lowest lane beyond `start` the connecting run may legally occupy
     * across `span`. §4h turned from a score into a coordinate: obstacles are
     * every leaf box, container title, and container holding neither endpoint
     * that overlaps `span` — the turn is derived, not guessed and checked after.
     *
     * Parallel runs are obstacles too (§4j). With boxes only, two independently
     * derived lanes could coincide: on `small/page` this returned its default
     * `near - CHANNEL_STEP` = 91 without iterating, five pixels from a riser
     * another flow had put at 96, seating both labels under the other's flow.
     *
     * Cleared by `runReach`, not `CHANNEL_CLEAR` — 10px between lines
     * (`nearParallel`) is nothing once the label on the lane reaches half its
     * width either side.
     *
     * Iterative because clearing one obstacle exposes the next; bounded by the
     * obstacle count and monotone. `null` when the drawing leaves no room.
     */
    const laneBeyond = (
      spanLo: number,
      spanHi: number,
      start: number,
      vertical: boolean,
      before: boolean,
      ends: ReturnType<typeof inspector.endsOf>,
      edge: SceneEdge,
      clearRuns: boolean,
    ): number | null => {
      const own = new Set<string>();
      for (const end of ends) if (end) own.add(end.node.id);
      interface Block {
        alongLo: number;
        alongHi: number;
        acrossLo: number;
        acrossHi: number;
      }
      const blocks: Block[] = [];
      const push = (x: number, y: number, w: number, h: number) =>
        blocks.push(
          vertical
            ? { alongLo: x, alongHi: x + w, acrossLo: y, acrossHi: y + h }
            : { alongLo: y, alongHi: y + h, acrossLo: x, acrossHi: x + w },
        );
      for (const leaf of inspector.leaves)
        if (!own.has(leaf.id)) push(leaf.x, leaf.y, leaf.width, leaf.height);
      for (const box of inspector.boxes) {
        // §4h: a container holding one of this flow's endpoints is not an
        // obstacle — passing through it is how the flow leaves at all.
        const inside = inspector.holds.get(box.id)!;
        if (own.has(box.id) || [...own].some((id) => inside.has(id))) continue;
        push(box.x, box.y, box.width, box.height);
      }
      for (const band of titleBoxes) push(band.x, band.y, band.width, band.height);
      if (clearRuns) for (const block of parallelRunBlocks(edge, vertical)) blocks.push(block);

      let lane = start;
      for (let guard = 0; guard <= blocks.length; guard++) {
        const hit = blocks.find(
          (block) =>
            block.alongLo < spanHi &&
            spanLo < block.alongHi &&
            lane > block.acrossLo - CHANNEL_CLEAR &&
            lane < block.acrossHi + CHANNEL_CLEAR,
        );
        if (!hit) return lane;
        lane = before ? hit.acrossLo - CHANNEL_CLEAR : hit.acrossHi + CHANNEL_CLEAR;
      }
      return null;
    };

    /**
     * The U: leave both nodes by the *same* side and join in a channel beyond
     * them both. Reached when every L and Z ploughs through a container the flow
     * has no business in — the tier-3 turns pay for the tier-0 defect cleared.
     *
     * Three lanes, nearest first. The first is derived from the obstacles the
     * run must clear (`laneBeyond`), so the turn happens exactly as late as §4h
     * requires — an earlier fixed 24px guess cleared `logical`'s Reporting layer
     * by five pixels of luck. The second also clears parallel runs, so this
     * lane's label cannot land under a stranger's flow (§4j). The third is
     * outside the drawing, for when both run out of canvas.
     *
     * The run-clear lane is added, never substituted: substituting moved five
     * `slide` drawings onto container names, since a lane clearing every
     * parallel run can be far out and folded layouts reflow around it. Added it
     * costs nothing — longer, so it sorts after the lane it would replace.
     *
     * All are 2-turn routes, sorting among the Ls rather than behind the Zs. A
     * clean L still wins; the ranking only decides what to try.
     */
    const channelU = (
      a: Point,
      b: Point,
      side: Side,
      ends: ReturnType<typeof inspector.endsOf>,
      edge: SceneEdge,
    ): Point[][] => {
      const vertical = !horizontalSide(side);
      const near = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const far = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      const before = side === "north" || side === "west";
      const spanLo = vertical ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const spanHi = vertical ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      const start = before ? near - CHANNEL_STEP : far + CHANNEL_STEP;
      const derived = laneBeyond(spanLo, spanHi, start, vertical, before, ends, edge, false);
      const clear = laneBeyond(spanLo, spanHi, start, vertical, before, ends, edge, true);
      const outside = before
        ? (vertical ? contentTop : contentLeft) - CHANNEL_MARGIN
        : (vertical ? contentBottom : contentRight) + CHANNEL_MARGIN;
      const limit = vertical ? scene.height : scene.width;
      const lanes = [derived, clear, outside].filter(
        (lane, index, all): lane is number => lane !== null && all.indexOf(lane) === index,
      );
      return lanes
        .filter((lane) => (before ? lane >= 2 && lane < near : lane <= limit - 2 && lane > far))
        .map((lane) =>
          vertical
            ? [a, { x: a.x, y: lane }, { x: b.x, y: lane }, b]
            : [a, { x: lane, y: a.y }, { x: lane, y: b.y }, b],
        );
    };

    /**
     * Is this the shape `channelU` builds? Four points whose two terminal legs
     * are parallel and both set off to the *same* side of the lane that joins
     * them. Recognised from geometry rather than tagged at construction so the
     * squaring pass, which rebuilds the points, cannot lose the label.
     */
    const isChannelU = (pts: Point[]): boolean => {
      if (pts.length !== 4) return false;
      const firstVertical = Math.abs(pts[0].x - pts[1].x) < ORTHOGONAL_EPSILON;
      const lastVertical = Math.abs(pts[2].x - pts[3].x) < ORTHOGONAL_EPSILON;
      if (firstVertical !== lastVertical) return false;
      const lane = firstVertical ? pts[1].y : pts[1].x;
      const fromA = lane - (firstVertical ? pts[0].y : pts[0].x);
      const fromB = lane - (firstVertical ? pts[3].y : pts[3].x);
      return fromA * fromB > 0;
    };

    /** Every straight run, L, Z or same-side U joining these two seats. */
    const shapesFor = (
      a: Point,
      aSide: Side,
      b: Point,
      bSide: Side,
      ends: ReturnType<typeof inspector.endsOf>,
      edge: SceneEdge,
    ): Point[][] => {
      const aH = horizontalSide(aSide);
      const bH = horizontalSide(bSide);
      if (aH !== bH) return [[a, aH ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, b]];
      if (outward(aSide) === outward(bSide)) return channelU(a, b, aSide, ends, edge);
      if (aH)
        return [
          (a.x + b.x) / 2,
          Math.min(a.x, b.x) + CHANNEL_INSET,
          Math.max(a.x, b.x) - CHANNEL_INSET,
        ].map((mid) => [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]);
      return [
        (a.y + b.y) / 2,
        Math.min(a.y, b.y) + CHANNEL_INSET,
        Math.max(a.y, b.y) - CHANNEL_INSET,
      ].map((mid) => [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]);
    };

    /** Candidate routes for one edge, cheapest-looking first, de-duplicated. */
    const routeCache = new Map<string, Point[][]>();
    const routesFor = (edge: SceneEdge): Point[][] => {
      // Keyed on the current route *and* the generation. The endpoints alone
      // were enough while candidates depended only on the two nodes; a channel
      // lane now clears the runs already in the drawing (§4j), so an accepted
      // move elsewhere can change what this edge's candidates are.
      const cacheKey = `${generation}|${edge.id}|${edge.pts[0].x},${edge.pts[0].y}|${edge.pts[edge.pts.length - 1].x},${edge.pts[edge.pts.length - 1].y}`;
      const cached = routeCache.get(cacheKey);
      if (cached) return cached;
      const ends = inspector.endsOf(edge.pts);
      if (!ends[0] || !ends[1] || ends[0].node === ends[1].node) return [];
      const out: Point[][] = [];
      const seen = new Set<string>();
      for (const aSide of SIDES)
        for (const bSide of SIDES)
          for (const aOff of seatOffsetsFor(ends[0].node, aSide))
            for (const bOff of seatOffsetsFor(ends[1].node, bSide))
              for (const raw of shapesFor(
                seatOn(ends[0].node, aSide, aOff),
                aSide,
                seatOn(ends[1].node, bSide, bOff),
                bSide,
                ends,
                edge,
              )) {
                const pts = raw.filter(
                  (p, index) =>
                    index === 0 ||
                    Math.abs(p.x - raw[index - 1].x) >= ORTHOGONAL_EPSILON ||
                    Math.abs(p.y - raw[index - 1].y) >= ORTHOGONAL_EPSILON,
                );
                if (pts.length < 2) continue;
                const key = pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(pts);
              }
      // Fewest turns, then shortest — the maintainer's ranking, used only to
      // decide which candidates to *try* first. Acceptance is the ladder's.
      // Square every candidate *before* scoring it. Applying orthogonality after
      // acceptance means the ladder judged one polyline and the drawing got a
      // different one — the same "validated is not what ships" mistake this pass
      // was moved to the end of the pipeline to avoid, in miniature.
      const squared = out.map((pts) => {
        const probe = { ...edge, pts: pts.map((p) => ({ ...p })) } as SceneEdge;
        enforceOrthogonal(probe);
        return probe.pts;
      });
      squared.sort((p, q) => p.length - q.length || sharedPathLength(p) - sharedPathLength(q));
      routeCache.set(cacheKey, squared);
      return squared;
    };

    const rank = (edge: SceneEdge) => Number.parseInt(edge.id.slice(1), 10) || 0;
    const ordered = [...scene.edges].sort((a, b) => rank(a) - rank(b));

    /** Flows sharing a node with this one — the ones a joint move can help. */
    const neighboursOf = (edge: SceneEdge): SceneEdge[] => {
      const mine = inspector.endsOf(edge.pts).map((end) => end?.node);
      return ordered.filter((other) => {
        if (other === edge || other.pts.length < 2) return false;
        return inspector.endsOf(other.pts).some((end) => end && mine.includes(end.node));
      });
    };

    /**
     * The unmoved profile of a group, memoised until some edge moves.
     *
     * `local(ids, new Map())` is a pure function of current geometry, which
     * changes only when a candidate is accepted — recomputing it per rejected
     * candidate (up to 144 per edge per round, plus twice in the driver loop)
     * was over half of all `local` calls and ~20% of a corpus build. Any
     * accepted move bumps the generation counter, since `before` depends on
     * every edge in the scene, not only those in `ids`.
     *
     * Declared above `parallelRunBlocks`, which invalidates on the same counter.
     */
    const beforeCache = new Map<string, Profile>();
    const soloCache = new Map<string, Profile>();
    const cached = (
      store: Map<string, Profile>,
      ids: Set<string>,
      make: () => Profile,
    ): Profile => {
      const key = `${generation}|${[...ids].sort().join(",")}`;
      const hit = store.get(key);
      if (hit) return hit;
      const made = make();
      store.set(key, made);
      return made;
    };
    const profileNow = (ids: Set<string>): Profile =>
      cached(beforeCache, ids, () => inspector.local(ids, new Map()));

    /**
     * Does this candidate gain a tier-0 defect *on its own* — a run put through
     * a box, a container or a title? `ladderVerdict` rejects any tier-0 gain
     * outright, so answering yes here settles the candidate without the
     * pairwise phase, which costs every edge in the drawing.
     */
    const selfWrecks = (ids: Set<string>, overrides: Map<string, Point[]>): boolean => {
      const was = cached(soloCache, ids, () => inspector.local(ids, new Map(), true));
      for (const [key, tier] of inspector.local(ids, overrides, true))
        if (tier === 0 && !was.has(key)) return true;
      return false;
    };

    /**
     * Defects a route would leave behind, counted per tier — the tie-break
     * between two routes the ladder has *both* already accepted.
     *
     * This is a count, which §"sets, not counts" forbids — but forbids for a
     * different question. That rule guards before-vs-after comparison, where a
     * total cannot see a defect *move*. Here every candidate has already been
     * through `ladderVerdict` against the same `before`, so none of them gains
     * anything at the tier it pays at; what is left is "which of these
     * acceptable drawings is least damaged", and for that a per-tier count is
     * the honest measure.
     */
    const damage = (profile: Profile): number[] => {
      const tiers = [0, 0, 0, 0, 0];
      for (const tier of profile.values()) tiers[tier]++;
      return tiers;
    };
    /** Lexicographic by tier: one fewer tier-0 defect beats any number of tier-4 ones. */
    const lessDamaged = (a: number[], b: number[]): boolean => {
      for (let tier = 0; tier < 5; tier++) if (a[tier] !== b[tier]) return a[tier] < b[tier];
      return false;
    };

    /** The ladder's verdict on a move, and what the drawing would look like after it. */
    const weigh = (group: SceneEdge[], overrides: Map<string, Point[]>) => {
      const ids = new Set(group.map((edge) => edge.id));
      if (selfWrecks(ids, overrides)) return null;
      const after = inspector.local(ids, overrides);
      if (ladderVerdict(profileNow(ids), after) < 0) return null;
      return { after, damage: damage(after) };
    };

    const tryMove = (group: SceneEdge[], overrides: Map<string, Point[]>) => {
      const ids = new Set(group.map((edge) => edge.id));
      if (selfWrecks(ids, overrides)) return false;
      const before = profileNow(ids);
      const after = inspector.local(ids, overrides);
      const verdict = ladderVerdict(before, after);
      if (verdict < 0) return false;
      // What the repair bought, for the renderer's label audit (§4d).
      scene.repairTier = Math.min(scene.repairTier ?? 5, verdict);
      for (const edge of group) {
        const route = overrides.get(edge.id);
        if (!route) continue;
        // A channel U leaves both nodes by the same side and meets in a lane
        // beyond them, so both terminals necessarily set off away from their
        // counterpart. That is the shape working, not a wrap-around to chase,
        // and §11 already exempts flows routed through a channel for exactly
        // this reason — `route-detour` marks its own the same way.
        //
        // Re-decided on every commit, never merely set: a flow routed as a U in
        // one round and re-routed to something else in the next would otherwise
        // keep an exemption its final shape has not earned, and quietly drop out
        // of the `attachAway` count. Flows `route-detour` marked keep their flag
        // whatever this pass does — the channel they were sent through is not
        // this pass's to revoke.
        if (!preRouted.has(edge.id)) {
          edge.detour = isChannelU(route);
        }
      }
      for (const edge of group) {
        const pts = overrides.get(edge.id);
        if (pts) {
          edge.pts = pts.map((p) => ({ ...p }));
          inspector.forget(edge.id);
        }
      }
      generation++;
      beforeCache.clear();
      soloCache.clear();
      return true;
    };

    // Iterate to a fixpoint: a move can unblock another, and the ladder makes
    // every accepted step a strict improvement, so this terminates.
    for (let round = 0; round < 3; round++) {
      let changed = false;
      for (const edge of ordered) {
        if (edge.pts.length < 2) continue;
        const ids = new Set([edge.id]);
        if (profileNow(ids).size === 0) continue;

        // Single move first — cheapest, and most defects yield to it.
        //
        // The *best* accepted candidate wins, not the first. Taking the first
        // meant the ranking (fewest turns, then shortest) silently decided
        // outcomes the ladder was supposed to own: a 1-turn L that clears a
        // struck title beat a 2-turn U that clears the title *and* the run
        // through a container, purely because it was tried earlier. Both are
        // allowed; only one leaves the drawing repaired. The order still
        // decides what to try, and still breaks ties — `lessDamaged` is
        // strict, so an earlier candidate keeps the win unless a later one is
        // genuinely less damaged.
        let moved = false;
        let bestRoute: Point[] | null = null;
        let bestDamage: number[] | null = null;
        for (const pts of routesFor(edge)) {
          const verdict = weigh([edge], new Map([[edge.id, pts]]));
          if (!verdict) continue;
          if (!bestDamage || lessDamaged(verdict.damage, bestDamage)) {
            bestDamage = verdict.damage;
            bestRoute = pts;
          }
          // A route with nothing left to repair cannot be beaten, so stop there.
          // Short of that, keep looking: stopping at the first route that merely
          // destroys no *information* left avoidable damage below tier 0 on the
          // table, and the corpus paid for it — a flow would take the first
          // clean shape it was offered and carry a wrap-around departure or a
          // cramped terminal that the next candidate along did not have.
          if (bestDamage.every((count) => count === 0)) break;
        }
        if (bestRoute && tryMove([edge], new Map([[edge.id, bestRoute]]))) {
          moved = true;
        }
        if (moved) {
          changed = true;
          continue;
        }

        // Joint move: this flow plus one it shares a node with. Bounded to the
        // best few routes each, since the pair space is quadratic.
        // Joint moves are quadratic, so they are earned, not automatic: only a
        // Tier 0, 1 or 2 defect justifies the search. A weave costs the reader
        // time, not meaning, and is not worth pairing the whole neighbourhood over.
        const severest = Math.min(...[...profileNow(ids).values()]);
        if (severest > 2) continue;
        const mineTop = routesFor(edge).slice(0, 8);
        outer: for (const partner of neighboursOf(edge).slice(0, 4)) {
          const theirsTop = routesFor(partner).slice(0, 8);
          for (const mine of mineTop)
            for (const theirs of theirsTop) {
              const overrides = new Map([
                [edge.id, mine],
                [partner.id, theirs],
              ]);
              if (tryMove([edge, partner], overrides)) {
                changed = true;
                moved = true;
                break outer;
              }
            }
        }
      }
      if (!changed) break;
    }
  }

  for (const edge of scene.edges) if (edge.pts.length >= 2) enforceOrthogonal(edge);
}
