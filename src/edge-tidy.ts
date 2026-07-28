/**
 * Stage 4c: makes every flow readable at its endpoints, whoever routed it.
 *
 * Two defects elk leaves behind, both invisible to the layout but obvious on
 * the page:
 *
 * 1. **Micro-jogs.** elk offsets edges by a pixel or two to keep them apart,
 *    which draws a staircase where the eye expects one line — and sometimes a
 *    segment that is not even orthogonal (10px across, 1px down). Any
 *    deviation up to `SNAP` is noise, not intent: it gets collapsed so a run
 *    is straight until it genuinely turns.
 * 2. **Shared attachment points.** Nothing stops elk from landing an inbound
 *    flow exactly where an outbound one departs, which reads as a single line
 *    through the node. Flows on the same side are pushed to `MIN_ATTACH_GAP`
 *    apart, by the least movement that separates them.
 *
 * Order matters: straightening first, then separation — separation moves a
 * terminal run *rigidly*, so it can never reintroduce the jog straightening
 * just removed.
 *
 * Deterministic: fixed iteration orders, plain arithmetic, and every movement
 * is clamped to the node side it belongs to.
 */

import type { Scene, SceneEdge, SceneNode } from "./scene-layout.ts";

/** Deviations up to this read as routing noise rather than a real turn. */
const SNAP = 6;
/** Least distance between two flows attached to the same side of a node. */
const MIN_ATTACH_GAP = 12;
/** Keep attachments off the corners — squeezed toward `MIN_SIDE_INSET` when a
 *  side has to seat more flows than it comfortably holds. */
const SIDE_INSET = 6;
const MIN_SIDE_INSET = 3;

interface Point {
  x: number;
  y: number;
}

type Side = "north" | "south" | "east" | "west";

const segmentLength = (a: Point, b: Point) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

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
    if (Math.abs(deltaX) < 0.5 || Math.abs(deltaY) < 0.5) continue;
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
        Math.abs(pts[index].x - pts[index - 1].x) < 0.5 &&
        Math.abs(pts[index + 1].x - pts[index].x) < 0.5;
      const straightY =
        Math.abs(pts[index].y - pts[index - 1].y) < 0.5 &&
        Math.abs(pts[index + 1].y - pts[index].y) < 0.5;
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
      if (length > SNAP) continue;
      if (skipped.has(index)) continue;
      const hasBefore = index - 1 >= 0;
      const hasAfter = index + 2 < pts.length;
      if (!hasBefore && !hasAfter) continue;
      const beforeLength = hasBefore ? segmentLength(pts[index - 1], pts[index]) : -1;
      const afterLength = hasAfter ? segmentLength(pts[index + 1], pts[index + 2]) : -1;
      const anchors = (beforeLength >= afterLength
        ? [hasBefore ? pts[index - 1] : null, hasAfter ? pts[index + 2] : null]
        : [hasAfter ? pts[index + 2] : null, hasBefore ? pts[index - 1] : null]
      ).filter((point): point is Point => point !== null);
      const vertical = Math.abs(pts[index + 1].x - pts[index].x) < 0.5;
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
    if (withinX && Math.abs(point.y - (node.y + node.height)) < 2)
      return { node, side: "south" };
    if (withinY && Math.abs(point.x - node.x) < 2) return { node, side: "west" };
    if (withinY && Math.abs(point.x - (node.x + node.width)) < 2)
      return { node, side: "east" };
  }
  return null;
}

interface Attachment {
  edge: SceneEdge;
  /** Index of the terminal point, and of the neighbour that follows it inward. */
  terminal: number;
  neighbour: number;
  along: number;
}

export function tidyEdges(scene: Scene): void {
  const leaves = scene.nodes.filter((node) => !node.container);
  if (!leaves.length) return;

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
        if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5)
          horizontal.push({ lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), at: a.y });
        else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5)
          vertical.push({ lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), at: a.x });
      }
    }
    return { horizontal, vertical };
  };
  // Mirrors the two readability metrics exactly: a run must not become
  // collinear with another (touching at all over a shared stretch), nor drift
  // alongside one for long enough to read as a single thick line.
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
      return (gap < 4 && shared > 6) || (gap < 11 && shared > 36);
    });

  // Orthogonality, to a fixpoint: aligning one segment can tilt its
  // neighbour, and a jog left in place (because straightening it would merge
  // two flows) tilts when a separation move shifts one of its ends. A
  // terminal may slide along its side but never leave the border it sits on.
  const enforceOrthogonal = (edge: SceneEdge) => {
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
        if (Math.abs(deltaX) < 0.5 || Math.abs(deltaY) < 0.5) continue;
        const axis: "x" | "y" = Math.abs(deltaX) >= Math.abs(deltaY) ? "y" : "x";
        const movable = (candidate: number) =>
          (candidate !== 0 && candidate !== pts.length - 1) || borderAxis(candidate) !== axis;
        const target = movable(index + 1) ? index + 1 : movable(index) ? index : -1;
        if (target < 0) continue;
        pts[target][axis] = pts[target === index + 1 ? index : index + 1][axis];
        fixed = true;
      }
      if (!fixed) break;
    }
  };

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    const before = edge.pts.map((point) => ({ ...point }));
    const others = runsExcept(edge.id);
    const after = straighten(edge.pts, (vertical, at, from, to) =>
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
        point.x = Math.min(
          Math.max(point.x, node.x + SIDE_INSET),
          node.x + node.width - SIDE_INSET,
        );
      } else {
        point.x = original.x;
        point.y = Math.min(
          Math.max(point.y, node.y + SIDE_INSET),
          node.y + node.height - SIDE_INSET,
        );
      }
    }
    edge.pts = after;
    enforceOrthogonal(edge);
  }

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
    if (members.every((member, index) => index === 0 || member.along - members[index - 1].along >= MIN_ATTACH_GAP))
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

    members.forEach((member, index) => {
      const target = wanted[index];
      if (Math.abs(target - member.along) < 0.01) return;
      const { edge, terminal, neighbour } = member;
      const terminalPoint = edge.pts[terminal];
      const neighbourPoint = edge.pts[neighbour];
      const straightRun =
        vertical
          ? Math.abs(neighbourPoint.y - terminalPoint.y) < 0.5
          : Math.abs(neighbourPoint.x - terminalPoint.x) < 0.5;
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
        if (target < farStart + MIN_SIDE_INSET || target > farStart + farLength - MIN_SIDE_INSET)
          return;
      }
      // Siblings on this side are exempt: they are being spread apart on
      // purpose, and MIN_ATTACH_GAP — not the parallel-run rule — governs how
      // close they may end up. Without this the guard blocks the very
      // separation it is meant to protect.
      const others = runsExcept(...members.map((sibling) => sibling.edge.id));
      const clear = vertical
        ? runIsClear(others.horizontal, target, terminalPoint.x, neighbourPoint.x)
        : runIsClear(others.vertical, target, terminalPoint.y, neighbourPoint.y);
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

  // A separation move can tilt a jog that straightening had to leave in place.
  for (const edge of scene.edges) if (edge.pts.length >= 2) enforceOrthogonal(edge);
}
