/**
 * Small 2-D geometry primitives: the `Box` and `Point` types, `boxesOverlap`,
 * and the box-to-polyline distance the renderer uses to keep every flow label
 * attached to the flow it names.
 *
 * Distances are returned **squared**. This is the output path, so the only
 * arithmetic allowed is `+ - * /` (see CLAUDE.md) — and nothing here needs a
 * true length: every use is a comparison, and squaring preserves order.
 */

/** Least distance between two flows attached to the same side of a node. */
export const MIN_ATTACH_GAP = 12;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const boxesOverlap = (boxA: Box, boxB: Box) =>
  !(
    boxA.x + boxA.width <= boxB.x ||
    boxB.x + boxB.width <= boxA.x ||
    boxA.y + boxA.height <= boxB.y ||
    boxB.y + boxB.height <= boxA.y
  );

/**
 * Squared gap between a box and one segment, 0 when they touch. Every segment
 * is orthogonal by the time the renderer sees it (`diagonal` is a must-be-zero
 * invariant), so the two axes are independent and this is exact. On a diagonal
 * it degrades to the distance to the segment's bounding box — an underestimate,
 * which can only understate a defect, never invent one.
 */
export const boxToSegmentSq = (box: Box, a: Point, b: Point) => {
  const dx = Math.max(0, box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - (box.x + box.width));
  const dy = Math.max(0, box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - (box.y + box.height));
  return dx * dx + dy * dy;
};

/**
 * Squared gap between two boxes, 0 when they touch. Used to skip a whole route
 * whose bounding box is already further away than the best distance so far —
 * without that prune, checking a label against every route costs enough to
 * dominate a corpus sweep.
 */
export const boxGapSq = (boxA: Box, boxB: Box) => {
  const dx = Math.max(0, boxA.x - (boxB.x + boxB.width), boxB.x - (boxA.x + boxA.width));
  const dy = Math.max(0, boxA.y - (boxB.y + boxB.height), boxB.y - (boxA.y + boxA.height));
  return dx * dx + dy * dy;
};

export const boundsOf = (points: Point[]): Box => {
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Manhattan length of a polyline: the sum of |Δx| + |Δy| over consecutive points. */
export const pathLength = (points: Point[]) => {
  let length = 0;
  for (let index = 0; index + 1 < points.length; index++)
    length += Math.abs(points[index + 1].x - points[index].x) + Math.abs(points[index + 1].y - points[index].y);
  return length;
};

export const boxToPolylineSq = (box: Box, points: Point[]) => {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index++) {
    const distance = boxToSegmentSq(box, points[index], points[index + 1]);
    if (distance < best) best = distance;
  }
  return best;
};
