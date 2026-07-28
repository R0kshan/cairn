/**
 * Post-layout pass fixing elk's wrap-around routing of backward hierarchical
 * edges (issue #26). With `INCLUDE_CHILDREN`, elk routes any right-to-left
 * flow that crosses container boundaries by exiting east of the outermost
 * container and looping around the whole drawing — no layered option changes
 * this (`feedbackEdges`, cycle breaking and thoroughness were all tested and
 * are no-ops for hierarchical edges). This pass detects those detours and
 * reroutes them through a channel: preferably south out of the source into a
 * bottom lane, then north (or west, for left-column targets) into the target;
 * when nodes below block the south exit, symmetrically north out of the
 * source into a top lane, then south into the target's top edge. Container
 * title bands are obstacles for northbound risers. Deterministic: plain
 * arithmetic only, lanes ordered by numeric flow id, and a no-op
 * (byte-identical scene) when nothing qualifies.
 */

import type { Model } from "./models/ast.ts";
import type { Scene, SceneEdge, SceneNode } from "./scene-layout.ts";
import { fontSizes, measure } from "./text-metrics.ts";

const RATIO_THRESHOLD = 1.4;
const MIN_WASTE = 300;
const CHANNEL_GAP = 10;
const LINE_CLEARANCE = 12;
const MIN_PARALLEL_RUN = 40;
const RISER_DELTAS = [0, -8, 8, -16, 16, -24, 24, -32, 32, -40, 40, -48, 48, -56, 56, -64, 64, -72, 72];
// A descent may have to clear the target's own container — its border and its
// title, which overflows the box — so the search reaches well past the node.
const WEST_DESCENT_DELTAS = [-10, -18, -26, -34, -42, -50, -58, -66, -74, -82, -90, -98, -106];
const EAST_DESCENT_DELTAS = [
  10, 14, 18, 22, 26, 30, 34, 42, 50, 58, 66, 74, 82, 90, 98, 106,
];
/** Container titles are drawn under the flows with no halo — never graze them. */
const TITLE_CLEARANCE = 8;
/** Least distance between two flows attached to the same side of a node. */
const MIN_SLOT_GAP = 12;

interface Point {
  x: number;
  y: number;
}

function pathLength(pts: Point[]): number {
  let length = 0;
  for (let index = 1; index < pts.length; index++)
    length +=
      Math.abs(pts[index].x - pts[index - 1].x) + Math.abs(pts[index].y - pts[index - 1].y);
  return length;
}

export function rerouteDetours(scene: Scene, model: Model, numbered: boolean): void {
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const leafBoxes = scene.nodes.filter((node) => !node.container);
  const flowById = new Map(model.flows.map((flow) => [flow.id, flow]));
  const centerX = (node: SceneNode) => node.x + node.width / 2;
  const centerY = (node: SceneNode) => node.y + node.height / 2;

  const candidates: { edge: SceneEdge; source: SceneNode; target: SceneNode }[] = [];
  for (const edge of scene.edges) {
    const flow = flowById.get(edge.id);
    if (!flow || edge.pts.length < 2) continue;
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
  if (!candidates.length) return;
  candidates.sort(
    (candidateA, candidateB) =>
      parseInt(candidateA.edge.id.slice(1), 10) - parseInt(candidateB.edge.id.slice(1), 10),
  );

  const maxNodeBottom = Math.max(...scene.nodes.map((node) => node.y + node.height));
  const contentLeft = Math.min(...scene.nodes.map((node) => node.x));

  // Container title bands (label text at the container's top-left) — obstacles
  // for northbound risers, which would otherwise strike through the title.
  const { cont: containerFontSize } = fontSizes(model.style.font.size);
  const compact = model.style.compact;
  const titleBoxes = scene.nodes
    .filter((node) => node.container)
    .map((node) => {
      const lineCount = node.label.split("\n").length;
      return {
        x: node.x + 4,
        y: node.y,
        width: measure(node.label, containerFontSize).width + 12,
        height: (compact ? 11 : 13) + lineCount * 14,
      };
    });

  // A southbound riser is blocked when it would pierce a leaf node anywhere
  // below `top`; a northbound riser when a leaf node or a container title band
  // sits anywhere above `bottom` in its corridor.
  // Registry of vertical segments already in the drawing. Rerouted risers and
  // descents must keep clear of every other vertical with an overlapping span,
  // so flows sharing a node attach at distinct points along its edge instead
  // of merging at its center (each flow stays individually traceable).
  const INF = 1e9;
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
  for (const node of scene.nodes)
    if (node.container) {
      usedVerticals.push({ x: node.x, top: node.y, bottom: node.y + node.height });
      usedVerticals.push({ x: node.x + node.width, top: node.y, bottom: node.y + node.height });
    }
  // Two risers may pass close if they barely overlap, but running alongside
  // each other for any distance reads as a single line — same rule as for
  // horizontals, applied to the shared vertical extent.
  const verticalConflict = (
    segment: { x: number; top: number; bottom: number },
    x: number,
    top: number,
    bottom: number,
  ): boolean => {
    const shared = Math.min(segment.bottom, bottom) - Math.max(segment.top, top);
    if (shared <= 0) return false;
    const gap = Math.abs(segment.x - x);
    return gap < 7 || (gap < LINE_CLEARANCE && shared > MIN_PARALLEL_RUN);
  };
  const riserConflicts = (x: number, top: number, bottom: number): boolean =>
    usedVerticals.some((segment) => verticalConflict(segment, x, top, bottom));
  const horizontalConflicts = (y: number, left: number, right: number): boolean =>
    usedHorizontals.some(
      (segment) => Math.abs(segment.y - y) < 7 && segment.left < right && left < segment.right,
    );
  // Snapshot of the pre-plan registry — the redistribution pass validates
  // slots against it (plan risers are being repositioned, so they must not
  // count as their own obstacles).
  const baseVerticals = usedVerticals.slice();
  const baseRiserConflicts = (x: number, top: number, bottom: number): boolean =>
    baseVerticals.some((segment) => verticalConflict(segment, x, top, bottom));

  const riserBlockedBelow = (x: number, top: number): boolean =>
    leafBoxes.some(
      (node) =>
        x >= node.x - 2 && x <= node.x + node.width + 2 && node.y + node.height > top + 1,
    );
  const riserBlockedAbove = (x: number, bottom: number): boolean =>
    leafBoxes.some(
      (node) => x >= node.x - 2 && x <= node.x + node.width + 2 && node.y < bottom - 1,
    ) ||
    titleBoxes.some(
      (box) =>
        x >= box.x - TITLE_CLEARANCE &&
        x <= box.x + box.width + TITLE_CLEARANCE &&
        box.y < bottom - 1,
    );
  const findRiserX = (node: SceneNode, side: "south" | "north"): number | null => {
    const center = centerX(node);
    for (const delta of RISER_DELTAS) {
      const x = center + delta;
      if (x < node.x + 4 || x > node.x + node.width - 4) continue;
      if (side === "south") {
        if (riserBlockedBelow(x, node.y + node.height)) continue;
        if (riserConflicts(x, node.y + node.height, INF)) continue;
      } else {
        if (riserBlockedAbove(x, node.y)) continue;
        if (riserConflicts(x, -INF, node.y)) continue;
      }
      return x;
    }
    return null;
  };
  const horizontalBlocked = (y: number, xStart: number, xEnd: number, ignore: SceneNode): boolean =>
    leafBoxes.some(
      (node) =>
        node !== ignore &&
        node.y - 2 <= y &&
        node.y + node.height + 2 >= y &&
        node.x < xEnd &&
        node.x + node.width > xStart,
    );
  // Entry y for a side (east/west) approach: start at the target's center and
  // shift away from existing horizontals on that side. Flows arriving from
  // below prefer the lower half (inbound passes under outbound), flows
  // arriving from above prefer the upper half.
  const ENTRY_Y_DELTAS_DOWN = [0, 6, 12, 18, 24, -6, -12, -18, -24];
  const ENTRY_Y_DELTAS_UP = [0, -6, -12, -18, -24, 6, 12, 18, 24];
  // A container that (geometrically) holds the target may be pierced by its
  // entry segment; crossing through any OTHER container's interior is not
  // acceptable (e.g. a west entry threading between two actors of an
  // unrelated group).
  const containerBoxes = scene.nodes.filter((node) => node.container);
  const crossesForeignContainer = (
    y: number,
    xStart: number,
    xEnd: number,
    target: SceneNode,
  ): boolean =>
    containerBoxes.some(
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
  const findEntryY = (
    target: SceneNode,
    fromBelow: boolean,
    xStart: number,
    xEnd: number,
    descentX: number,
    edgeX: number,
  ): number | null => {
    for (const delta of fromBelow ? ENTRY_Y_DELTAS_DOWN : ENTRY_Y_DELTAS_UP) {
      const y = centerY(target) + delta;
      if (y < target.y + 4 || y > target.y + target.height - 4) continue;
      if (horizontalConflicts(y, xStart, xEnd)) continue;
      if (horizontalBlocked(y, xStart, xEnd, target)) continue;
      if (crossesForeignContainer(y, xStart, xEnd, target)) continue;
      // The descent approaching this entry must not cross a horizontal
      // ATTACHED to the same side of the target (inbound passes under
      // outbound, or over it when arriving from above) — otherwise the two
      // flows intersect right at the node's edge. Horizontals merely passing
      // by are ordinary hopped crossings and don't count.
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

  interface Plan {
    edge: SceneEdge;
    source: SceneNode;
    target: SceneNode;
    exitX: number;
    entry:
      | { kind: "south"; x: number }
      | { kind: "west"; x: number; y: number }
      | { kind: "east"; x: number; y: number }
      | { kind: "north"; x: number }
      | { kind: "westTop"; x: number; y: number }
      | { kind: "eastTop"; x: number; y: number };
  }
  const plans: Plan[] = [];
  let westCount = 0;
  for (const candidate of candidates) {
    const { source, target } = candidate;
    let planned: Plan | null = null;
    const exitX = findRiserX(source, "south");
    if (exitX !== null) {
      const southX = findRiserX(target, "south");
      if (southX !== null) {
        planned = { ...candidate, exitX, entry: { kind: "south", x: southX } };
        usedVerticals.push({ x: exitX, top: source.y + source.height, bottom: INF });
        usedVerticals.push({ x: southX, top: target.y + target.height, bottom: INF });
      } else {
        const westX = Math.max(4, contentLeft - 12 - westCount * 8);
        const westY = findEntryY(target, true, westX, target.x, westX, target.x);
        if (westY !== null) {
          westCount++;
          planned = { ...candidate, exitX, entry: { kind: "west", x: westX, y: westY } };
          usedVerticals.push({ x: exitX, top: source.y + source.height, bottom: INF });
          usedVerticals.push({ x: westX, top: westY, bottom: INF });
          usedHorizontals.push({ y: westY, left: westX, right: target.x });
        } else {
          // Interior target: ascend just right of it and enter its east side
          // (the side facing the source) — the flow drops south immediately
          // instead of wandering across the drawing.
          for (const delta of EAST_DESCENT_DELTAS) {
            const descentX = target.x + target.width + delta;
            const entryY = findEntryY(
              target,
              true,
              target.x + target.width,
              descentX,
              descentX,
              target.x + target.width,
            );
            if (entryY === null) continue;
            if (riserBlockedBelow(descentX, entryY)) continue;
            if (riserConflicts(descentX, entryY, INF)) continue;
            planned = { ...candidate, exitX, entry: { kind: "east", x: descentX, y: entryY } };
            usedVerticals.push({ x: exitX, top: source.y + source.height, bottom: INF });
            usedVerticals.push({ x: descentX, top: entryY, bottom: INF });
            usedHorizontals.push({ y: entryY, left: target.x + target.width, right: descentX });
            break;
          }
          if (!planned) {
            // Last resort: ascend in the gutter just left of the target and
            // enter its west side (bottom-channel mirror of the westTop
            // descent).
            for (const delta of WEST_DESCENT_DELTAS) {
              const descentX = target.x + delta;
              if (descentX < 4) continue;
              const entryY = findEntryY(target, true, descentX, target.x, descentX, target.x);
              if (entryY === null) continue;
              if (riserBlockedBelow(descentX, entryY)) continue;
              if (riserConflicts(descentX, entryY, INF)) continue;
              planned = { ...candidate, exitX, entry: { kind: "west", x: descentX, y: entryY } };
              usedVerticals.push({ x: exitX, top: source.y + source.height, bottom: INF });
              usedVerticals.push({ x: descentX, top: entryY, bottom: INF });
              usedHorizontals.push({ y: entryY, left: descentX, right: target.x });
              break;
            }
          }
        }
      }
    } else {
      // South exit blocked — mirror the route through a top channel instead.
      const exitXNorth = findRiserX(source, "north");
      if (exitXNorth !== null) {
        const entryXNorth = findRiserX(target, "north");
        if (entryXNorth !== null) {
          planned = { ...candidate, exitX: exitXNorth, entry: { kind: "north", x: entryXNorth } };
          usedVerticals.push({ x: exitXNorth, top: -INF, bottom: source.y });
          usedVerticals.push({ x: entryXNorth, top: -INF, bottom: target.y });
        } else {
          // The target's own container title covers its whole top, so the
          // flow comes down beside the node instead. Try the side facing the
          // source first (east — these flows all travel leftward), which
          // avoids running the lane past the target only to hook back.
          for (const delta of EAST_DESCENT_DELTAS) {
            const descentX = target.x + target.width + delta;
            const entryY = findEntryY(
              target,
              false,
              target.x + target.width,
              descentX,
              descentX,
              target.x + target.width,
            );
            if (entryY === null) continue;
            if (riserBlockedAbove(descentX, entryY)) continue;
            if (riserConflicts(descentX, -INF, entryY)) continue;
            planned = {
              ...candidate,
              exitX: exitXNorth,
              entry: { kind: "eastTop", x: descentX, y: entryY },
            };
            usedVerticals.push({ x: exitXNorth, top: -INF, bottom: source.y });
            usedVerticals.push({ x: descentX, top: -INF, bottom: entryY });
            usedHorizontals.push({ y: entryY, left: target.x + target.width, right: descentX });
            break;
          }
          // Otherwise come down on the far side, clearing the container's own
          // border and the title text that overflows it.
          for (const delta of planned ? [] : WEST_DESCENT_DELTAS) {
            const descentX = target.x + delta;
            if (descentX < 4) continue;
            const entryY = findEntryY(target, false, descentX, target.x, descentX, target.x);
            if (entryY === null) continue;
            if (riserBlockedAbove(descentX, entryY)) continue;
            if (riserConflicts(descentX, -INF, entryY)) continue;
            planned = {
              ...candidate,
              exitX: exitXNorth,
              entry: { kind: "westTop", x: descentX, y: entryY },
            };
            usedVerticals.push({ x: exitXNorth, top: -INF, bottom: source.y });
            usedVerticals.push({ x: descentX, top: -INF, bottom: entryY });
            usedHorizontals.push({ y: entryY, left: descentX, right: target.x });
            break;
          }
        }
      }
    }
    // Failed candidates keep elk's route — their verticals stay obstacles.
    if (planned) plans.push(planned);
    else addEdgeVerticals(candidate.edge);
  }
  if (!plans.length) return;

  // Even attachment distribution: when several rerouted flows attach on the
  // same side of a node, spread them evenly across that edge — the gap follows
  // from the number of flows on that side instead of greedy center-first
  // dodging. Slots are assigned left-to-right in current-x order (keeps risers
  // from crossing each other); a slot that hits an obstacle keeps its greedy x.
  {
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
      const topPlan = plan.entry.kind === "north" ||
    plan.entry.kind === "westTop" ||
    plan.entry.kind === "eastTop";
      addAttachment(plan, "exit", plan.source, topPlan ? "north" : "south");
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
    const flowNumber = (attachment: Attachment) =>
      parseInt(attachment.plan.edge.id.slice(1), 10);
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
            ? !riserBlockedBelow(x, node.y + node.height) &&
              !baseRiserConflicts(x, node.y + node.height, INF)
            : !riserBlockedAbove(x, node.y) && !baseRiserConflicts(x, -INF, node.y);
        if (clear) freePositions.push(x);
      }
      if (freePositions.length < members.length) continue;
      // Spreading is only an improvement if the side is wide enough to keep
      // the flows apart. Where a title leaves a narrow strip, evenly spaced
      // slots would sit a few px from each other and read as one line — the
      // greedy positions chosen during planning already clear each other, so
      // keep those and let the crowded-out flow take a side approach instead.
      const usable = freePositions[freePositions.length - 1] - freePositions[0];
      if (usable / (members.length + 1) < MIN_SLOT_GAP) continue;
      // Slot order = travel direction, then reach descending. Flows heading
      // left take the left slots and flows heading right the right ones, so
      // opposite-direction flows diverge immediately. Among flows heading the
      // SAME way the longest reach sits outermost, which makes their channel
      // spans nest instead of interleave — nested spans can be lane-ordered
      // with no crossing at all (see the lane allocation below), interleaved
      // ones cannot.
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
          freePositions[Math.round(((index + 1) * (freePositions.length - 1)) / (members.length + 1))];
        setAttachmentX(member, pick);
      });
    }
  }

  const rerouted = new Set(plans.map((plan) => plan.edge.id));
  // Channels hug the node content. Geometry elk left *outside* that content
  // (its own wrap-around routes and their labels) is deliberately not an
  // anchor — otherwise one stray wrap pushes the whole channel far off the
  // drawing, wasting a band and forcing our flows to cross that wrap. Such
  // geometry instead becomes a blocking band that nudges an individual lane
  // only where their x-spans actually meet.
  const contentBottom = maxNodeBottom;
  const contentTop = Math.min(...scene.nodes.map((node) => node.y));
  // `minOverlap`: how much shared x-span makes this band a real obstacle. A
  // label overlapped at all is a collision; a horizontal segment only reads as
  // a duplicate of our lane when they run alongside each other for a while.
  const blockingBands: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    minOverlap: number;
  }[] = [];
  for (const edge of scene.edges) {
    if (rerouted.has(edge.id)) continue;
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const pointA = edge.pts[index];
      const pointB = edge.pts[index + 1];
      if (Math.abs(pointA.y - pointB.y) < 0.5 && Math.abs(pointA.x - pointB.x) >= 0.5)
        blockingBands.push({
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
      blockingBands.push({
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
    blockingBands.push({
      top: node.y,
      bottom: node.y + node.height,
      left: node.x,
      right: node.x + node.width,
      minOverlap: 0,
    });
  const bandConflicts = (top: number, bottom: number, left: number, right: number): boolean =>
    blockingBands.some(
      (band) =>
        band.top < bottom &&
        top < band.bottom &&
        Math.min(band.right, right) - Math.max(band.left, left) > band.minOverlap,
    );

  const isTop = (plan: Plan) => plan.entry.kind === "north" ||
    plan.entry.kind === "westTop" ||
    plan.entry.kind === "eastTop";
  const bottomPlans = plans.filter((plan) => !isTop(plan));
  const topPlans = plans.filter(isTop);

  // Lane allocation: non-overlapping x-intervals share a lane (first fit).
  const makeAllocator = () => {
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
  };

  // Lanes are handed out innermost span first, so a span that *contains*
  // another always ends up on a deeper lane. Combined with the nesting the
  // slot order produces, a flow's riser can then never cross the lane of a
  // flow it encloses — the crossings that remain are only the ones forced by
  // genuinely interleaved spans. Containment is only a partial order, so this
  // is a topological pass rather than a sort: flows that don't enclose one
  // another keep plain flow-id order and their lanes don't move.
  const spanLeft = (plan: Plan) => Math.min(plan.exitX, plan.entry.x);
  const spanRight = (plan: Plan) => Math.max(plan.exitX, plan.entry.x);
  const enclosedBy = (inner: Plan, outer: Plan) =>
    spanLeft(outer) <= spanLeft(inner) &&
    spanRight(inner) <= spanRight(outer) &&
    spanRight(inner) - spanLeft(inner) < spanRight(outer) - spanLeft(outer);
  const laneIndexOf = new Map<string, number>();
  const assignLanes = (subset: Plan[], alloc: (start: number, end: number) => number) => {
    const remaining = [...subset].sort(
      (planA, planB) =>
        parseInt(planA.edge.id.slice(1), 10) - parseInt(planB.edge.id.slice(1), 10),
    );
    while (remaining.length) {
      const innermost = remaining.findIndex(
        (plan) => !remaining.some((other) => other !== plan && enclosedBy(other, plan)),
      );
      const [plan] = remaining.splice(innermost < 0 ? 0 : innermost, 1);
      laneIndexOf.set(plan.edge.id, alloc(plan.exitX, plan.entry.x));
    }
  };
  assignLanes(bottomPlans, makeAllocator());
  assignLanes(topPlans, makeAllocator());

  // Lane offsets: each lane sits just outside the content it actually spans —
  // anchoring on the drawing's full extent lets a node the lane never passes
  // under (a tall actor group off to one side) push it far out, leaving a band
  // of nothing between the lane and the boxes it serves. Spacing then uses the
  // label heights that lane really carries, and the lane is pushed further out
  // only if it would land on geometry sharing its x-span.
  const laneOffsets = (subset: Plan[], direction: 1 | -1, anchor: number): number[] => {
    const spanAnchor = (left: number, right: number): number => {
      const spanned = scene.nodes.filter(
        (node) => node.x < right && node.x + node.width > left,
      );
      if (!spanned.length) return anchor;
      return direction > 0
        ? Math.max(...spanned.map((node) => node.y + node.height))
        : Math.min(...spanned.map((node) => node.y));
    };
    const byLane = new Map<number, Plan[]>();
    for (const plan of subset) {
      const lane = laneIndexOf.get(plan.edge.id)!;
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
      const left = Math.min(...members.map((plan) => Math.min(plan.exitX, plan.entry.x)));
      const right = Math.max(...members.map((plan) => Math.max(plan.exitX, plan.entry.x)));
      const base = spanAnchor(left, right);
      const ownPosition =
        direction > 0 ? base + CHANNEL_GAP + labelHeight + 3 : base - CHANNEL_GAP;
      // Lanes stay ordered: a deeper lane never rises above a shallower one,
      // which is what keeps enclosing spans outside the ones they enclose.
      let position =
        lane === 0
          ? ownPosition
          : direction > 0
            ? Math.max(ownPosition, positions[lane - 1] + labelHeight + 14)
            : Math.min(ownPosition, positions[lane - 1] - (labelHeights[lane - 1] + 14));
      // The lane and the label band above it must clear elk's leftovers.
      for (let guard = 0; guard < 80; guard++) {
        if (!bandConflicts(position - labelHeight - 3, position + 1, left, right)) break;
        position += direction * 6;
      }
      labelHeights.push(labelHeight);
      positions.push(position);
    }
    return positions;
  };
  const bottomLaneY = laneOffsets(bottomPlans, 1, contentBottom);
  const topLaneY = laneOffsets(topPlans, -1, contentTop);

  const placeLaneLabels = (edge: SceneEdge, exitX: number, farX: number, laneY: number) => {
    for (const label of edge.labels) {
      const segmentStart = Math.min(exitX, farX);
      const segmentEnd = Math.max(exitX, farX);
      const midpoint = (segmentStart + segmentEnd) / 2 - label.width / 2;
      label.x = Math.min(Math.max(midpoint, segmentStart + 4), segmentEnd - 4 - label.width);
      label.y = laneY - label.height - 3;
    }
  };

  for (const plan of plans) {
    const { edge, source, target, exitX, entry } = plan;

    if (entry.kind === "north" || entry.kind === "westTop" || entry.kind === "eastTop") {
      const laneY = topLaneY[laneIndexOf.get(edge.id)!];
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
      if (numbered) {
        for (const label of edge.labels) {
          if (entry.kind === "north") {
            label.x = entry.x + 6;
            label.y = target.y - label.height - 6;
          } else if (entry.kind === "eastTop") {
            label.x = target.x + target.width + 6;
            label.y = entry.y - label.height - 6;
          } else {
            label.x = target.x - label.width - 6;
            label.y = entry.y - label.height - 6;
          }
        }
      } else {
        placeLaneLabels(edge, exitX, entry.x, laneY);
      }
      continue;
    }

    const sourceBottom = source.y + source.height;
    const farX = entry.x;
    const laneY = bottomLaneY[laneIndexOf.get(edge.id)!];

    if (entry.kind === "south") {
      const targetBottom = target.y + target.height;
      edge.pts = [
        { x: exitX, y: sourceBottom },
        { x: exitX, y: laneY },
        { x: farX, y: laneY },
        { x: farX, y: targetBottom },
      ];
    } else if (entry.kind === "east") {
      edge.pts = [
        { x: exitX, y: sourceBottom },
        { x: exitX, y: laneY },
        { x: farX, y: laneY },
        { x: farX, y: entry.y },
        { x: target.x + target.width, y: entry.y },
      ];
    } else {
      edge.pts = [
        { x: exitX, y: sourceBottom },
        { x: exitX, y: laneY },
        { x: farX, y: laneY },
        { x: farX, y: entry.y },
        { x: target.x, y: entry.y },
      ];
    }

    if (numbered) {
      for (const label of edge.labels) {
        if (entry.kind === "south") {
          label.x = entry.x + 6;
          label.y = target.y + target.height + 6;
        } else if (entry.kind === "east") {
          label.x = target.x + target.width + 6;
          label.y = entry.y - label.height - 6;
        } else {
          label.x = target.x - label.width - 6;
          label.y = entry.y - label.height - 6;
        }
      }
    } else {
      placeLaneLabels(edge, exitX, farX, laneY);
    }
  }

  // Top-channel lanes (and their labels) may extend above y=0 — shift the
  // whole scene down so every coordinate stays positive. Guarded on top plans
  // so bottom-only reroutes stay byte-identical.
  let minY = 4;
  if (topPlans.length)
    for (const edge of scene.edges) {
      for (const point of edge.pts) minY = Math.min(minY, point.y);
      for (const label of edge.labels) minY = Math.min(minY, label.y);
    }
  if (minY < 4) {
    const shift = 4 - minY;
    for (const node of scene.nodes) node.y += shift;
    for (const edge of scene.edges) {
      for (const point of edge.pts) point.y += shift;
      for (const label of edge.labels) label.y += shift;
    }
  }

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
