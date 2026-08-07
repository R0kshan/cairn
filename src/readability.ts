/**
 * The readability ladder: one ranking, one acceptance rule, shared by every
 * pass that moves geometry.
 *
 * Before this existed each pass carried its own accept/reject test — "strictly
 * shorter", "fewer crossings", "no new partner", "clears a container" — and the
 * tests disagreed. That produced three classes of bug, all of them found the
 * hard way:
 *
 * - **A total falls while a defect moves.** Reordering four risers lowered a
 *   drawing's crossing count *and* handed a fifth flow a brand-new crossing in
 *   clean space. Counting cannot see this; comparing the *set* of defects can,
 *   which is why a profile here is keyed by identity, never tallied.
 * - **A pass fixes its own metric and breaks a better one.** Unweaving bought a
 *   turn with a crossing; clearing a container bought it with a weave.
 * - **A pass validates geometry a later pass then reshapes**, so what was proven
 *   clean is not what gets drawn.
 *
 * The ladder answers all three: defects are ranked by *what the reader loses*,
 * a change is judged on the whole scene, and a change may only ever trade
 * downwards.
 *
 * | Tier | The reader loses | Examples |
 * |------|------------------|----------|
 * | 0 | information outright | a run through a box, through a container it has no business in, through a title; two flows drawn as one line |
 * | 1 | attribution | (labels — owned by `label-anchor` and the renderer, which run later) |
 * | 2 | the thread of a line | crossings, fan tangles, near-parallel runs |
 * | 3 | only time | weaving routes, wrong-side departures, staircases |
 * | 4 | nothing much | tight attachments |
 *
  * Tier 1 is only partially modelled here: label placement happens after every
  * geometry pass, so a router cannot evaluate final label positions. The profile
  * carries one Tier 1 key — `unlabelled:<edge>`, meaning the proposed route
  * leaves its own label no seat clear of boxes and titles. Everything else at
  * that tier belongs to `label-anchor` and `settleLabelPositions` (§4a, §4d).
 */

import type { Scene, SceneEdge, SceneNode } from "./scene-layout.ts";
import type { Point, TitleBox } from "./geometry.ts";

/** Defect identity → tier. Identity, so a defect that *moves* is visible. */
export type Profile = Map<string, number>;

/** Crossings nearer than this to a shared node side are fan tangles (§4b). */
const FAN_REACH = 48;
/** Interior segments this short read as a staircase step. */
const JOG_LIMIT = 20;
/** A flow needs at most two turns; a third means a side was chosen badly (§4g). */
const MAX_TURNS = 2;
/** Terminals offset by less than this on an axis are "aligned", not "away". */
const AWAY_TOL = 24;
/**
 * Room a terminal segment needs for its arrowhead to read as an arrow
 * (INVARIANTS §4i). The head is ~7px long, so a shorter run leaves nothing
 * between the head and the corner feeding it and the direction stops being
 * legible — worse when the corner also sits a few px off a parallel container
 * border, which is what makes the two read as one line.
 */
const ARROW_ROOM = 14;
/**
 * How close a run may pass *alongside* a leaf box border before the two read as
 * one line — the run stops looking like a flow and starts looking like part of
 * the box outline. Deliberately leaf-only: the same rule applied to *container*
 * borders pushes runs onto container names and fights §4e (see §4i).
 */
const HUG_CLEAR = 8;
/** How much a run must travel alongside a border before hugging it is visible. */
const HUG_RUN = 12;


const orthOf = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5;

/** Where two orthogonal segments properly cross, or null. */
function crossAt(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(b1, b2, a1) > 0;
  const d2 = side(b1, b2, a2) > 0;
  const d3 = side(a1, a2, b1) > 0;
  const d4 = side(a1, a2, b2) > 0;
  if (d1 === d2 || d3 === d4) return null;
  return orthOf(a1, a2) ? { x: a1.x, y: b1.y } : { x: b1.x, y: a1.y };
}

interface Run {
  vertical: boolean;
  at: number;
  lo: number;
  hi: number;
}

function runsOf(pts: Point[]): Run[] {
  const runs: Run[] = [];
  for (let index = 0; index + 1 < pts.length; index++) {
    const a = pts[index];
    const b = pts[index + 1];
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5)
      runs.push({ vertical: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5)
      runs.push({ vertical: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
  }
  return runs;
}

/**
 * A scene inspector. Precomputes what every judgement needs (leaf boxes,
 * container membership, node sides) once, then answers "what defects involve
 * these edges, if their routes were these?" — cheaply enough to sit inside a
 * candidate loop.
 */
export function inspect(scene: Scene, titleBoxes: TitleBox[] = []) {
  const leaves = scene.nodes.filter((node) => !node.container);
  const boxes = scene.nodes.filter((node) => node.container);
  /** Nodes geometrically inside each container, so "is this my container?" is O(1). */
  const holds = new Map<string, Set<string>>();
  for (const box of boxes) {
    const set = new Set<string>();
    for (const node of scene.nodes)
      if (
        node !== box &&
        node.x >= box.x - 1 &&
        node.y >= box.y - 1 &&
        node.x + node.width <= box.x + box.width + 1 &&
        node.y + node.height <= box.y + box.height + 1
      )
        set.add(node.id);
    holds.set(box.id, set);
  }

  const sideOf = (p: Point): { node: SceneNode; side: string } | null => {
    for (const node of leaves) {
      const withinX = p.x > node.x - 2 && p.x < node.x + node.width + 2;
      const withinY = p.y > node.y - 2 && p.y < node.y + node.height + 2;
      if (withinX && Math.abs(p.y - node.y) < 2) return { node, side: "north" };
      if (withinX && Math.abs(p.y - (node.y + node.height)) < 2) return { node, side: "south" };
      if (withinY && Math.abs(p.x - node.x) < 2) return { node, side: "west" };
      if (withinY && Math.abs(p.x - (node.x + node.width)) < 2) return { node, side: "east" };
    }
    return null;
  };

  const endsOf = (pts: Point[]) => [sideOf(pts[0]), sideOf(pts[pts.length - 1])];

  // Memoised per-edge derivations. `local` is called once per candidate route
  // inside an optimiser loop, and re-deriving runs and seats for every *other*
  // edge each time is what made an unbounded version take 28s on one drawing.
  // Anything belonging to an edge that has not moved is stable; `forget` drops
  // an entry when it does.
  const runsCache = new Map<string, Run[]>();
  const endsCache = new Map<string, ReturnType<typeof endsOf>>();
  const runsFor = (edge: SceneEdge, pts: Point[], overridden: boolean) => {
    if (overridden) return runsOf(pts);
    const hit = runsCache.get(edge.id);
    if (hit) return hit;
    const made = runsOf(pts);
    runsCache.set(edge.id, made);
    return made;
  };
  const endsFor = (edge: SceneEdge, pts: Point[], overridden: boolean) => {
    if (overridden) return endsOf(pts);
    const hit = endsCache.get(edge.id);
    if (hit) return hit;
    const made = endsOf(pts);
    endsCache.set(edge.id, made);
    return made;
  };
  const forget = (id: string) => {
    runsCache.delete(id);
    endsCache.delete(id);
    boundsCache.delete(id);
  };
  interface Bounds { x1: number; y1: number; x2: number; y2: number }
  const boundsOf = (pts: Point[]): Bounds => {
    let x1 = pts[0].x;
    let x2 = pts[0].x;
    let y1 = pts[0].y;
    let y2 = pts[0].y;
    for (const p of pts) {
      if (p.x < x1) x1 = p.x;
      if (p.x > x2) x2 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.y > y2) y2 = p.y;
    }
    return { x1, y1, x2, y2 };
  };
  const boundsCache = new Map<string, Bounds>();
  const boundsFor = (edge: SceneEdge, pts: Point[], overridden: boolean) => {
    if (overridden) return boundsOf(pts);
    const hit = boundsCache.get(edge.id);
    if (hit) return hit;
    const made = boundsOf(pts);
    boundsCache.set(edge.id, made);
    return made;
  };
  /**
   * Two routes whose bounding boxes miss each other by more than the widest
   * proximity rule (10px, `nearParallel`) share no defect, so the pair can be
   * skipped whole. Most pairs in a drawing are nowhere near each other; without
   * this prune the optimiser spent all its time proving that.
   */
  const farApart = (a: Bounds, b: Bounds) =>
    a.x2 + 10 < b.x1 || b.x2 + 10 < a.x1 || a.y2 + 10 < b.y1 || b.y2 + 10 < a.y1;

  /** Stable pair key, so `A~B` and `B~A` are the same defect. */
  const pair = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

  /**
   * Every defect that involves at least one of `ids`, with `overrides` standing
   * in for those edges' routes. Defects not touching `ids` cannot change, so
   * they are not computed — that is what makes this affordable per candidate.
   *
   * `soloOnly` stops before the pairwise phase, returning just the defects a
   * route has on its own — through a box, a container, a title, a weave. It
   * exists for one caller: an optimiser rejecting a candidate that gains a
   * tier-0 defect *by itself* never needs the pairwise phase, and the pairwise
   * phase is the expensive one (every edge in the drawing, every segment pair).
   * Sound because the two phases emit disjoint key namespaces, so a solo tier-0
   * key that appears here appears in the full profile too — a cheap reject can
   * never differ from the verdict the full profile would have given. It is the
   * same code either way; a second predicate that meant *almost* this is exactly
   * the mistake INVARIANTS §3 records.
   */
  const local = (
    ids: Set<string>,
    overrides: Map<string, Point[]>,
    soloOnly = false,
  ): Profile => {
    const profile: Profile = new Map();
    const ptsOf = (edge: SceneEdge) => overrides.get(edge.id) ?? edge.pts;
    const subject = scene.edges.filter((edge) => ids.has(edge.id));

    for (const edge of subject) {
      const pts = ptsOf(edge);
      if (pts.length < 2) continue;
      const ends = endsFor(edge, pts, overrides.has(edge.id));

      // ---- Tier 0: information destroyed -------------------------------
      for (let index = 0; index + 1 < pts.length; index++) {
        const a = pts[index];
        const b = pts[index + 1];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx >= 0.5 && dy >= 0.5) profile.set(`diag:${edge.id}:${index}`, 0);
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x);
        const y1 = Math.min(a.y, b.y);
        const y2 = Math.max(a.y, b.y);
        // Through a leaf box.
        for (const node of leaves)
          if (
            x1 < node.x + node.width - 1 &&
            node.x + 1 < x2 &&
            y1 < node.y + node.height - 1 &&
            node.y + 1 < y2
          )
            profile.set(`leaf:${edge.id}~${node.id}`, 0);
        // Through a container holding neither endpoint (§4h).
        for (const box of boxes) {
          const inside = holds.get(box.id)!;
          if (ends.some((end) => end && inside.has(end.node.id))) continue;
          if (
            x1 < box.x + box.width - 1 &&
            box.x + 1 < x2 &&
            y1 < box.y + box.height - 1 &&
            box.y + 1 < y2
          )
            profile.set(`box:${edge.id}~${box.id}`, 0);
        }
        // Across a container's name (§4e).
        for (const band of titleBoxes)
          if (
            x1 < band.x + band.width &&
            band.x < x2 &&
            y1 < band.y + band.height &&
            band.y < y2
          )
            profile.set(`title:${edge.id}~${band.x},${band.y}`, 0);
      }

      // ---- Tier 1: can this flow's labels still sit on it? ---------------
      // Label placement happens after every geometry pass, so a router cannot
      // evaluate Tier 1 properly. What it *can* check is whether the route it
      // is proposing leaves each label anywhere to sit that clears the boxes and
      // titles — a route that strands its own label forces `label-anchor` to
      // take it off the line, which is the §4d defect.
      for (const label of edge.labels) {
        if (!label.width || !label.height) continue;
        const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
        // Mirror `label-anchor`: it tries every run, so testing only the
        // longest one lets the optimiser choose a route it believes is seatable
        // and land 12 drawings on `labelOffLine`. Kept allocation-free — this
        // runs for every candidate of every edge.
        let seatable = false;
        for (let index = 0; index + 1 < pts.length && !seatable; index++) {
          const p = pts[index];
          const q = pts[index + 1];
          if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < label.width) continue;
          const sx = (p.x + q.x) / 2 - label.width / 2;
          const sy = (p.y + q.y) / 2 - lead;
          const sx2 = sx + label.width;
          const sy2 = sy + label.height;
          let blocked = false;
          for (const box of leaves)
            if (sx < box.x + box.width && box.x < sx2 && sy < box.y + box.height && box.y < sy2) {
              blocked = true;
              break;
            }
          if (!blocked)
            for (const box of titleBoxes)
              if (sx < box.x + box.width && box.x < sx2 && sy < box.y + box.height && box.y < sy2) {
                blocked = true;
                break;
              }
          if (!blocked) seatable = true;
        }
        if (!seatable) profile.set(`unlabelled:${edge.id}`, 1);
      }

      // A terminal with no room for its arrowhead (§4i). Tier 2: the flow is
      // still attributable, but its *direction* — which is meaning, not polish —
      // takes work to read, and a head jammed against the corner feeding it
      // reads as a line, not an arrow.
      //
      // Deliberately scoped to the arrowhead, not to "runs near a container
      // border". The wider rule was tried and pushed runs off borders straight
      // onto container *names* — it fought §4e and gained a tier 0 defect on ten
      // drawings to fix a tier 2 one. Both reported cases were short terminals.
      for (const [from, to] of [
        [0, 1],
        [pts.length - 1, pts.length - 2],
      ]) {
        const span = Math.abs(pts[to].x - pts[from].x) + Math.abs(pts[to].y - pts[from].y);
        if (span > 0 && span < ARROW_ROOM) profile.set(`cramped:${edge.id}:${from}`, 2);
      }
      // A run travelling alongside a leaf's border, close enough that the two
      // read as one line (§4i). Skips the boxes this flow actually attaches to —
      // a terminal necessarily touches its own node's border.
      const mineNodes = [ends[0]?.node, ends[1]?.node];
      for (let index = 0; index + 1 < pts.length; index++) {
        const a = pts[index];
        const b = pts[index + 1];
        const horizontal = Math.abs(a.y - b.y) < 0.5;
        if (!horizontal && Math.abs(a.x - b.x) >= 0.5) continue;
        const at = horizontal ? a.y : a.x;
        const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
        const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
        for (const box of leaves) {
          if (mineNodes.includes(box)) continue;
          const along = horizontal ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
          if (Math.min(hi, along[1]) - Math.max(lo, along[0]) < HUG_RUN) continue;
          const sides = horizontal ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
          for (const side of sides)
            if (Math.abs(at - side) < HUG_CLEAR)
              profile.set(`hug:${edge.id}:${index}@${box.id}`, 2);
        }
      }

      // ---- Tier 3: eye travel -------------------------------------------
      if (pts.length - 2 > MAX_TURNS) profile.set(`weave:${edge.id}`, 3);
      for (let index = 1; index + 2 < pts.length; index++) {
        const length =
          Math.abs(pts[index + 1].x - pts[index].x) + Math.abs(pts[index + 1].y - pts[index].y);
        if (length > 0 && length <= JOG_LIMIT) profile.set(`jog:${edge.id}:${index}`, 3);
      }
      // A terminal setting off away from its counterpart (§4c).
      if (ends[0] && ends[1]) {
        const away = (seg: Point, target: Point) =>
          (Math.abs(seg.x) >= 0.5 && Math.abs(target.x) > AWAY_TOL && seg.x * target.x < 0) ||
          (Math.abs(seg.y) >= 0.5 && Math.abs(target.y) > AWAY_TOL && seg.y * target.y < 0);
        const centre = (node: SceneNode) => ({
          x: node.x + node.width / 2,
          y: node.y + node.height / 2,
        });
        const src = centre(ends[0].node);
        const dst = centre(ends[1].node);
        const p0 = pts[0];
        const p1 = pts[1];
        const pn = pts[pts.length - 1];
        const pm = pts[pts.length - 2];
        if (away({ x: p1.x - p0.x, y: p1.y - p0.y }, { x: dst.x - p0.x, y: dst.y - p0.y }))
          profile.set(`away:${edge.id}:out`, 3);
        if (away({ x: pn.x - pm.x, y: pn.y - pm.y }, { x: pn.x - src.x, y: pn.y - src.y }))
          profile.set(`away:${edge.id}:in`, 3);
      }

      // ---- pairwise: Tier 0 merges, Tier 2 tangles -----------------------
      if (soloOnly) continue;
      const mine = runsFor(edge, pts, overrides.has(edge.id));
      const myBounds = boundsFor(edge, pts, overrides.has(edge.id));
      for (const other of scene.edges) {
        if (other.id === edge.id) continue;
        const theirs = ptsOf(other);
        if (theirs.length < 2) continue;
        // Only judge a pair once when both are moving.
        if (ids.has(other.id) && other.id < edge.id) continue;
        if (farApart(myBounds, boundsFor(other, theirs, overrides.has(other.id)))) continue;

        const fanEnds = [...ends, ...endsFor(other, theirs, overrides.has(other.id))];
        for (let i = 0; i + 1 < pts.length; i++)
          for (let j = 0; j + 1 < theirs.length; j++) {
            const hit = crossAt(pts[i], pts[i + 1], theirs[j], theirs[j + 1]);
            if (!hit) continue;
            profile.set(`cross:${pair(edge.id, other.id)}@${Math.round(hit.x)},${Math.round(hit.y)}`, 2);
            // Inside a fan the two flows share, it is worse (§4b).
            for (const end of fanEnds) {
              if (!end) continue;
              const dx = Math.max(0, end.node.x - hit.x, hit.x - (end.node.x + end.node.width));
              const dy = Math.max(0, end.node.y - hit.y, hit.y - (end.node.y + end.node.height));
              if (dx * dx + dy * dy <= FAN_REACH * FAN_REACH)
                profile.set(`fan:${pair(edge.id, other.id)}@${end.node.id}`, 2);
            }
          }

        const others = runsFor(other, theirs, overrides.has(other.id));
        for (const run of mine)
          for (const run2 of others) {
            if (run.vertical !== run2.vertical) continue;
            const gap = Math.abs(run.at - run2.at);
            const shared = Math.min(run.hi, run2.hi) - Math.max(run.lo, run2.lo);
            if (gap < 3 && shared > 8)
              profile.set(`merge:${pair(edge.id, other.id)}@${Math.round(run.at)}`, 0);
            else if (gap < 10 && shared > 40)
              profile.set(`near:${pair(edge.id, other.id)}@${Math.round(run.at)}`, 2);
          }

        // Two flows landing on the same point of a node side read as one line.
        // Reuses the seats already resolved above — `sideOf` scans every leaf,
        // and calling it four times per pair per candidate dominated the loop.
        const theirEnds = endsFor(other, theirs, overrides.has(other.id));
        for (const [ai, seatA] of ends.entries())
          for (const [bi, seatB] of theirEnds.entries()) {
            if (!seatA || !seatB || seatA.node !== seatB.node || seatA.side !== seatB.side)
              continue;
            const p = ai === 0 ? pts[0] : pts[pts.length - 1];
            const q = bi === 0 ? theirs[0] : theirs[theirs.length - 1];
            const vertical = seatA.side === "east" || seatA.side === "west";
            const apart = Math.abs((vertical ? p.y : p.x) - (vertical ? q.y : q.x));
            if (apart < 6)
              profile.set(`seat:${pair(edge.id, other.id)}@${seatA.node.id}|${seatA.side}`, 0);
            else {
              // Tier 4: seats closer than the side can comfortably hold. Modelled
              // because the ladder can only protect what it can see — leaving
              // this out let the optimiser crowd node sides freely while every
              // tier it *did* model looked fine.
              const side = vertical ? seatA.node.height : seatA.node.width;
              const need = Math.min(12, (side - 6) / 2);
              if (apart < need * 0.8)
                profile.set(`tight:${pair(edge.id, other.id)}@${seatA.node.id}|${seatA.side}`, 4);
            }
          }
      }
    }
    return profile;
  };

  return { local, sideOf, endsOf, forget, leaves, boxes, holds };
}

/**
 * Does `after` beat `before` on the ladder?
 *
 * Walks the tiers from most to least important and stops at the first one whose
 * defect *set* differs. If that tier only lost defects, the change is an
 * improvement and everything below it is fair payment. If it gained any — even
 * while losing others, which is a defect *moving* rather than going — the change
 * is refused.
 *
 * This is the rule that a count-based test cannot express, and every bug this
 * module exists to prevent came from a count-based test.
 */
export function ladderAccepts(before: Profile, after: Profile): boolean {
  return ladderVerdict(before, after) >= 0;
}

/**
 * The tier a change pays off at, or -1 if it is not an improvement. Callers that
 * need to know *what* a move bought — not merely that it bought something — use
 * this: a move that only clears eye-travel is not worth risking a label's
 * attribution over, and the tier is the only way to tell the two apart.
 */
export function ladderVerdict(before: Profile, after: Profile): number {
  for (let tier = 0; tier < 5; tier++) {
    const was = new Set([...before].filter(([, t]) => t === tier).map(([key]) => key));
    const now = new Set([...after].filter(([, t]) => t === tier).map(([key]) => key));
    let gained = false;
    let lost = false;
    for (const key of now) if (!was.has(key)) gained = true;
    for (const key of was) if (!now.has(key)) lost = true;
    if (gained) return -1;
    if (lost) return tier;
  }
  return -1;
}
