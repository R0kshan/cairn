/**
 * Post-layout pass fixing elk's wrap-around routing of backward hierarchical
 * edges (issue #26). With `INCLUDE_CHILDREN`, elk routes any right-to-left
 * flow that crosses container boundaries by exiting east of the outermost
 * container and looping around the whole drawing — no layered option changes
 * this (`feedbackEdges`, cycle breaking and thoroughness were all tested and
 * are no-ops for hierarchical edges). This pass detects those detours and
 * reroutes them through a bottom channel: south out of the source, straight
 * across below the content, then north (or west, for left-column targets)
 * into the target. Deterministic: plain arithmetic only, lanes ordered by
 * numeric flow id, and a no-op (byte-identical scene) when nothing qualifies.
 */

import type { Model } from "./models/ast.ts";
import type { Scene, SceneEdge, SceneNode } from "./scene-layout.ts";

const RATIO_THRESHOLD = 1.4;
const MIN_WASTE = 300;
const CHANNEL_GAP = 10;
const RISER_DELTAS = [0, -8, 8, -16, 16, -24, 24];

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

  // A riser is blocked when it would pierce a leaf node anywhere below `top`.
  const riserBlocked = (x: number, top: number): boolean =>
    leafBoxes.some(
      (node) =>
        x >= node.x - 2 && x <= node.x + node.width + 2 && node.y + node.height > top + 1,
    );
  const findRiserX = (node: SceneNode): number | null => {
    const center = centerX(node);
    for (const delta of RISER_DELTAS) {
      const x = center + delta;
      if (x < node.x + 4 || x > node.x + node.width - 4) continue;
      if (!riserBlocked(x, node.y + node.height)) return x;
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

  interface Plan {
    edge: SceneEdge;
    source: SceneNode;
    target: SceneNode;
    exitX: number;
    entry: { kind: "south"; x: number } | { kind: "west"; y: number };
  }
  const plans: Plan[] = [];
  let westCount = 0;
  for (const candidate of candidates) {
    const exitX = findRiserX(candidate.source);
    if (exitX === null) continue;
    const southX = findRiserX(candidate.target);
    if (southX !== null) {
      plans.push({ ...candidate, exitX, entry: { kind: "south", x: southX } });
      continue;
    }
    const entryY = centerY(candidate.target);
    const westX = Math.max(4, contentLeft - 12 - westCount * 8);
    if (!horizontalBlocked(entryY, westX, candidate.target.x, candidate.target)) {
      westCount++;
      plans.push({ ...candidate, exitX, entry: { kind: "west", y: entryY } });
    }
  }
  if (!plans.length) return;

  const rerouted = new Set(plans.map((plan) => plan.edge.id));
  let contentBottom = maxNodeBottom;
  for (const edge of scene.edges) {
    if (rerouted.has(edge.id)) continue;
    for (const point of edge.pts) contentBottom = Math.max(contentBottom, point.y);
    for (const label of edge.labels)
      contentBottom = Math.max(contentBottom, label.y + label.height);
  }

  const maxLabelHeight = Math.max(
    0,
    ...plans.flatMap((plan) => plan.edge.labels.map((label) => label.height)),
  );
  const laneHeight = maxLabelHeight + 14;

  // Lane allocation: non-overlapping x-intervals share a lane (first fit).
  const lanes: { rangeStart: number; rangeEnd: number }[][] = [];
  const allocLane = (intervalStart: number, intervalEnd: number): number => {
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

  let westIndex = 0;
  for (const plan of plans) {
    const { edge, source, target, exitX, entry } = plan;
    const sourceBottom = source.y + source.height;
    const farX =
      entry.kind === "south" ? entry.x : Math.max(4, contentLeft - 12 - westIndex++ * 8);
    const lane = allocLane(exitX, farX);
    const laneY = contentBottom + CHANNEL_GAP + maxLabelHeight + 3 + lane * laneHeight;

    if (entry.kind === "south") {
      const targetBottom = target.y + target.height;
      edge.pts = [
        { x: exitX, y: sourceBottom },
        { x: exitX, y: laneY },
        { x: farX, y: laneY },
        { x: farX, y: targetBottom },
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

    for (const label of edge.labels) {
      if (numbered) {
        if (entry.kind === "south") {
          label.x = entry.x + 6;
          label.y = target.y + target.height + 6;
        } else {
          label.x = target.x - label.width - 6;
          label.y = entry.y - label.height - 6;
        }
        continue;
      }
      const segmentStart = Math.min(exitX, farX);
      const segmentEnd = Math.max(exitX, farX);
      const midpoint = (segmentStart + segmentEnd) / 2 - label.width / 2;
      const clampedX = Math.min(
        Math.max(midpoint, segmentStart + 4),
        segmentEnd - 4 - label.width,
      );
      label.x = clampedX;
      label.y = laneY - label.height - 3;
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
