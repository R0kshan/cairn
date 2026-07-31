/**
 * Readability sweep: builds every example in every disposition and counts
 * layout defects by kind. Run with `npm run sweep`.
 *
 * Three kinds of gate:
 *
 * - Coverage — every example × disposition cell must actually render. A cell
 *   that fails to validate, lay out or render is reported and fails the run;
 *   skipping it quietly would let the gate pass over drawings it never drew.
 * - `MUST_BE_ZERO` — invariants. A flow slanted off orthogonal, dragged across
 *   a node box, leaving a band of dead height, or carrying a label that has
 *   floated off it is a bug, full stop.
 * - `CEILING_RATE` — a ratchet over debt that cannot be zero yet, expressed as
 *   defects per swept flow-instance (edge × disposition) rather than a raw
 *   count. These defects scale with how many flows the corpus contains, so a
 *   rate is what stays comparable as examples/fixtures are added — a raw
 *   count would spuriously fail every time the corpus grows even though
 *   nothing got worse per drawing. Lower a rate whenever a change earns it —
 *   never raise one to make a run pass.
 *
 * Per-example spot checks repeatedly missed defects that only a full
 * example × disposition matrix reveals, which is why this exists.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { views } from "../src/views.ts";
import { titleBoxesOf } from "../src/route-detour.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DISPOSITIONS = ["wide", "slide", "page", "tall"] as const;

const MUST_BE_ZERO = [
  "overlaps",
  "diagonal",
  "throughBox",
  "deadBand",
  "coincident",
  "attachShared",
  "labelAdrift",
] as const;
// Calibrated against the corpus at the time recursive discovery started
// covering examples/dispositions and examples/themes (4352 flow-instances,
// 288 drawings): rate = count / totalFlows, rounded up slightly for stability.
const CEILING_RATE: Record<string, number> = {
  attachTight: 0.0009191,
  "jog<=6": 0.0234375,
  "jog<=20": 0.0962776,
  nearParallel: 0.0135569,
  // Raised 0.0436580 -> 0.0461855 (190 -> 201) when labels moved onto their
  // runs (§4d). A label pins the horizontal band it sits in, so seating them on
  // the lines instead of above them changes which bands `compact` can reclaim:
  // some drawings tighten (large-fr lost 29px of height), a few loosen, and 11
  // flows crossed the len > 2.2x-direct threshold either way. The routes did not
  // get worse — the distances they are measured against moved.
  // Raised 0.0438878 -> 0.0450367 (191 -> 196), with attachAway, when folded
  // slide layouts finally got the container title bands passed to `tidyEdges`.
  // They had been routing without them, so the reroute there was free to cross a
  // container's name; protecting the titles costs one drawing (in its four
  // fixture copies) a longer route and two wrap-around attachments. A run
  // through a container's name is worse than a longer route, so the trade is
  // taken deliberately — see §4e.
  longDetour: 0.0441176,
  // Flows bundled tightly enough that no position exists which is both free of
  // overlaps and nearer its own run than its neighbours'. Lowering this means
  // giving the settler somewhere better to go, not relaxing the check.
  labelOrphan: 0,
  // Needs elk to order the ports, not a pass after the fact: reseating a flow
  // without rerouting its body only moves the tangle further along the route.
  // Measured — a seat-permutation pass cut the inverted cases from 207 to 26
  // and pushed total crossings from 287 to 501.
  fanTangle: 0.0149357,
  // Corridors so tight the label cannot clear every run in them: with flows
  // 12px apart, a two-line box with a business-object chip is taller than the
  // gap it would have to fit in. Lowering this means spreading the bundle, not
  // shrinking the check.
  labelPierced: 0.0013787,
  // Labels the settler had to take off their run to keep overlaps at zero —
  // corridors where no seat along the flow clears both its neighbours and the
  // node boxes. Lowering this means finding them a seat *along* the run, or
  // spreading the bundle; never by relaxing what "on the line" means.
  labelOffLine: 0.0193014,
  // Runs and labels drawn across a container's name. Edges are emitted last and
  // a title carries no halo, so anything crossing one strikes through the words.
  // `route-detour` has always avoided them when planning a channel; elk has not,
  // and the repair pass in edge-tidy can only move a run that has somewhere
  // clean to go.
  titleStruck: 0.2028952,
  // Flows crossing anywhere in the drawing (INVARIANTS §4f). Most are inherent
  // to the topology; the ones that are not come from risers placed in the wrong
  // left-to-right order, which the nesting pass in edge-tidy repairs. Lowering
  // this means better lane ordering, never fewer flows.
  crossings: 0.9859835,
  // Flows that weave (INVARIANTS §4g): more than two turns, when a straight
  // run, an L or a Z always suffices geometrically. What remains is flows whose
  // straighter route would cross something the weave currently dodges — the
  // reroute refuses to buy turns with tangles.
  turnHeavy: 0.2093290,
  // Runs crossing a container that holds neither endpoint (INVARIANTS §4h).
  // Small enough to drive to zero eventually; the passes may never create one.
  throughContainer: 0.0133272,
  // Wrap-around attachments (INVARIANTS §4c): a terminal departing away from
  // its counterpart, or arriving from beyond it. The reroute pass in edge-tidy
  // replaces the ones it can prove clean (~25% of the population elk + the
  // channel planner produced); the remainder needs elk port constraints or
  // channel-side planning, not another post-pass.
  attachAway: 0.0634191,
};

interface Run {
  lo: number;
  hi: number;
  at: number;
  id: string;
}

interface Point {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A flow label this far from its own run has stopped reading as belonging to
 * it. Sized against the two ways a label legitimately leaves the line: the
 * `above`/`below` style offsets it by half its height + 5, and the overlap
 * settler's first two escape steps are 8px and 14px. Past 20px the label is
 * further from its flow than `MIN_ATTACH_GAP` puts the neighbouring flow, so
 * the reader has no way left to tell which run it annotates.
 */
const LABEL_ADRIFT = 20;

/**
 * Within this of its own run a label reads as attached to it whatever else is
 * nearby, so a closer neighbouring run is not an ambiguity — it is two flows
 * running close together, which `nearParallel` already charges for. Without
 * this floor, 147 labels sitting *on* their own line score as orphaned because
 * some other line grazes them 1px nearer.
 */
const LABEL_ATTACHED = 6;

/**
 * A foreign run this close to a label box is drawn through the text. Not 0: the
 * renderer strokes a halo behind label text, so a line grazing the very edge of
 * the box is still legible — it is the line crossing the words that isn't.
 */
const PIERCE_SLACK = 1;

/**
 * How far a label's text centre may sit from its own run and still count as
 * *on* it (invariant §4d). Not 0: seats are computed from segment midpoints in
 * floating point and a terminal run can shift by a fraction after seating, so a
 * sub-pixel gap is arithmetic, not placement. 2 is well under the ~3px offset
 * elk uses when it parks a label beside a line, so this still catches the
 * "caption floating next to the flow" case it exists to forbid.
 */
const ON_LINE_SLACK = 2;

/**
 * Squared distance from a label box to one segment. Every segment is
 * orthogonal by the time this runs (`diagonal` is a must-be-zero invariant),
 * so the per-axis gaps are independent and this is exact — no sampling, which
 * is what keeps a labels × edges scan affordable over the whole corpus. On a
 * diagonal it degrades to the distance to the segment's bounding box, an
 * underestimate: it can miss a defect, never invent one.
 */
const boxToSegmentSq = (box: Box, a: Point, b: Point): number => {
  const dx = Math.max(0, box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - (box.x + box.width));
  const dy = Math.max(0, box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - (box.y + box.height));
  return dx * dx + dy * dy;
};

const boxToPolylineSq = (box: Box, pts: Point[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = boxToSegmentSq(box, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
};

/**
 * How far from a node a crossing still counts as part of its fan. Inside this
 * band the reader is working out which line leaves which attachment point, so a
 * crossing there defeats the whole purpose of spreading the seats. Beyond it a
 * crossing is just two routes meeting in open space — normal in an orthogonal
 * drawing, and not something attachment order can fix.
 */
const FAN_REACH = 48;

/**
 * Where two segments properly cross, or null. Strict comparisons throughout, so
 * two flows merely touching at a shared point are not a crossing — that case is
 * `attachShared`/`coincident`, and counting it twice would double-charge one
 * defect. Every segment is orthogonal here, so a proper crossing is always one
 * horizontal against one vertical and the point is exact.
 */
const segmentsCross = (a1: Point, a2: Point, b1: Point, b2: Point): Point | null => {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(b1, b2, a1) > 0;
  const d2 = side(b1, b2, a2) > 0;
  const d3 = side(a1, a2, b1) > 0;
  const d4 = side(a1, a2, b2) > 0;
  if (d1 === d2 || d3 === d4) return null;
  const aVertical = Math.abs(a1.x - a2.x) < 0.5;
  return aVertical ? { x: a1.x, y: b1.y } : { x: b1.x, y: a1.y };
};

/** Gap between a point and a node's box, 0 when the point is inside it. */
const pointToBoxSq = (p: Point, box: Box): number => {
  const dx = Math.max(0, box.x - p.x, p.x - (box.x + box.width));
  const dy = Math.max(0, box.y - p.y, p.y - (box.y + box.height));
  return dx * dx + dy * dy;
};

const totals: Record<string, number> = {};
const examples: string[] = [];
const detail = process.argv.includes("--detail");
/**
 * Restricts the matrix to fixtures whose path contains this substring, for
 * iterating on one drawing without paying for all 288. The ratchets are rates
 * over the *whole* corpus, so a filtered run cannot judge them — it reports the
 * counts and exits 0 regardless. Only an unfiltered run gates.
 */
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
/**
 * `--shard=i/n` sweeps every n-th fixture starting at i (1-based), so the matrix
 * can be split across parallel CI jobs. Like `--only`, a shard is a fraction of
 * the corpus and cannot judge a corpus-wide rate: it reports and exits 0. Sum
 * the counts across all n shards to compare against a ceiling.
 */
const shardArg = process.argv.find((arg) => arg.startsWith("--shard="))?.slice("--shard=".length);
const [shardIndex, shardCount] = shardArg
  ? shardArg.split("/").map((part) => Number.parseInt(part, 10))
  : [1, 1];
if (shardArg && (!(shardIndex >= 1) || !(shardCount >= 1) || shardIndex > shardCount)) {
  console.error(`--shard expects i/n with 1 <= i <= n, got "${shardArg}"`);
  process.exit(2);
}
const hits: string[] = [];
const failures: string[] = [];
let totalFlows = 0;

/**
 * Per-drawing floor, on top of the corpus-wide rates.
 *
 * The rates alone have a blind spot this repo has been bitten by: a change can
 * improve sixty drawings and quietly make one worse, and every total still
 * falls. `tests/__snapshots__/readability.baseline` records, per drawing ×
 * metric, the defect count last accepted — and **no drawing may exceed its
 * recorded count on any metric**. Improvements don't auto-lower the floor
 * (a partial run must never rewrite a gate); run with `--update-baseline` to
 * accept them, which merges only the drawings actually swept, so `--only` and
 * `--shard` runs update their slice and leave the rest untouched.
 *
 * Unlike the rates, this gate works on partial runs — each drawing is judged
 * against its own line — so `--only`/`--shard` runs do gate per-drawing even
 * though they cannot judge a corpus rate.
 *
 * A drawing absent from the baseline (a new fixture) is reported, not failed:
 * its debt is governed by the rates until `--update-baseline` records it.
 */
const BASELINE_PATH = join(ROOT, "tests", "__snapshots__", "readability.baseline");
const updateBaseline = process.argv.includes("--update-baseline");
const baseline = new Map<string, Map<string, number>>();
try {
  for (const line of readFileSync(BASELINE_PATH, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [tag, kind, count] = line.split("\t");
    if (!baseline.has(tag)) baseline.set(tag, new Map());
    baseline.get(tag)!.set(kind, Number.parseInt(count, 10));
  }
} catch {
  /* no baseline yet — every drawing is "new" until --update-baseline records it */
}
const perDrawing = new Map<string, Map<string, number>>();

for (const file of readdirSync(join(ROOT, "examples"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".cairn") && !f.includes("broken"))
  .filter((f) => !only || f.includes(only))
  .sort()
  .filter((_, index) => index % shardCount === shardIndex - 1)) {
  const base = readFileSync(join(ROOT, "examples", file), "utf8").replace(/\r\n/g, "\n");
  for (const disp of DISPOSITIONS) {
    const tag = `${file.replace(".cairn", "")}/${disp}`;
    let scene: Awaited<ReturnType<typeof layout>>;
    let model: ReturnType<typeof parse>["model"];
    let overlaps: number;
    try {
      // Parse first, then force the disposition post-parse — some fixtures
      // (examples/dispositions/*) carry their own `style { disposition }`,
      // and a source style must never win over the one this matrix cell tests.
      const parsed = parse(base);
      model = parsed.model;
      model.style.disposition = disp;
      const errors = [...parsed.diags, ...validate(model)].filter((d) => d.severity === "error");
      if (errors.length) {
        failures.push(`${file.replace(".cairn", "")}/${disp}: ${errors.length} validation error(s) — ${errors.map((d) => d.code).join(", ")}`);
        continue;
      }
      scene = await layout(model, views[model.type!]);
      overlaps = render(model, views[model.type!], scene).overlapsAfter;
    } catch (e) {
      failures.push(`${file.replace(".cairn", "")}/${disp}: exception — ${(e as Error).message}`);
      continue;
    }
    examples.push(tag);
    totalFlows += model.flows.length;
    const leaves = scene.nodes.filter((n) => !n.container);
    const note = (kind: string, msg: string) => {
      totals[kind] = (totals[kind] ?? 0) + 1;
      const mine = perDrawing.get(tag) ?? new Map<string, number>();
      mine.set(kind, (mine.get(kind) ?? 0) + 1);
      perDrawing.set(tag, mine);
      hits.push(`${kind.padEnd(13)} ${tag.padEnd(32)} ${msg}`);
    };

    if (overlaps > 0) note("overlaps", `${overlaps}`);

    const V: Run[] = [];
    const H: Run[] = [];
    for (const e of scene.edges) {
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i];
        const b = e.pts[i + 1];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx >= 0.5 && dy >= 0.5) note("diagonal", `${e.id}`);
        else if (dx < 0.5 && dy >= 0.5)
          V.push({ id: e.id, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
        else if (dy < 0.5 && dx >= 0.5)
          H.push({ id: e.id, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      }
      for (let i = 1; i + 2 < e.pts.length; i++) {
        const len =
          Math.abs(e.pts[i + 1].x - e.pts[i].x) + Math.abs(e.pts[i + 1].y - e.pts[i].y);
        if (len > 0 && len <= 20) note(len <= 6 ? "jog<=6" : "jog<=20", `${e.id} ${len.toFixed(1)}px`);
      }
    }

    for (const list of [V, H])
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.id === b.id) continue;
          const gap = Math.abs(a.at - b.at);
          const shared = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
          if (gap < 3 && shared > 8) note("coincident", `${a.id}~${b.id} gap=${gap.toFixed(1)}`);
          else if (gap < 10 && shared > 40)
            note("nearParallel", `${a.id}~${b.id} gap=${gap.toFixed(1)} run=${shared.toFixed(0)}`);
        }

    // A run crossing a *leaf* box is a bug; container interiors are routable.
    for (const s of H)
      for (const n of leaves)
        if (s.at > n.y + 1 && s.at < n.y + n.height - 1 && s.lo < n.x + n.width - 1 && s.hi > n.x + 1)
          note("throughBox", `${s.id} through ${n.id}`);
    for (const s of V)
      for (const n of leaves)
        if (s.at > n.x + 1 && s.at < n.x + n.width - 1 && s.lo < n.y + n.height - 1 && s.hi > n.y + 1)
          note("throughBox", `${s.id} through ${n.id}`);

    // `far` is the same attachment's opposite endpoint, projected on the axis
    // the side runs along: it says where the flow is *heading*, which is what
    // decides whether two attachments are seated in the wrong order.
    const seats = new Map<string, { at: number; far: number; id: string }[]>();
    for (const e of scene.edges) {
      if (!e.pts.length) continue;
      for (const [p, q] of [
        [e.pts[0], e.pts[e.pts.length - 1]],
        [e.pts[e.pts.length - 1], e.pts[0]],
      ] as const) {
        for (const n of leaves) {
          const wx = p.x > n.x - 2 && p.x < n.x + n.width + 2;
          const wy = p.y > n.y - 2 && p.y < n.y + n.height + 2;
          let side: string | null = null;
          if (wx && Math.abs(p.y - n.y) < 2) side = "north";
          else if (wx && Math.abs(p.y - (n.y + n.height)) < 2) side = "south";
          else if (wy && Math.abs(p.x - n.x) < 2) side = "west";
          else if (wy && Math.abs(p.x - (n.x + n.width)) < 2) side = "east";
          if (!side) continue;
          const vert = side === "east" || side === "west";
          const key = `${n.id}|${side}|${vert ? n.height : n.width}`;
          seats.set(key, [
            ...(seats.get(key) ?? []),
            { at: vert ? p.y : p.x, far: vert ? q.y : q.x, id: e.id },
          ]);
          break;
        }
      }
    }
    for (const [key, members] of seats) {
      if (members.length < 2) continue;
      const sideLength = Number(key.slice(key.lastIndexOf("|") + 1));
      const need = Math.min(12, (sideLength - 6) / (members.length - 1));
      const sorted = [...members].sort((a, b) => a.at - b.at);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].at - sorted[i - 1].at;
        if (gap < 6) note("attachShared", `${key} ${sorted[i - 1].id}~${sorted[i].id} ${gap.toFixed(1)}px`);
        else if (gap < need * 0.8) note("attachTight", `${key} ${gap.toFixed(1)}px need ${need.toFixed(1)}`);
      }
    }

    // Two flows leaving the same side of a node and tangling inside its fan —
    // the reader cannot tell which line owns which attachment point. Only the
    // fan counts: further out, two routes crossing is ordinary and not
    // something attachment order can fix. `inverted` marks the pairs seated in
    // the inverse order of their destinations, which are the ones reseating can
    // resolve outright.
    const edgeById = new Map(scene.edges.map((e) => [e.id, e]));
    const nodeById = new Map(leaves.map((n) => [n.id, n]));
    for (const [key, members] of seats) {
      if (members.length < 2) continue;
      const host = nodeById.get(key.slice(0, key.indexOf("|")));
      if (!host) continue;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          if (a.id === b.id) continue;
          const ea = edgeById.get(a.id)!;
          const eb = edgeById.get(b.id)!;
          let at: Point | null = null;
          for (let m = 0; m + 1 < ea.pts.length && !at; m++)
            for (let n = 0; n + 1 < eb.pts.length && !at; n++) {
              const hit = segmentsCross(ea.pts[m], ea.pts[m + 1], eb.pts[n], eb.pts[n + 1]);
              if (hit && pointToBoxSq(hit, host) <= FAN_REACH * FAN_REACH) at = hit;
            }
          if (!at) continue;
          const inverted = (a.at - b.at) * (a.far - b.far) < 0;
          note(
            "fanTangle",
            `${key} ${a.id}~${b.id} at ${Math.sqrt(pointToBoxSq(at, host)).toFixed(0)}px${inverted ? " inverted" : ""}`,
          );
        }
    }

    // A flow label has to be attributable to its own flow. Two ways it stops
    // being: it drifts off its own run, or another run gets closer to it than
    // its own does. Measured after `render`, because that is what settles label
    // positions — and because every geometry pass before it moves the line out
    // from under the box elk chose.
    for (const e of scene.edges) {
      if (e.pts.length < 2) continue;
      for (const l of e.labels) {
        if (!l.width || !l.height) continue;
        const own = boxToPolylineSq(l, e.pts);
        let nearestOther = Number.POSITIVE_INFINITY;
        let nearestId = "";
        for (const o of scene.edges) {
          if (o.id === e.id || o.pts.length < 2) continue;
          const d = boxToPolylineSq(l, o.pts);
          if (d < nearestOther) {
            nearestOther = d;
            nearestId = o.id;
          }
        }
        const text = l.text.replace(/\n/g, " ") || "(annotation)";
        if (own > LABEL_ADRIFT * LABEL_ADRIFT)
          note("labelAdrift", `${e.id} "${text}" ${Math.sqrt(own).toFixed(0)}px off its own run`);
        if (own > LABEL_ATTACHED * LABEL_ATTACHED && nearestOther < own)
          note(
            "labelOrphan",
            `${e.id} "${text}" own=${Math.sqrt(own).toFixed(0)}px ${nearestId}=${Math.sqrt(nearestOther).toFixed(0)}px`,
          );
        // A foreign run drawn *through* the box touches the text itself. Neither
        // rule above sees it: a label sitting on its own run has `own` of 0, so
        // it is inside `LABEL_ATTACHED` and nothing can be "closer" than its own
        // flow. Yet this is the worst case of all — two flows are touching the
        // words, and the reader has no cue at all which one is speaking.
        // Invariant §4d: the label's *text* sits on the run, not beside it.
        // Measured on the text rows, which occupy the top of the box — the box
        // centre is not the text centre whenever a protocol line or a chip
        // hangs below, and centring the box is what used to leave the run
        // running under the words instead of through them.
        const textCentre = {
          x: l.x + l.width / 2,
          y: l.y + (l.textH > 0 ? l.textH / 2 : l.height / 2),
        };
        const onRun = boxToPolylineSq(
          { x: textCentre.x, y: textCentre.y, width: 0, height: 0 },
          e.pts,
        );
        const onLine = onRun <= ON_LINE_SLACK * ON_LINE_SLACK;
        if (!onLine)
          note("labelOffLine", `${e.id} "${text}" text centre ${Math.sqrt(onRun).toFixed(0)}px off its run`);
        // A foreign run drawn *through* the box, for a label that is **not**
        // sitting on its own run. Charged only in that case, and deliberately:
        // once a label is on its flow, attribution is settled by position and
        // the crossing run is masked behind its halo (flow lines are all drawn
        // before any label). It is the floating label — beside one flow, with a
        // second drawn through its words — that leaves the reader guessing,
        // which is the defect this has always been about.
        if (!onLine && nearestOther <= PIERCE_SLACK * PIERCE_SLACK)
          note("labelPierced", `${e.id} "${text}" run ${nearestId} crosses its box`);
      }
    }

    // Invariant §4g: a flow takes at most two turns between its endpoints.
    for (const e of scene.edges) {
      if (e.pts.length < 2) continue;
      const turns = e.pts.length - 2;
      if (turns > 2) note("turnHeavy", `${e.id} ${turns} turns`);
    }

    // Invariant §4h: a run may only cross a container that holds one of its own
    // endpoints. Passing through a data centre or a zone you start or end
    // inside is how anything gets anywhere; cutting through one you have no
    // business in reads as traffic transiting that component. Invisible to
    // `throughBox`, which tests leaves only — `Kafka -> Backup server` ran the
    // width of `PostgreSQL standby` and nothing saw it.
    {
      const holds = new Map<string, Set<string>>();
      for (const box of scene.nodes.filter((n) => n.container)) {
        const set = new Set<string>();
        for (const n of scene.nodes)
          if (
            n !== box &&
            n.x >= box.x - 1 &&
            n.y >= box.y - 1 &&
            n.x + n.width <= box.x + box.width + 1 &&
            n.y + n.height <= box.y + box.height + 1
          )
            set.add(n.id);
        holds.set(box.id, set);
      }
      for (const e of scene.edges) {
        const flow = model.flows.find((f) => f.id === e.id);
        if (!flow || e.pts.length < 2) continue;
        for (const box of scene.nodes.filter((n) => n.container)) {
          const set = holds.get(box.id)!;
          if (set.has(flow.from) || set.has(flow.to)) continue;
          for (let i = 0; i + 1 < e.pts.length; i++) {
            const a = e.pts[i];
            const b = e.pts[i + 1];
            if (
              Math.min(a.x, b.x) < box.x + box.width - 1 &&
              box.x + 1 < Math.max(a.x, b.x) &&
              Math.min(a.y, b.y) < box.y + box.height - 1 &&
              box.y + 1 < Math.max(a.y, b.y)
            )
              note("throughContainer", `${e.id} ${flow.from}->${flow.to} through ${box.id}`);
          }
        }
      }
    }

    // Invariant §4f: flows that cross. Counted over the whole drawing, unlike
    // `fanTangle`, which only sees crossings inside a node's fan — the corridor
    // weave this exists to catch happens in open space between containers.
    for (let i = 0; i < scene.edges.length; i++)
      for (let j = i + 1; j < scene.edges.length; j++) {
        const A = scene.edges[i];
        const B = scene.edges[j];
        for (let m = 0; m + 1 < A.pts.length; m++)
          for (let n = 0; n + 1 < B.pts.length; n++)
            if (segmentsCross(A.pts[m], A.pts[m + 1], B.pts[n], B.pts[n + 1]))
              note("crossings", `${A.id}x${B.id}`);
      }

    // Invariant §4e: nothing is drawn across a container's title.
    for (const band of titleBoxesOf(scene, model)) {
      for (const e of scene.edges) {
        for (let i = 0; i + 1 < e.pts.length; i++) {
          const a = e.pts[i];
          const b = e.pts[i + 1];
          const x1 = Math.min(a.x, b.x);
          const x2 = Math.max(a.x, b.x);
          const y1 = Math.min(a.y, b.y);
          const y2 = Math.max(a.y, b.y);
          if (x1 < band.x + band.width && band.x < x2 && y1 < band.y + band.height && band.y < y2)
            note("titleStruck", `${e.id} run across title at (${band.x.toFixed(0)},${band.y.toFixed(0)})`);
        }
        for (const l of e.labels) {
          if (!l.width || !l.height) continue;
          if (
            l.x < band.x + band.width &&
            band.x < l.x + l.width &&
            l.y < band.y + band.height &&
            band.y < l.y + l.height
          )
            note("titleStruck", `${e.id} label across title at (${band.x.toFixed(0)},${band.y.toFixed(0)})`);
        }
      }
    }

    const pinned: [number, number][] = scene.nodes.map((n) => [n.y, n.y + n.height]);
    for (const e of scene.edges) for (const l of e.labels) pinned.push([l.y, l.y + l.height]);
    for (const s of H) pinned.push([s.at - 1, s.at + 1]);
    pinned.sort((a, b) => a[0] - b[0]);
    let reach = 0;
    let sceneBot = 0;
    for (const [top, bottom] of pinned) {
      if (top - reach >= 30) note("deadBand", `${Math.round(top - reach)}px at y=${Math.round(reach)}`);
      reach = Math.max(reach, bottom);
      if (bottom > sceneBot) sceneBot = bottom;
    }
    const remain = sceneBot - reach;
    if (remain >= 30) note("deadBand", `${Math.round(remain)}px trailing at y=${Math.round(reach)}`);

    // A terminal segment that sets off *away* from the flow's counterpart is a
    // wrap-around the reader has to chase: the eye leaves the node expecting to
    // approach the other end and is carried in the opposite direction first
    // (RETURNS→PAY_ORCH in application-large-tall departed 347px east for a
    // target up-and-left). Judged per axis with a tolerance: when the two nodes
    // roughly align on an axis (within `ATTACH_AWAY_TOL`), moving either way on
    // it is positioning, not wandering. Edges rerouted through detour channels
    // wrap by design (invariant §11) and are exempt.
    const ATTACH_AWAY_TOL = 24;
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const e of scene.edges) {
      if (e.pts.length < 2 || e.detour) continue;
      const flow = model.flows.find((f) => f.id === e.id);
      const from = byId.get(flow?.from ?? "");
      const to = byId.get(flow?.to ?? "");
      if (!from || !to) continue;
      const centerOf = (n: typeof from) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
      const away = (seg: Point, target: Point): boolean =>
        (Math.abs(seg.x) >= 0.5 &&
          Math.abs(target.x) > ATTACH_AWAY_TOL &&
          seg.x * target.x < 0) ||
        (Math.abs(seg.y) >= 0.5 && Math.abs(target.y) > ATTACH_AWAY_TOL && seg.y * target.y < 0);
      const p0 = e.pts[0];
      const p1 = e.pts[1];
      const pn = e.pts[e.pts.length - 1];
      const pm = e.pts[e.pts.length - 2];
      const toCenter = centerOf(to);
      const fromCenter = centerOf(from);
      if (away({ x: p1.x - p0.x, y: p1.y - p0.y }, { x: toCenter.x - p0.x, y: toCenter.y - p0.y }))
        note("attachAway", `${e.id} ${flow!.from}->${flow!.to} departs away`);
      if (
        away(
          { x: pn.x - pm.x, y: pn.y - pm.y },
          { x: pn.x - fromCenter.x, y: pn.y - fromCenter.y },
        )
      )
        note("attachAway", `${e.id} ${flow!.from}->${flow!.to} arrives from beyond`);
    }

    for (const e of scene.edges) {
      const flow = model.flows.find((f) => f.id === e.id);
      const a = byId.get(flow?.from ?? "");
      const b = byId.get(flow?.to ?? "");
      if (!a || !b) continue;
      let len = 0;
      for (let i = 1; i < e.pts.length; i++)
        len += Math.abs(e.pts[i].x - e.pts[i - 1].x) + Math.abs(e.pts[i].y - e.pts[i - 1].y);
      const direct =
        Math.abs(a.x + a.width / 2 - b.x - b.width / 2) +
        Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
      if (direct > 0 && len > 2.2 * direct && len - direct > 400)
        note("longDetour", `${e.id} ${flow!.from}->${flow!.to} r=${(len / direct).toFixed(1)}`);
    }
  }
}

console.log(
  `swept ${examples.length} drawings (${DISPOSITIONS.length} dispositions, ${totalFlows} flow-instances)\n`,
);
let failed = false;
for (const kind of MUST_BE_ZERO) {
  const count = totals[kind] ?? 0;
  console.log(`  ${count === 0 ? "✓" : "✗"} ${kind.padEnd(13)} ${count}  (invariant: must be 0)`);
  if (count > 0) failed = true;
}
for (const kind of Object.keys(CEILING_RATE).sort()) {
  const count = totals[kind] ?? 0;
  const rate = totalFlows > 0 ? count / totalFlows : 0;
  const ceiling = Math.ceil(CEILING_RATE[kind] * totalFlows);
  const ok = count <= ceiling;
  const arrow = count < ceiling ? ` — lower the rate to ${rate.toFixed(5)}` : "";
  console.log(
    `  ${ok ? "✓" : "✗"} ${kind.padEnd(13)} ${count}  (rate ${rate.toFixed(5)}/flow, ceiling ${ceiling} @ ${CEILING_RATE[kind]}/flow)${arrow}`,
  );
  if (!ok) failed = true;
}
// Per-drawing floor: judged for every swept drawing, partial run or not.
// A metric absent from the entire baseline file is newer than the file: its
// counts have no accepted floor yet, so it is reported through the rates only
// until `--update-baseline` records it — otherwise every drawing with any
// pre-existing debt on a brand-new metric would read as a regression.
const baselineKinds = new Set<string>();
for (const entry of baseline.values()) for (const kind of entry.keys()) baselineKinds.add(kind);
const allKinds = [...MUST_BE_ZERO, ...Object.keys(CEILING_RATE)].filter(
  (kind) => baseline.size === 0 || baselineKinds.has(kind),
);
const regressions: string[] = [];
const improvements: string[] = [];
const unknown: string[] = [];
for (const tag of examples) {
  const floor = baseline.get(tag);
  const mine = perDrawing.get(tag) ?? new Map<string, number>();
  if (!floor) {
    if ([...mine.values()].some((count) => count > 0)) unknown.push(tag);
    continue;
  }
  for (const kind of allKinds) {
    const now = mine.get(kind) ?? 0;
    const was = floor.get(kind) ?? 0;
    if (now > was) regressions.push(`${tag}: ${kind} ${was} -> ${now}`);
    else if (now < was) improvements.push(`${tag}: ${kind} ${was} -> ${now}`);
  }
}
if (regressions.length) {
  console.log(`\nper-drawing regressions vs baseline (${regressions.length}):`);
  for (const r of regressions) console.log(`  ✗ ${r}`);
  failed = true;
}
if (improvements.length)
  console.log(
    `\n${improvements.length} per-drawing improvement(s) — run with --update-baseline to lock them in`,
  );
if (unknown.length)
  console.log(
    `\n${unknown.length} drawing(s) not in the baseline — run with --update-baseline to record them`,
  );
if (updateBaseline) {
  // Merge only what was swept: a partial run must never touch the floors of
  // drawings it did not draw.
  for (const tag of examples) {
    const mine = perDrawing.get(tag) ?? new Map<string, number>();
    const entry = new Map<string, number>();
    for (const [kind, count] of mine) if (count > 0) entry.set(kind, count);
    if (entry.size) baseline.set(tag, entry);
    else baseline.delete(tag);
  }
  const lines = ["# per-drawing defect floors — regenerate with: npm run sweep -- --update-baseline"];
  for (const tag of [...baseline.keys()].sort())
    for (const kind of [...baseline.get(tag)!.keys()].sort())
      lines.push(`${tag}\t${kind}\t${baseline.get(tag)!.get(kind)}`);
  writeFileSync(BASELINE_PATH, `${lines.join("\n")}\n`);
  console.log(`\nbaseline updated for ${examples.length} swept drawing(s) → ${BASELINE_PATH}`);
}

if (detail) for (const h of hits) console.log(h);
if (failures.length) {
  console.log(`\nfailures (${failures.length}):`);
  for (const f of failures) console.log(`  ${f}`);
  failed = true;
}
const partial = only || shardArg;
if (partial) {
  console.log(`\npartial run (${only ? `--only=${only}` : ""}${only && shardArg ? " " : ""}${shardArg ? `--shard=${shardArg}` : ""}): rates above are informational — the per-drawing baseline still gates`);
  if (regressions.length) {
    console.error("\nsweep failed (per-drawing baseline)");
    process.exit(1);
  }
} else if (failed) {
  console.error("\nsweep failed");
  process.exit(1);
}
