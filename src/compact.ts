/**
 * Stage 4b: squeezes the horizontal bands that carry nothing but vertical edge
 * segments. elk sizes a drawing for the routes it planned, so once
 * `route-detour.ts` pulls a wrap-around flow out of the margin — or elk simply
 * reserves a corridor it then routes around — the freed band stays as dead
 * height nobody reclaims. This pass removes it for every disposition, since
 * `page`/`tall` skip the detour pass but still inherit elk's spare bands.
 *
 * Only bands where *nothing* sits are removed: a node (leaf or container), a
 * label, or a horizontal segment anywhere across the width pins its band. That
 * is what makes the pass safe — a container always pins the band its children
 * occupy, so no box is ever distorted, and every pair of boxes keeps a
 * positive vertical gap, so a zero-overlap drawing stays zero-overlap. Only
 * vertical segments span a removed band, and they simply get shorter.
 *
 * Deterministic: integer shifts derived from existing coordinates, applied
 * through a monotone piecewise map.
 */

import type { Scene } from "./scene-layout.ts";

/** Vertical breathing room kept where a band is removed. Matches lane spacing. */
const KEEP_GAP = 14;
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

  const heightAfter = Math.max(
    ...scene.nodes.map((node) => node.y + node.height),
    ...scene.edges.flatMap((edge) => [
      ...edge.pts.map((point) => point.y),
      ...edge.labels.map((label) => label.y + label.height),
    ]),
  );
  scene.height = Math.ceil(heightAfter + bottomMargin);
}
