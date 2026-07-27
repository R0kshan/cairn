/**
 * Small 2-D geometry primitives: the `Box` and `Point` types plus
 * `boxesOverlap`, used by the renderer's label-overlap detection and settling.
 */

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
