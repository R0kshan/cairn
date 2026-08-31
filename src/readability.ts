/**
 * The readability ladder: one ranking and one acceptance rule, shared by every
 * pass that moves geometry. Tiers and their defects:
 * `documentation/READABILITY_METRICS.md`.
 *
 * A profile is keyed by defect *identity*, never tallied — a count cannot see a
 * defect move: reordering four risers once lowered a drawing's crossing count
 * while handing a fifth flow a new crossing in clean space.
 *
 * A change is judged on the whole scene and may only trade downwards.
 *
 * Tier 1 is only partly modelled: labels are settled after every geometry pass,
 * so the profile carries one Tier 1 key, `unlabelled:<edge>`. The rest belongs
 * to `label-anchor` and `settleLabelPositions` (§4a, §4d).
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

interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boundsOf(pts: Point[]): Bounds {
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
}

/**
 * Two routes whose bounds miss by more than the widest proximity rule (10px,
 * `nearParallel`) share no defect, so the pair is skipped whole. Most pairs in
 * a drawing are nowhere near each other, and without this the optimiser spent
 * all its time proving that.
 */
const farApart = (a: Bounds, b: Bounds) =>
  a.x2 + 10 < b.x1 || b.x2 + 10 < a.x1 || a.y2 + 10 < b.y1 || b.y2 + 10 < a.y1;

/** Stable pair key, so `A~B` and `B~A` are the same defect. */
const pair = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

/** A route terminal resolved to the node side it lands on. */
interface Seat {
  node: SceneNode;
  /** The same four names `edge-tidy`'s `Side` uses, as literals so a caller can
   *  feed a seat's side straight back into a side-typed API. */
  side: "north" | "south" | "east" | "west";
}

/** The two terminals of a route, either of which may be unseated. */
type Ends = (Seat | null)[];

/** Anything with a box shape the ladder tests against — leaves and title bands. */
interface Boxy {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Label = SceneEdge["labels"][number];

/** Which node side, if any, a point lands on. */
function seatOf(leaves: SceneNode[], p: Point): Seat | null {
  for (const node of leaves) {
    const withinX = p.x > node.x - 2 && p.x < node.x + node.width + 2;
    const withinY = p.y > node.y - 2 && p.y < node.y + node.height + 2;
    if (withinX && Math.abs(p.y - node.y) < 2) return { node, side: "north" };
    if (withinX && Math.abs(p.y - (node.y + node.height)) < 2) return { node, side: "south" };
    if (withinY && Math.abs(p.x - node.x) < 2) return { node, side: "west" };
    if (withinY && Math.abs(p.x - (node.x + node.width)) < 2) return { node, side: "east" };
  }
  return null;
}

/** Nodes geometrically inside each container, so "is this my container?" is O(1). */
function containment(scene: Scene, boxes: SceneNode[]): Map<string, Set<string>> {
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
  return holds;
}

/**
 * Per-edge derivation cached until the edge moves. `local` runs once per
 * candidate route inside an optimiser loop; re-deriving runs and seats for every
 * *other* edge each time took 28s on one drawing. An overridden route is a
 * proposal, not the edge's current geometry, so it is never cached.
 *
 * One helper rather than three near-identical cache blocks: duplicated
 * derivations drift (§3).
 */
function memoise<T>(derive: (pts: Point[]) => T) {
  const cache = new Map<string, T>();
  return {
    get(edge: SceneEdge, pts: Point[], overridden: boolean): T {
      if (overridden) return derive(pts);
      const hit = cache.get(edge.id);
      if (hit) return hit;
      const made = derive(pts);
      cache.set(edge.id, made);
      return made;
    },
    drop: (id: string) => cache.delete(id),
  };
}

/** Everything the defect phases share, precomputed once per scene. */
interface Inspector {
  scene: Scene;
  titleBoxes: TitleBox[];
  leaves: SceneNode[];
  boxes: SceneNode[];
  holds: Map<string, Set<string>>;
  /** Leaves and title bands together — what a label seat may not overlap. */
  blockers: Boxy[];
  runsFor: (edge: SceneEdge, pts: Point[], overridden: boolean) => Run[];
  endsFor: (edge: SceneEdge, pts: Point[], overridden: boolean) => Ends;
  boundsFor: (edge: SceneEdge, pts: Point[], overridden: boolean) => Bounds;
}

/** One edge under judgement, with the route being judged — proposed or current. */
interface Subject {
  edge: SceneEdge;
  pts: Point[];
  ends: Ends;
}

/** What `local` was asked, threaded through the pairwise phase. */
interface Query {
  ids: Set<string>;
  overrides: Map<string, Point[]>;
  profile: Profile;
}

// ---- Tier 0: information destroyed ------------------------------------------

/** A route through a box, a container it does not belong to, or a name (§4e, §4h). */
function scanDestroyed(ctx: Inspector, subj: Subject, profile: Profile): void {
  const { leaves, boxes, holds, titleBoxes } = ctx;
  const { edge, pts, ends } = subj;
  for (let index = 0; index + 1 < pts.length; index++) {
    const a = pts[index];
    const b = pts[index + 1];
    if (Math.abs(a.x - b.x) >= 0.5 && Math.abs(a.y - b.y) >= 0.5)
      profile.set(`diag:${edge.id}:${index}`, 0);
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    for (const node of leaves)
      if (
        x1 < node.x + node.width - 1 &&
        node.x + 1 < x2 &&
        y1 < node.y + node.height - 1 &&
        node.y + 1 < y2
      )
        profile.set(`leaf:${edge.id}~${node.id}`, 0);
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
    for (const band of titleBoxes)
      if (x1 < band.x + band.width && band.x < x2 && y1 < band.y + band.height && band.y < y2)
        profile.set(`title:${edge.id}~${band.x},${band.y}`, 0);
  }
}

// ---- Tier 1: can this flow's labels still sit on it? -------------------------

/**
 * Does any run of `pts` offer this label a seat clear of boxes and titles?
 *
 * Mirrors `label-anchor`, which tries every run: testing only the longest let
 * the optimiser pick a route it believed seatable and landed 12 drawings on
 * `labelOffLine`. Allocation-free — this runs for every candidate of every edge.
 */
function labelSeatable(blockers: Boxy[], pts: Point[], label: Label): boolean {
  const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
  for (let index = 0; index + 1 < pts.length; index++) {
    const p = pts[index];
    const q = pts[index + 1];
    if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < label.width) continue;
    const sx = (p.x + q.x) / 2 - label.width / 2;
    const sy = (p.y + q.y) / 2 - lead;
    const sx2 = sx + label.width;
    const sy2 = sy + label.height;
    let blocked = false;
    for (const box of blockers)
      if (sx < box.x + box.width && box.x < sx2 && sy < box.y + box.height && box.y < sy2) {
        blocked = true;
        break;
      }
    if (!blocked) return true;
  }
  return false;
}

/**
 * Labels settle after every geometry pass, so a router cannot judge Tier 1
 * properly. It can check one thing: does the proposed route leave each label a
 * seat? A route that strands its own label forces `label-anchor` to take it off
 * the line — the §4d defect.
 */
function scanLabelSeats(ctx: Inspector, subj: Subject, profile: Profile): void {
  for (const label of subj.edge.labels) {
    if (!label.width || !label.height) continue;
    if (!labelSeatable(ctx.blockers, subj.pts, label)) profile.set(`unlabelled:${subj.edge.id}`, 1);
  }
}

// ---- Tier 2: the flow stays attributable, but reads wrong --------------------

/**
 * A terminal with no room for its arrowhead (§4i): a head jammed against its
 * feeding corner reads as a line, and direction is meaning.
 *
 * Scoped to the arrowhead, not "runs near a container border": the wider rule
 * pushed runs off borders onto container *names*, buying a tier-0 defect on ten
 * drawings to fix a tier-2 one.
 */
function scanArrowRoom(subj: Subject, profile: Profile): void {
  const { edge, pts } = subj;
  for (const [from, to] of [
    [0, 1],
    [pts.length - 1, pts.length - 2],
  ]) {
    const span = Math.abs(pts[to].x - pts[from].x) + Math.abs(pts[to].y - pts[from].y);
    if (span > 0 && span < ARROW_ROOM) profile.set(`cramped:${edge.id}:${from}`, 2);
  }
}

/**
 * A run travelling alongside a leaf's border, close enough that the two read as
 * one line (§4i). Skips the boxes this flow actually attaches to — a terminal
 * necessarily touches its own node's border.
 */
function scanBorderHugs(ctx: Inspector, subj: Subject, profile: Profile): void {
  const { edge, pts, ends } = subj;
  const mineNodes = [ends[0]?.node, ends[1]?.node];
  for (let index = 0; index + 1 < pts.length; index++) {
    const a = pts[index];
    const b = pts[index + 1];
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    if (!horizontal && Math.abs(a.x - b.x) >= 0.5) continue;
    const at = horizontal ? a.y : a.x;
    const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    for (const box of ctx.leaves) {
      if (mineNodes.includes(box)) continue;
      const along = horizontal ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
      if (Math.min(hi, along[1]) - Math.max(lo, along[0]) < HUG_RUN) continue;
      const sides = horizontal ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
      for (const side of sides)
        if (Math.abs(at - side) < HUG_CLEAR) profile.set(`hug:${edge.id}:${index}@${box.id}`, 2);
    }
  }
}

// ---- Tier 3: eye travel -----------------------------------------------------

/** A terminal setting off away from its counterpart (§4c). */
function scanAwayTerminals(subj: Subject, profile: Profile): void {
  const { edge, pts, ends } = subj;
  if (!ends[0] || !ends[1]) return;
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

/** Too many turns, and staircase steps between them. */
function scanEyeTravel(subj: Subject, profile: Profile): void {
  const { edge, pts } = subj;
  if (pts.length - 2 > MAX_TURNS) profile.set(`weave:${edge.id}`, 3);
  for (let index = 1; index + 2 < pts.length; index++) {
    const length =
      Math.abs(pts[index + 1].x - pts[index].x) + Math.abs(pts[index + 1].y - pts[index].y);
    if (length > 0 && length <= JOG_LIMIT) profile.set(`jog:${edge.id}:${index}`, 3);
  }
  scanAwayTerminals(subj, profile);
}

// ---- pairwise: Tier 0 merges, Tier 2 tangles ---------------------------------

/** Where two routes cross, and whether the crossing sits inside a shared fan (§4b). */
function scanCrossings(a: Subject, b: Subject, key: string, profile: Profile): void {
  const fanEnds = [...a.ends, ...b.ends];
  for (let i = 0; i + 1 < a.pts.length; i++)
    for (let j = 0; j + 1 < b.pts.length; j++) {
      const hit = crossAt(a.pts[i], a.pts[i + 1], b.pts[j], b.pts[j + 1]);
      if (!hit) continue;
      profile.set(`cross:${key}@${Math.round(hit.x)},${Math.round(hit.y)}`, 2);
      for (const end of fanEnds) {
        if (!end) continue;
        const dx = Math.max(0, end.node.x - hit.x, hit.x - (end.node.x + end.node.width));
        const dy = Math.max(0, end.node.y - hit.y, hit.y - (end.node.y + end.node.height));
        if (dx * dx + dy * dy <= FAN_REACH * FAN_REACH) profile.set(`fan:${key}@${end.node.id}`, 2);
      }
    }
}

/** Two routes running alongside each other: merged outright, or merely crowding. */
function scanParallelRuns(mine: Run[], theirs: Run[], key: string, profile: Profile): void {
  for (const run of mine)
    for (const run2 of theirs) {
      if (run.vertical !== run2.vertical) continue;
      const gap = Math.abs(run.at - run2.at);
      const shared = Math.min(run.hi, run2.hi) - Math.max(run.lo, run2.lo);
      if (gap < 3 && shared > 8) profile.set(`merge:${key}@${Math.round(run.at)}`, 0);
      else if (gap < 10 && shared > 40) profile.set(`near:${key}@${Math.round(run.at)}`, 2);
    }
}

/**
 * Two flows landing on the same point of a node side read as one line. Reuses
 * the seats already resolved for both routes: `seatOf` scans every leaf, and
 * four calls per pair per candidate dominated the loop.
 */
function scanSharedSeats(a: Subject, b: Subject, key: string, profile: Profile): void {
  for (const [ai, seatA] of a.ends.entries())
    for (const [bi, seatB] of b.ends.entries()) {
      if (!seatA || !seatB || seatA.node !== seatB.node || seatA.side !== seatB.side) continue;
      const p = ai === 0 ? a.pts[0] : a.pts[a.pts.length - 1];
      const q = bi === 0 ? b.pts[0] : b.pts[b.pts.length - 1];
      const vertical = seatA.side === "east" || seatA.side === "west";
      const apart = Math.abs((vertical ? p.y : p.x) - (vertical ? q.y : q.x));
      if (apart < 6) {
        profile.set(`seat:${key}@${seatA.node.id}|${seatA.side}`, 0);
        continue;
      }
      // Tier 4: seats closer than the side comfortably holds. The ladder
      // protects only what it can see — leaving this out let the optimiser
      // crowd node sides while every modelled tier looked fine.
      const side = vertical ? seatA.node.height : seatA.node.width;
      const need = Math.min(12, (side - 6) / 2);
      if (apart < need * 0.8) profile.set(`tight:${key}@${seatA.node.id}|${seatA.side}`, 4);
    }
}

/** Every defect this route shares with another. The expensive half of `local`. */
function scanPairs(ctx: Inspector, subj: Subject, query: Query): void {
  const { ids, overrides, profile } = query;
  const own = overrides.has(subj.edge.id);
  const mine = ctx.runsFor(subj.edge, subj.pts, own);
  const myBounds = ctx.boundsFor(subj.edge, subj.pts, own);
  for (const other of ctx.scene.edges) {
    if (other.id === subj.edge.id) continue;
    const theirs = overrides.get(other.id) ?? other.pts;
    if (theirs.length < 2) continue;
    // Only judge a pair once when both are moving.
    if (ids.has(other.id) && other.id < subj.edge.id) continue;
    const overridden = overrides.has(other.id);
    if (farApart(myBounds, ctx.boundsFor(other, theirs, overridden))) continue;

    const them: Subject = {
      edge: other,
      pts: theirs,
      ends: ctx.endsFor(other, theirs, overridden),
    };
    const key = pair(subj.edge.id, other.id);
    scanCrossings(subj, them, key, profile);
    scanParallelRuns(mine, ctx.runsFor(other, theirs, overridden), key, profile);
    scanSharedSeats(subj, them, key, profile);
  }
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
  const holds = containment(scene, boxes);

  const sideOf = (p: Point) => seatOf(leaves, p);
  const endsOf = (pts: Point[]): Ends => [sideOf(pts[0]), sideOf(pts[pts.length - 1])];

  const runs = memoise(runsOf);
  const ends = memoise(endsOf);
  const bounds = memoise(boundsOf);
  const forget = (id: string) => {
    runs.drop(id);
    ends.drop(id);
    bounds.drop(id);
  };

  const ctx: Inspector = {
    scene,
    titleBoxes,
    leaves,
    boxes,
    holds,
    blockers: [...leaves, ...titleBoxes],
    runsFor: runs.get,
    endsFor: ends.get,
    boundsFor: bounds.get,
  };

  /**
   * Every defect involving at least one of `ids`, with `overrides` standing in
   * for those edges' routes. Defects not touching `ids` cannot change, so they
   * are not computed — that is what makes this affordable per candidate.
   *
   * `soloOnly` stops before the pairwise phase, returning only what a route
   * costs on its own: through a box, a container, a title, a weave. An optimiser
   * rejecting a candidate for a solo tier-0 defect never needs the expensive
   * half (every edge × every segment pair). Sound because the phases emit
   * disjoint key namespaces, so a solo key here appears in the full profile too
   * — same code, never a second predicate meaning *almost* this (§3).
   */
  const local = (ids: Set<string>, overrides: Map<string, Point[]>, soloOnly = false): Profile => {
    const profile: Profile = new Map();
    const query: Query = { ids, overrides, profile };

    for (const edge of scene.edges) {
      if (!ids.has(edge.id)) continue;
      const pts = overrides.get(edge.id) ?? edge.pts;
      if (pts.length < 2) continue;
      const subj: Subject = { edge, pts, ends: ctx.endsFor(edge, pts, overrides.has(edge.id)) };

      scanDestroyed(ctx, subj, profile);
      scanLabelSeats(ctx, subj, profile);
      scanArrowRoom(subj, profile);
      scanBorderHugs(ctx, subj, profile);
      scanEyeTravel(subj, profile);

      if (soloOnly) continue;
      scanPairs(ctx, subj, query);
    }
    return profile;
  };

  return { local, sideOf, endsOf, forget, leaves, boxes, holds };
}

/**
 * Does `after` beat `before` on the ladder? Walks tiers from most to least
 * important and stops at the first whose defect *set* differs: only losses is an
 * improvement, and everything below it is fair payment; any gain is refused,
 * including a gain alongside a loss, which is a defect moving rather than going.
 *
 * A count-based test cannot express that, and every bug this module prevents
 * came from one.
 */
export function ladderAccepts(before: Profile, after: Profile): boolean {
  return ladderVerdict(before, after) >= 0;
}

/**
 * The tier a change pays off at, or -1 if it is no improvement. For callers that
 * need *what* a move bought: clearing eye-travel is not worth risking a label's
 * attribution, and the tier is the only way to tell those apart.
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
