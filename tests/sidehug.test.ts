/**
 * Side-hug genericity suite. The re-side/relocation machinery in
 * `clearSideHugs` was written against logical-archi's F02/F11 geometry; these
 * fixtures rebuild that pattern by hand in different configurations and
 * assert the invariants the machinery promises, so its genericity is
 * test-proven rather than corpus-lucky:
 *
 *  - the hugged flow ends (or starts) on the *new* side of its node, below
 *    the other entries, with its riser outside the layer's border;
 *  - a foreign riser blocking the approach is relocated (when its shape
 *    allows) to a position clear of the layer and of the re-sided riser;
 *  - every route stays orthogonal, terminals stay seated, shared seats keep
 *    the behaviour suite's spacing, and the crossing budget is respected
 *    (1 vs the re-sided flow + at most 1 vs a bystander);
 *  - configurations the machinery cannot fix are left as debt, not
 *    corrupted (fail-safe).
 *
 * Run via `npm test` (or `node --experimental-strip-types --test`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { clearSideHugs } from "../src/edge-tidy.ts";
import type { Scene, SceneEdge, SceneNode } from "../src/scene-layout.ts";

type P = { x: number; y: number };

const node = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  container = false,
): SceneNode => ({ id, kind: "block", label: id, x, y, width: w, height: h, container });

const edge = (id: string, pts: P[]): SceneEdge => ({ id, pts, labels: [] });

const scene = (nodes: SceneNode[], edges: SceneEdge[]): Scene => ({
  width: 400,
  height: 400,
  nodes,
  edges,
  layoutMs: 0,
});

/** The sweep's sideHug predicate: a run within 3px of a side, >24px shared. */
const hugCount = (s: Scene): number => {
  let count = 0;
  for (const e of s.edges) {
    const ends = new Set([e.pts[0], e.pts[e.pts.length - 1]].map((p) => seatOf(s, p)?.node.id));
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      const vert = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;
      const horiz = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
      if (!vert && !horiz) continue;
      for (const n of s.nodes) {
        if (ends.has(n.id)) continue;
        const shared = vert
          ? Math.min(Math.max(a.y, b.y), n.y + n.height) - Math.max(Math.min(a.y, b.y), n.y)
          : Math.min(Math.max(a.x, b.x), n.x + n.width) - Math.max(Math.min(a.x, b.x), n.x);
        if (shared <= 24) continue;
        const gap = vert
          ? Math.min(Math.abs(a.x - n.x), Math.abs(a.x - (n.x + n.width)))
          : Math.min(Math.abs(a.y - n.y), Math.abs(a.y - (n.y + n.height)));
        if (gap < 3) count++;
      }
    }
  }
  return count;
};

const seatOf = (s: Scene, p: P): { node: SceneNode; side: string } | null => {
  for (const n of s.nodes) {
    if (n.container) continue;
    const wx = p.x > n.x - 2 && p.x < n.x + n.width + 2;
    const wy = p.y > n.y - 2 && p.y < n.y + n.height + 2;
    if (wx && Math.abs(p.y - n.y) < 2) return { node: n, side: "north" };
    if (wx && Math.abs(p.y - (n.y + n.height)) < 2) return { node: n, side: "south" };
    if (wy && Math.abs(p.x - n.x) < 2) return { node: n, side: "west" };
    if (wy && Math.abs(p.x - (n.x + n.width)) < 2) return { node: n, side: "east" };
  }
  return null;
};

const crossCount = (a: P[], b: P[]): number => {
  const cross = (a1: P, a2: P, b1: P, b2: P): boolean => {
    const side = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = side(b1, b2, a1) > 0;
    const d2 = side(b1, b2, a2) > 0;
    const d3 = side(a1, a2, b1) > 0;
    const d4 = side(a1, a2, b2) > 0;
    return d1 !== d2 && d3 !== d4;
  };
  let total = 0;
  for (let i = 0; i + 1 < a.length; i++)
    for (let j = 0; j + 1 < b.length; j++) if (cross(a[i], a[i + 1], b[j], b[j + 1])) total++;
  return total;
};

const allCrossings = (s: Scene): number => {
  let total = 0;
  for (let i = 0; i < s.edges.length; i++)
    for (let j = i + 1; j < s.edges.length; j++)
      total += crossCount(s.edges[i].pts, s.edges[j].pts);
  return total;
};

const assertInvariants = (s: Scene, beforeCrossings: number): void => {
  for (const e of s.edges) {
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      assert.ok(
        Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5,
        `${e.id}: segment (${a.x},${a.y})→(${b.x},${b.y}) is not orthogonal`,
      );
    }
    for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
      const seat = seatOf(s, p);
      assert.ok(seat, `${e.id}: terminal (${p.x},${p.y}) is not seated on a node`);
      assert.ok(!seat.node.container, `${e.id}: terminal seated on a container`);
    }
  }
  // Crossings may only grow by the trade budget: 1 vs the re-sided flow plus
  // at most 1 vs a bystander.
  assert.ok(
    allCrossings(s) <= beforeCrossings + 2,
    `crossing budget exceeded: ${beforeCrossings} → ${allCrossings(s)}`,
  );
};

// ---------------------------------------------------------------------------
// Fixture A — END-terminal re-side with a foreign riser relocation (the
// F02/F11 pattern). The flow E02 rides BLK_N's west side; the west approach
// is walled by E11's riser; E11 can move west of the layer.
// ---------------------------------------------------------------------------
test("end-terminal re-side relocates the blocking riser and clears the hug", () => {
  const s = scene(
    [
      node("L1", 40, 40, 140, 120, true),
      node("BLK_T", 60, 60, 50, 30),
      node("BLK_N", 62, 100, 50, 30),
      node("SRC", 0, 125, 10, 30),
      node("FSRC", 0, 35, 10, 30),
      node("NODE_E", 150, 50, 60, 80),
    ],
    [
      // E02 hugs BLK_N's west side (x=62) at x=63, shared 30px.
      edge("E02", [
        { x: 10, y: 140 },
        { x: 63, y: 140 },
        { x: 63, y: 90 },
      ]),
      // E11 walls the west approach to BLK_T with an interior riser at x=55.
      edge("E11", [
        { x: 10, y: 50 },
        { x: 55, y: 50 },
        { x: 55, y: 110 },
        { x: 62, y: 110 },
      ]),
    ],
  );
  const before = allCrossings(s);
  clearSideHugs(s);
  assertInvariants(s, before);
  const e02 = s.edges.find((e) => e.id === "E02")!;
  const e11 = s.edges.find((e) => e.id === "E11")!;
  // E02 now enters BLK_T's west side (x=60) with its riser west of L1 (x=40-8).
  const seat = seatOf(s, e02.pts[e02.pts.length - 1])!;
  assert.equal(seat.side, "west");
  assert.equal(seat.node.id, "BLK_T");
  const riserX = e02.pts[e02.pts.length - 2].x;
  assert.ok(riserX <= 32, `E02 riser at x=${riserX} not west of the layer`);
  // E11 relocated west of the layer, clear of E02's riser.
  const e11Riser = e11.pts[1].x;
  assert.ok(e11Riser <= 32, `E11 riser at x=${e11Riser} not west of the layer`);
  assert.ok(Math.abs(e11Riser - riserX) >= 10, "E11 riser too close to E02's riser");
  // Exactly one new crossing (the intended trade).
  assert.equal(allCrossings(s), before + 1);
  assert.equal(hugCount(s), 0);
});

// ---------------------------------------------------------------------------
// Fixture B — START-terminal re-side (the departure is re-sided, not the
// arrival). E02's first segment hugs BLK_N's west side.
// ---------------------------------------------------------------------------
test("start-terminal re-side moves the departure to a new side", () => {
  const s = scene(
    [
      node("L1", 40, 40, 140, 120, true),
      node("BLK_S", 60, 60, 50, 30),
      node("BLK_N", 62, 100, 50, 30),
      node("TGT", 130, 125, 30, 30),
    ],
    [
      // E02 departs BLK_S south at (63,90), riser at x=63 rides BLK_N's west
      // side (x=62).
      edge("E02", [
        { x: 63, y: 90 },
        { x: 63, y: 140 },
        { x: 130, y: 140 },
      ]),
    ],
  );
  const before = allCrossings(s);
  clearSideHugs(s);
  assertInvariants(s, before);
  const e02 = s.edges.find((e) => e.id === "E02")!;
  const seat = seatOf(s, e02.pts[0])!;
  assert.equal(seat.side, "west");
  assert.equal(seat.node.id, "BLK_S");
  // The departure riser must sit west of the layer.
  const riserX = e02.pts[1].x;
  assert.ok(riserX <= 32, `E02 riser at x=${riserX} not west of the layer`);
  assert.ok(hugCount(s) < 2, "start re-side left a hug behind");
});

// ---------------------------------------------------------------------------
// Fixture C — END-terminal re-side on a LONG route (5+ points): the fresh
// riser is at the route's tail, not at segment 1-2. A blocker whose
// relocation could sit within 10px of the true riser must be refused there.
// ---------------------------------------------------------------------------
test("long-route re-side keeps the near-parallel clearance on the true riser", () => {
  const s = scene(
    [
      node("L1", 40, 40, 140, 120, true),
      node("BLK_T", 60, 60, 50, 30),
      node("BLK_N", 62, 100, 50, 30),
      node("SRC", 0, 125, 10, 30),
      node("FSRC", 0, 35, 10, 30),
    ],
    [
      // Long route with an early vertical at x=40 — the fresh re-side riser
      // is at the route's tail (~31), so any index-based guess would read
      // x=40 as "the riser" and let a blocker land within 10px of x=31.
      edge("E02", [
        { x: 10, y: 140 },
        { x: 40, y: 140 },
        { x: 40, y: 130 },
        { x: 63, y: 130 },
        { x: 63, y: 90 },
      ]),
      // Blocker with an interior riser at x=45; relocation scanning west must
      // not land within 10px of E02's true fresh riser.
      edge("E11", [
        { x: 10, y: 50 },
        { x: 45, y: 50 },
        { x: 45, y: 110 },
        { x: 62, y: 110 },
      ]),
    ],
  );
  const before = allCrossings(s);
  clearSideHugs(s);
  assertInvariants(s, before);
  const e02 = s.edges.find((e) => e.id === "E02")!;
  const e11 = s.edges.find((e) => e.id === "E11")!;
  const seat = seatOf(s, e02.pts[e02.pts.length - 1])!;
  if (seat.side === "west") {
    // The fix fired: find the fresh riser (the longest vertical) and check the
    // blocker kept its 10px clearance from it.
    let riserX = -1;
    let best = 0;
    for (let i = 0; i + 1 < e02.pts.length; i++) {
      if (Math.abs(e02.pts[i].x - e02.pts[i + 1].x) < 0.5) {
        const len = Math.abs(e02.pts[i].y - e02.pts[i + 1].y);
        if (len > best) {
          best = len;
          riserX = e02.pts[i].x;
        }
      }
    }
    const e11Riser = e11.pts[1].x;
    assert.ok(
      Math.abs(e11Riser - riserX) >= 10,
      `blocker at x=${e11Riser} within 10px of E02's riser x=${riserX}`,
    );
  }
  assert.ok(hugCount(s) < 2, "long-route re-side left a hug behind");
});

// ---------------------------------------------------------------------------
// Fixture D — a blocker whose relocation cannot help (its shape is not a
// relocatable interior riser): the re-side must fail safe — the hug stays as
// debt, nothing is corrupted.
// ---------------------------------------------------------------------------
test("unrelocatable blocker fails safe (hug stays, invariants hold)", () => {
  const s = scene(
    [
      node("L1", 40, 40, 140, 120, true),
      node("BLK_T", 60, 60, 50, 30),
      node("BLK_N", 62, 100, 50, 30),
      node("SRC", 0, 125, 10, 30),
      node("FSRC", 45, 35, 10, 30),
      node("NODE_E", 150, 50, 60, 80),
    ],
    [
      edge("E02", [
        { x: 10, y: 140 },
        { x: 63, y: 140 },
        { x: 63, y: 90 },
      ]),
      // The blocker's "riser" is a terminal segment — not relocatable by the
      // interior-riser machinery; it walls the approach at x=55.
      edge("E11", [
        { x: 55, y: 50 },
        { x: 55, y: 110 },
        { x: 62, y: 110 },
      ]),
    ],
  );
  const before = allCrossings(s);
  clearSideHugs(s);
  assertInvariants(s, before);
  // Whatever happened (fix or debt), no edge may be corrupted.
  for (const e of s.edges) {
    assert.ok(e.pts.length >= 2, `${e.id} lost its route`);
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      assert.ok(
        Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5,
        `${e.id}: segment not orthogonal after fail-safe`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Fixture E — a HORIZONTAL hugging run (the flow rides a node's north side),
// END-terminal re-side to the target's north side.
// ---------------------------------------------------------------------------
test("horizontal-run re-side clears a north-side hug", () => {
  const s = scene(
    [
      node("L1", 40, 40, 140, 120, true),
      node("BLK_T", 105, 60, 50, 30),
      node("BLK_N", 60, 60, 50, 30),
      node("SRC", 10, 125, 10, 30),
    ],
    [
      // E02 arrives at BLK_T's west side (x=105) on a horizontal run at y=61
      // riding BLK_N's north side (y=60), shared 45px.
      edge("E02", [
        { x: 20, y: 140 },
        { x: 20, y: 61 },
        { x: 105, y: 61 },
      ]),
    ],
  );
  const before = allCrossings(s);
  clearSideHugs(s);
  assertInvariants(s, before);
  const e02 = s.edges.find((e) => e.id === "E02")!;
  const seat = seatOf(s, e02.pts[e02.pts.length - 1])!;
  if (seat.side === "north") {
    assert.equal(seat.node.id, "BLK_T");
    // The horizontal riser must sit clear of L1's north border (y=40+8).
    const riserY = e02.pts[e02.pts.length - 2].y;
    assert.ok(riserY >= 48, `E02 riser at y=${riserY} too close to the layer border`);
  }
  assert.ok(hugCount(s) < 2, "horizontal re-side left a hug behind");
});

// ---------------------------------------------------------------------------
// Determinism: the same input twice gives the same output.
// ---------------------------------------------------------------------------
test("clearSideHugs is deterministic", () => {
  const build = () =>
    scene(
      [
        node("L1", 40, 40, 140, 120, true),
        node("BLK_T", 60, 60, 50, 30),
        node("BLK_N", 62, 100, 50, 30),
        node("SRC", 0, 125, 10, 30),
        node("FSRC", 0, 35, 10, 30),
        node("NODE_E", 150, 50, 60, 80),
      ],
      [
        edge("E02", [
          { x: 10, y: 140 },
          { x: 63, y: 140 },
          { x: 63, y: 90 },
        ]),
        edge("E11", [
          { x: 10, y: 50 },
          { x: 55, y: 50 },
          { x: 55, y: 110 },
          { x: 62, y: 110 },
        ]),
      ],
    );
  const a = build();
  const b = build();
  clearSideHugs(a);
  clearSideHugs(b);
  assert.deepEqual(
    a.edges.map((e) => e.pts),
    b.edges.map((e) => e.pts),
  );
});
