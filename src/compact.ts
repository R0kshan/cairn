/**
 * Stage 4b: squeezes horizontal bands carrying nothing but vertical edge
 * segments. elk sizes a drawing for the routes it planned, so once
 * `route-detour.ts` pulls a wrap-around flow out of the margin — or elk
 * simply reserves a corridor it routes around — the freed band stays as dead
 * height nobody reclaims. Runs on every disposition, since elk leaves spare
 * bands either way.
 *
 * Only bands where nothing sits are removed: a node, a label, or a
 * horizontal segment anywhere across the width pins its band — so a
 * container always pins the band its children occupy (no box is ever
 * distorted), every pair of boxes keeps a positive gap (zero-overlap stays
 * zero-overlap), and only vertical segments span a removed band, simply
 * getting shorter.
 *
 * Deterministic: integer shifts from existing coordinates, through a
 * monotone piecewise map.
 *
 * `compactHorizontal` at the foot of this file is the same idea on the other
 * axis, with one rule relaxed — read its header before changing either.
 *
 * The canvas is this module's other job: `fitCanvas` grows it to hold whatever
 * the passes above ended up drawing (INVARIANTS §18). Same subject, opposite
 * direction — one reclaims height the drawing does not use, the other buys the
 * width and height it does.
 */

import type { Scene } from "./scene-layout.ts";
import type { TitleBox } from "./geometry.ts";

/** Vertical breathing room kept where a band is removed. Matches lane spacing. */
const KEEP_GAP = 14;
/**
 * The horizontal equivalent, and deliberately wider: elk leaves exactly this
 * either side of a centred edge label, so a layer gap already sized to its label
 * is left byte-identical and only the gaps padded beyond it are trimmed.
 */
const COLUMN_GAP = 20;
/**
 * And a coarser floor than the vertical pass uses. Labels are re-seated *after*
 * compaction, so a column band is pinned at where its label sat, not where it
 * will sit; trimming only bands with real fat in them keeps that approximation
 * from costing a seat for a handful of pixels.
 */
const COLUMN_MIN_SAVING = 24;
/**
 * Cap for the margin outside the outermost geometry. elk's root padding is
 * top=22/bottom=10, so a real margin is never trimmed — but a frame elk sized
 * for a route that no longer runs there is.
 */
const EDGE_MARGIN = 22;
/** Don't bother rewriting coordinates to claw back less than this. */
const MIN_SAVING = 4;

interface Cut {
  from: number;
  to: number;
  save: number;
}

/** Removes empty horizontal bands from the scene to reduce vertical whitespace. */
export function compactVertical(scene: Scene): void {
  const pinned: { top: number; bottom: number }[] = [];
  for (const node of scene.nodes) pinned.push({ top: node.y, bottom: node.y + node.height });
  for (const edge of scene.edges) {
    for (const label of edge.labels) pinned.push({ top: label.y, bottom: label.y + label.height });
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const pointA = edge.pts[index];
      const pointB = edge.pts[index + 1];
      if (Math.abs(pointA.y - pointB.y) < 0.5 && Math.abs(pointA.x - pointB.x) >= 0.5)
        pinned.push({ top: pointA.y - 1, bottom: pointA.y + 1 });
    }
    // An edge that is a single vertical run still pins its endpoints, which sit
    // on a node border or an arrow tip.
    if (edge.pts.length) {
      const first = edge.pts[0];
      const last = edge.pts[edge.pts.length - 1];
      pinned.push({ top: first.y - 1, bottom: first.y + 1 });
      pinned.push({ top: last.y - 1, bottom: last.y + 1 });
    }
  }
  // Space some earlier pass opened deliberately — an author's `offset:` — which
  // is indistinguishable from dead height by measurement alone.
  for (const band of scene.pinnedBands ?? []) pinned.push({ ...band });
  if (!pinned.length) return;

  pinned.sort((bandA, bandB) => bandA.top - bandB.top || bandA.bottom - bandB.bottom);
  const merged: { top: number; bottom: number }[] = [];
  for (const band of pinned) {
    const last = merged[merged.length - 1];
    if (last && band.top <= last.bottom) last.bottom = Math.max(last.bottom, band.bottom);
    else merged.push({ ...band });
  }

  const cuts: Cut[] = [];
  const addCut = (from: number, to: number, keep: number) => {
    const save = Math.round(to - from - keep);
    if (save >= MIN_SAVING) cuts.push({ from, to, save });
  };
  addCut(0, merged[0].top, EDGE_MARGIN);
  for (let index = 0; index + 1 < merged.length; index++)
    addCut(merged[index].bottom, merged[index + 1].top, KEEP_GAP);

  const heightBefore = merged[merged.length - 1].bottom;
  const bottomMargin = Math.min(scene.height - heightBefore, EDGE_MARGIN);
  // Nothing to reclaim inside the drawing and the frame already fits it.
  if (!cuts.length && scene.height - heightBefore <= EDGE_MARGIN) return;

  // Monotone: geometry above a cut holds still, geometry below moves up by the
  // full saving, and anything inside the cut is clamped to its new extent.
  const shiftAt = (y: number): number => {
    let shift = 0;
    for (const cut of cuts) {
      if (y >= cut.to) shift += cut.save;
      else if (y > cut.from) shift += Math.min(y - cut.from, cut.save);
    }
    return shift;
  };

  for (const node of scene.nodes) node.y -= shiftAt(node.y);
  for (const edge of scene.edges) {
    for (const point of edge.pts) point.y -= shiftAt(point.y);
    for (const label of edge.labels) label.y -= shiftAt(label.y);
  }

  // Incremental max, not Math.max(...spread): a spread over every node/point/
  // label in a large diagram can blow the call-stack argument limit.
  let heightAfter = 0;
  for (const node of scene.nodes) heightAfter = Math.max(heightAfter, node.y + node.height);
  for (const edge of scene.edges) {
    for (const point of edge.pts) heightAfter = Math.max(heightAfter, point.y);
    for (const label of edge.labels) heightAfter = Math.max(heightAfter, label.y + label.height);
  }
  scene.height = Math.ceil(heightAfter + bottomMargin);
}

/**
 * Padding kept between the outermost thing drawn and the canvas edge, matching
 * the margin `route-detour` sizes its scenes with.
 */
const CANVAS_MARGIN = 10;

/**
 * Grows the canvas so nothing drawn falls outside it.
 *
 * The scene is sized from the node extents, and `route-detour` resizes it again
 * from the routes it moved — but every pass after that one (re-siding, the route
 * repair, attachment spreading, and the renderer's own label settling) keeps
 * moving routes and labels. A flow pinned to the far side of the rightmost node
 * wraps around it and can end up past the canvas edge, where the viewBox clips
 * it: that is what cost `examples/placement/reading-order` the tail of its
 * right-hand flow.
 *
 * Called twice for that reason — at the end of layout, and again in the renderer
 * once labels have settled, which is the last thing that moves any of this.
 *
 * Grow only. A scene already large enough keeps the size it had, so this is a
 * no-op for every drawing that was not clipped.
 */
export function fitCanvas(scene: Scene): void {
  let maxX = 0;
  let maxY = 0;
  // Incremental max, not Math.max(...spread): a spread over every node, point
  // and label in a large diagram can blow the call-stack argument limit.
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
  scene.width = Math.max(scene.width, Math.ceil(maxX) + CANVAS_MARGIN);
  scene.height = Math.max(scene.height, Math.ceil(maxY) + CANVAS_MARGIN);
}

/**
 * Stage 4b, the other axis: the horizontal twin of `compactVertical` — squeezes vertical bands
 * (columns) carrying nothing but horizontal edge segments. Same dead space, the
 * other axis: elk sizes every layer gap for the widest edge label in it and
 * starts the next layer past the *box* that ends furthest right, so a narrow
 * label in a wide gap is left with bare run either side of itself and a
 * container reaching past its neighbours pushes the following layer out by its
 * own overhang. Both show up as a flow far longer than the label it carries.
 *
 * One rule differs from the vertical pass: a container does **not** pin the
 * columns its children occupy — only its two borders and its title do. A cut
 * strictly inside a container narrows it, which is the point, since the dead
 * columns sit inside the zones rather than between them. Children still move
 * through the same monotone map, so every gap stays positive and no box ends up
 * narrower than what it holds.
 *
 * Runs dead last among the geometry passes, where its twin runs mid-pipeline:
 * everything between the two re-routes, and a column squeezed before them is
 * judged on geometry they go on to replace.
 *
 * Deterministic: integer shifts from existing coordinates, byte-identical no-op
 * when nothing qualifies.
 */
export function compactHorizontal(scene: Scene, titleBoxes: readonly TitleBox[]): void {
  const pinned: { lo: number; hi: number }[] = [];
  for (const node of scene.nodes) {
    if (node.container) {
      // Borders only — a cut may not cross one, or a child would land outside.
      pinned.push({ lo: node.x - 1, hi: node.x + 1 });
      pinned.push({ lo: node.x + node.width - 1, hi: node.x + node.width + 1 });
    } else pinned.push({ lo: node.x, hi: node.x + node.width });
  }
  // Container titles overflow their box and are drawn under the flows.
  for (const title of titleBoxes) pinned.push({ lo: title.x, hi: title.x + title.width });
  for (const edge of scene.edges) {
    for (const label of edge.labels) pinned.push({ lo: label.x, hi: label.x + label.width });
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const pointA = edge.pts[index];
      const pointB = edge.pts[index + 1];
      if (Math.abs(pointA.x - pointB.x) < 0.5 && Math.abs(pointA.y - pointB.y) >= 0.5)
        pinned.push({ lo: pointA.x - 1, hi: pointA.x + 1 });
    }
    if (edge.pts.length) {
      const first = edge.pts[0];
      const last = edge.pts[edge.pts.length - 1];
      pinned.push({ lo: first.x - 1, hi: first.x + 1 });
      pinned.push({ lo: last.x - 1, hi: last.x + 1 });
    }
  }
  if (!pinned.length) return;

  pinned.sort((spanA, spanB) => spanA.lo - spanB.lo || spanA.hi - spanB.hi);
  const merged: { lo: number; hi: number }[] = [];
  for (const span of pinned) {
    const last = merged[merged.length - 1];
    if (last && span.lo <= last.hi) last.hi = Math.max(last.hi, span.hi);
    else merged.push({ ...span });
  }

  const cuts: Cut[] = [];
  const addCut = (from: number, to: number, keep: number, floor = MIN_SAVING) => {
    const save = Math.round(to - from - keep);
    if (save >= floor) cuts.push({ from, to, save });
  };
  addCut(0, merged[0].lo, EDGE_MARGIN);
  for (let index = 0; index + 1 < merged.length; index++)
    addCut(merged[index].hi, merged[index + 1].lo, COLUMN_GAP, COLUMN_MIN_SAVING);

  const widthBefore = merged[merged.length - 1].hi;
  const rightMargin = Math.min(scene.width - widthBefore, EDGE_MARGIN);
  if (!cuts.length && scene.width - widthBefore <= EDGE_MARGIN) return;

  const shiftAt = (x: number): number => {
    let shift = 0;
    for (const cut of cuts) {
      if (x >= cut.to) shift += cut.save;
      else if (x > cut.from) shift += Math.min(x - cut.from, cut.save);
    }
    return shift;
  };

  for (const node of scene.nodes) {
    const left = node.x - shiftAt(node.x);
    const right = node.x + node.width - shiftAt(node.x + node.width);
    node.x = left;
    node.width = right - left;
  }
  for (const edge of scene.edges) {
    for (const point of edge.pts) point.x -= shiftAt(point.x);
    for (const label of edge.labels) label.x -= shiftAt(label.x);
  }

  // Incremental max, not Math.max(...spread): see `compactVertical`.
  let widthAfter = 0;
  for (const node of scene.nodes) widthAfter = Math.max(widthAfter, node.x + node.width);
  for (const edge of scene.edges) {
    for (const point of edge.pts) widthAfter = Math.max(widthAfter, point.x);
    for (const label of edge.labels) widthAfter = Math.max(widthAfter, label.x + label.width);
  }
  scene.width = Math.ceil(widthAfter + rightMargin);
}
