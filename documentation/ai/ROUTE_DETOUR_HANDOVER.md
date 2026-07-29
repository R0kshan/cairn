# Handover: flow-routing work (issue #26) — state, reasoning, and how to continue

Written 2026-07-28 by the agent that implemented `src/route-detour.ts`, for the
agent taking over. Read `CLAUDE.md` first; this document assumes it. The
general working method behind this work (how to diagnose, experiment, verify,
and interact with the maintainer) is in
[`WORKING_METHOD.md`](./WORKING_METHOD.md) — read both. Everything
here is either hard-won empirical knowledge, a decision the maintainer
(Røkshan) made explicitly, or a working method that proved out. Trust it, but
re-verify anything that contradicts the code — the code wins.

## 1. What this work is

Issue #26: elk routes some flows as huge wrap-around detours ("loops") in
large diagrams. Root cause and fix are in `src/route-detour.ts`, a
deterministic post-layout pass called from `sceneFromResult` in
`scene-layout.ts`.

**It applies to every disposition.** For eight rounds it did not — it was
scoped to RIGHT-direction layouts, so `page`/`tall` kept elk's raw wraps and
every improvement silently passed them by. The maintainer spotted it from a
portrait screenshot that had not changed at all. A DOWN layout is the same
problem rotated: its backward flows wrap around the sides and want left/right
channels. `scene-layout.ts` therefore **transposes the scene across the
diagonal** around the pass, so one implementation and one set of gated
invariants serve both. Two things do not rotate with the geometry: container
titles (computed by `titleBoxesOf` before transposing and passed in) and label
text — swapping a label's width and height on the way in is deliberate, since
a vertical lane must be spaced by label *width*.
Lesson worth keeping: when the maintainer says "every disposition", check that
the entry point is even reached before reporting the work as done — grep the
call site, don't infer it from a passing corpus. Issue #8 (manual placement, scoped by the maintainer as *full
position pinning*) is deliberately deferred until #26 is finished — do not
propose placement DSL yet.

## 2. The elkjs verdict (do not re-litigate without new evidence)

Backward (right-to-left) flows that cross container boundaries under
`elk.hierarchyHandling: INCLUDE_CHILDREN` are routed by elk's hierarchical
edge router: exit east of the outermost container, loop around the drawing.
**No layered option influences this.** Tested and proven byte-identical no-ops
on `examples/logical-fr.cairn`: `elk.layered.feedbackEdges` (true/false),
`elk.layered.cycleBreaking.strategy` (MODEL_ORDER, DEPTH_FIRST),
`elk.layered.wrapping.strategy`, `elk.layered.crossingMinimization.strategy`.
`thoroughness` 50/70/100 moves geometry but leaves the wraps (sometimes
worse). Hence the post-pass. If elk ships hierarchical libavoid-style routing
someday, revisit.

## 3. Architecture of `route-detour.ts`

Pipeline inside the function, in order:

1. **Candidates** — leftward edges (`target center x < source center x`) whose
   elk path length ≥ `RATIO_THRESHOLD (1.4) ×` direct manhattan distance AND
   wastes ≥ `MIN_WASTE (300)` px. Sorted by numeric flow id. If none: return
   before touching anything — the no-op path is what keeps untouched examples
   byte-identical.
2. **Obstacle model** — leaf nodes (containers are pierceable through their
   *horizontal* borders); container **title bands** (top-left, measured with
   `text-metrics` at the container font size, plus `TITLE_CLEARANCE` — edges
   are drawn *last* and titles carry no halo, so a riser crossing one strikes
   through the words); container **vertical borders** (a riser/descent may not
   run along a dashed edge); a registry of existing **vertical segments**
   (`usedVerticals`) and **horizontal segments** (`usedHorizontals`).
   Registries are seeded from non-candidate edges; candidates that fail
   planning contribute their elk verticals afterward.
   Proximity rule for both registries: a hard 7 px minimum for any overlap,
   *plus* `LINE_CLEARANCE` (12 px) whenever the shared extent exceeds
   `MIN_PARALLEL_RUN` (40 px) — two lines 8 px apart running 170 px read as
   one, which a flat 7 px test happily allows.
3. **Planning** — per candidate, a fallback chain; first feasible wins:
   - **Bottom channel** (preferred — maintainer's explicit policy): south
     riser out of the source, then entry = south riser into target → far-left
     west descent → east descent (enter the side facing the source) →
     near-west gutter descent (mirror of westTop). Every riser x is searched
     center-first through `RISER_DELTAS` (±72 max, clamped to the node).
   - **Top channel** (only when the south exit is blocked): north riser, lane
     above the content, entry = north riser → descend beside the target and
     enter its **east** side (`eastTop`, tried first: these flows travel
     leftward, so the side facing the source avoids running the lane past the
     target only to hook back) → descend on the far side (`westTop`). Content
     may be shifted down afterward if lanes go above y=4 — the shift is
     guarded on `topPlans.length` so bottom-only diagrams stay byte-identical.
   - **Side exits** (`exitVia`): a source hemmed in on both channel sides can
     still leave through its perpendicular edge, run clear of whatever sits
     beside it, then turn into the channel. For five rounds only *entries* had
     east/west fallbacks while exits were limited to two sides, so any boxed-in
     source silently kept elk's route — that is what made `medium-page`'s
     `INTERINSURER→FRAUD` ("Policyholder history") a 2275 px wander around the
     page (1508 px after, and 20 long detours removed corpus-wide). When a
     planning failure reports `southExit null northExit null`, this is the
     mechanism to reach for.
   - Descent deltas reach ±106 px on purpose: a node inside a container is
     often reachable only from *outside* that container, past both its border
     and the title text overflowing it. Too short a reach is why
     `logical-archi`'s `COM_CTR→OBS` kept elk's full-diagram wrap for four
     rounds — its only opening was 42 px out, and the list stopped at 34.
   - Entry **y** for side entries comes from `findEntryY`: center-first,
     bounded to the node ±4, avoiding (a) horizontal clashes ≥7 px, (b) leaf
     boxes, (c) **foreign containers** — an entry segment may pierce only
     containers that geometrically contain the target, never thread between
     actors of an unrelated group, and (d) the **attached-horizontal rule**:
     the approach descent must not cross a horizontal *attached to the same
     side* of the target (segment endpoint within 3 px of the edge). Inbound
     passes under outbound when arriving from below, over it from above.
     Horizontals merely passing by are ordinary hopped crossings — they must
     NOT veto, or crowded sides become unroutable (this bug cost an hour).
4. **Redistribution** — attachments sharing a node side get evenly spaced
   slots: free positions sampled at 2 px across the side (title bands and
   obstacles fragment the range), pick `(i+1)/(n+1)` through the free list.
   Order is **travel direction first, then reach descending**: opposite-going
   flows diverge (left-going takes the left slots), and among same-going flows
   the longest reach sits outermost so their channel spans **nest** instead of
   interleaving. A side whose free range cannot hold the members `MIN_SLOT_GAP`
   apart is **left alone**: the greedy positions from planning already clear
   each other, and cramming evenly-spaced slots into the strip left over beside
   a title puts two flows a few px apart. The flow that cannot fit then falls
   through to a side (east/west) approach — which is the right answer anyway,
   and is how `NET01→COM_CTR` came to enter its target from the right.
   *Why nesting matters:* two channel flows can be drawn without crossing iff
   their spans are nested or disjoint. Properly interleaved spans force at
   least one crossing (river-routing result) — so the slot order's job is to
   produce nesting, and the lane order's job is to exploit it.
4b. **Lane labels go on the *outer* side of their lane**, away from the
   drawing, and lane spacing budgets the *previous* lane's label. The top
   channel always did this; the bottom channel used to place labels between
   the content and the lane, so every bottom lane sat a whole label-width out
   while the top channel hugged its container — the asymmetry the maintainer
   saw as "unnecessary gap between the outward flows and the containers".
   Fixing it also shortened routes: corpus `longDetour` 102 → 88.

5. **Placement** — lanes via first-fit interval allocator (shared when x-spans
   don't overlap), labels centered on the lane segment (settled later by
   `svg-render`'s existing label-settling), numbered badges near the target.
   Scene width/height recomputed from actual extents (+10) — diagrams often
   *shrink* because the elk wrap defined the old width.
   Lanes are handed out **innermost span first** via a topological pass over
   containment (not a sort — containment is only a partial order), so an
   enclosing span always gets the deeper lane and flows that enclose nothing
   keep plain flow-id order and don't move. Lane spacing uses the label heights
   each lane actually carries, not the channel-wide maximum.
   The channel anchors on the **node content only**: elk geometry outside it
   (its own wraps and their labels) is a *blocking band* that nudges one lane
   where their x-spans overlap by more than `MIN_PARALLEL_RUN`, never an
   anchor. Anchoring on it instead — the original bug — pushed the whole
   channel past every stray wrap, wasting a band and forcing crossings.
   A container holding **both ends** of every flow on a lane is exempt from
   that lane's anchor *and* from its blocking bands (`sharedEnclosers`): a flow
   between two boxes of the same data centre belongs inside it, and counting
   its own container as an obstacle pushed the lane under the whole drawing,
   dragging the canvas down with it (`infrastructure` 467→436 px).
   The exemption opens the container's **interior only** — its borders stay
   blocking (with `LINE_CLEARANCE`, over a long shared run), or the lane ends
   up drawn 10 px under the box edge for 1000 px, which reads as a doubled
   border. Because that room is finite, lane placement first tries a **tighter
   approach gap** (10 → 8 → 6 → 4) before pushing outward: `infrastructure`
   missed fitting inside by 2 px on a fixed 10 px gap.
   Entry side is **chosen, not ordered**: turning up beside the target (east)
   keeps the lane short and therefore higher, but crosses whatever lies
   between, so it is taken only when it lifts the lane by at least
   `MIN_DEPTH_GAIN`. Making east unconditional cost `logical-fr` four
   crossings for 11 px; a fixed order in either direction is wrong.
   The anchor is otherwise **per lane**, over the nodes that lane's x-span
   actually overlaps (`spanAnchor`), not the drawing's full extent: in `logical-archi` a
   tall actor group at x 25–181 was holding every lane 137 px below content the
   lanes never pass under. Lane order is still monotone (a deeper lane never
   rises above a shallower one), and node boxes are blocking bands so a raised
   lane cannot land on one — audit with "horizontal segments through a leaf
   box", which must be 0 (a horizontal through a *container* is fine, elk
   routes through container padding legitimately).
   `LINE_CLEARANCE` keeps a lane from running alongside an elk horizontal close
   enough to read as one thick line; scoping it to long shared runs matters,
   since padding *every* short segment cost `large` 24 px and 8 crossings.

Determinism rules: only `+ - * /`, `Math.round/ceil/min/max/abs`, fixed
iteration orders (numeric flow id, sorted group keys). `Math.hypot` is banned
here (CLAUDE.md allows it only for numbered-flow labels in scene-layout).

## 4. Non-negotiables the maintainer added during review (beyond CLAUDE.md)

These came from four rounds of screenshot review; violating them will get the
work sent back:

- **Every flow individually traceable.** No coincident vertical (or
  horizontal) segments, no shared attach point. This is the target, not yet
  the gate: `npm run sweep` carries `coincident` and `attachShared` as
  **ceilings** (see CLAUDE.md invariant 4), because the corpus still has a
  handful the current passes cannot remove. They may only fall — treat a new
  one as a regression even though the ceiling would absorb it. Flows must not
  start/end at a node's center when several share a side — spread by count, on
  **every** side.
- **No line collinear with a container border.**
- **No arrow ambiguity at entries**: an approach must not cross another flow
  attached to the same side right at the node edge (inbound under outbound).
- **No entry segment threading through an unrelated container's interior.**
- **Never strike container title text with a riser.**
- **`examples/logical-fr.svg` is maintainer-approved output.** Keep it
  byte-identical unless he asks. `cmp` it after every change — it's the
  canary for the bottom-channel path (test exists in `behavior.test.ts`, but
  the byte-compare catches more).
- Perpendicular crossings are acceptable (crossingHops renders them); what is
  forbidden is *collinear overlap* and *junction ambiguity*. A near-parallel
  run counts as collinear: prefer extra perpendicular crossings over two lines
  drifting alongside each other.
- **Two flows sharing a node side must not cross each other**, and a flow
  entering from a channel must not cross a flow attached to the same side.
- **No flow shares an attachment point with another**, on any side, inbound or
  outbound (`edge-tidy.ts`, target `MIN_ATTACH_GAP`).
- **A flow whose ends share a container stays inside it** — leaving it costs
  height and reads as though the flow left the system it belongs to.
- **Every segment is orthogonal, and a run is straight until it really turns** —
  deviations under `SNAP` are elk noise and get collapsed.
- **No dead height**: a band crossed by nothing but vertical segments is a
  defect, in every disposition (`compact.ts`, gated at 30 px).

## 5. Verification workflow that works (sandbox has no browser)

- Fast loop: `node --experimental-strip-types src/cli.ts build examples/X.cairn -o /tmp/x.svg`
  — the output line already reports dimensions and `label overlaps: N`.
- **Visual check**: `pip install cairosvg --break-system-packages`, but first
  strip the label halo or text renders as white blobs:
  replace `stroke="#ffffff" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round"` with ``
  then `cairosvg.svg2png(...)` and view the PNG. Always eyeball before
  re-baselining — the maintainer reviews renders closely and tags defects.
- **Coincidence audit** (regression check for the "unmerged flows" rule):
  parse `<path d="...">`, collect vertical segments, count pairs with
  `|x1−x2| < 3` and y-overlap > 8. Must be 0 on every example. Also count
  **near-parallel** pairs (axis distance < 10, shared run > 40) — a 3 px
  threshold misses two lines 7 px apart running 600 px, which reads as one.
- **Crossing + waste audit**: build the scene in-process, split edges into
  vertical/horizontal segments, count perpendicular crossings between
  *different* edges, and find y-bands pinned by no node/label/horizontal
  ("dead bands"). Run it against a baseline copy of the repo
  (`cp -r` + `git show HEAD:src/... > copy`) for a real before/after table;
  a `--disp=` flag that injects `style { disposition: … }` (same trick as
  `behavior.test.ts`) covers the other dispositions.
  Round-6 baseline → after: `logical-archi` 1078→986 px / 19→16 crossings /
  159→53 px waste, `large` 1109→1077, `small` 353→287,
  `small-slide` 529→288, `small-page` 1075→774, `infrastructure-medium-tall`
  1131→948, `medium-slide` 864→626. Round 7 (per-lane anchor) took
  `logical-archi` 986→849 with crossings unchanged at 16. Round 8 (side
  approaches + parallel-run clearance) took it to 821 / 15 crossings and
  removed its last elk wrap; `application` went 1→0 crossings.
  Note `large`/`large-fr`/`application-compact` each keep one or two
  near-parallel pairs that are **elk's own** edges (`elk.spacing.edgeEdge: 9`)
  — check a flagged pair's edge ids before assuming the post-pass caused it.
- **Leaf-box audit**: no edge segment may pass through a leaf node's interior —
  check **both** axes. Vertical runs were missed for several rounds precisely
  because the audit only looked at horizontal ones, so a clean result on one
  axis proves nothing. Cheap to compute and the direct regression check for
  any change that raises lanes toward the content.
- **Detour metrics**: for each edge, path length vs manhattan distance between
  node centers; ratio > 1.4 && waste > 300 = detour. Compare before/after
  across all examples — every changed example must improve or hold.
- Instrument-in-a-copy: `cp -r` the repo to `/tmp`, add `console.error` probes
  to the copy, never to the real tree.
- Gates, in CONTRIBUTING.md order: `npm test` → `npm run snapshots:report`
  (review; geometry moving is the risky kind) → `npm run snapshots` →
  `npm run typecheck` → `npm run lint` → `npm run build:playground` (committed
  bundles drift otherwise). **`npm run test:binary` needs Bun and was never
  run in this environment — flag it to the maintainer before any merge.**
- Full `npm test` takes ~25–60 s; don't chain too many commands in one shell
  call or it times out (45 s cap per call in this environment).

## 6. Decision log (maintainer's explicit choices — don't re-ask)

- #26 before #8; one feature at a time. #8 = full position pinning, later.
- Bottom channel preferred, top channel only as fallback ("south first") —
  chosen specifically to keep approved outputs stable over global optimality.
- North entry over far-west descents for low targets (accepted group
  piercing), but title bands still win over spreading.
- Broad snapshot re-baselines are fine **when** `snapshots:report` is reviewed
  and renders verified; "never regenerate to silence a diff you don't
  understand" stands.
- There is no "contributing-to-cairn" skill — when he says that, he means
  `CONTRIBUTING.md`.

## 6b. `edge-tidy.ts` — the two rules that apply to *every* edge

Runs after the reroute, before compaction. Straightening first, then
separation: separation moves a terminal run rigidly, so it cannot reintroduce
the jog straightening just removed. Hard-won details:

- **Guards on both moves.** Aligning a run, or sliding one 12px aside, must not
  park it on another flow. `runIsClear` mirrors the two audit metrics exactly
  (`gap < 4 && shared > 6`, `gap < 11 && shared > 36`) — thresholds a hair
  looser than the metric let two regressions through unnoticed.
- **Siblings are exempt from that guard.** Flows leaving the same node side are
  parallel and close *by construction*; including them made the guard block the
  very separation it was meant to protect.
- **Orthogonality must be re-enforced after separation**, not just after
  straightening: a jog left in place (because straightening it would have
  merged two flows) tilts when a separation move shifts one of its ends. It is
  a fixpoint loop — fixing one segment tilts its neighbour.
- **A terminal may slide along its side but never off its border**; a two-point
  flow has no interior point to absorb a shift, so both ends move together, and
  only if the far end can follow.
- **Straightness couples the two sides a flow connects.** A straight run cannot
  be 12px apart at one end and 10px at the other, so a crowded side dictates
  the spacing at *both* ends. This is why the gate asserts "never share or
  graze a point" as the hard rule and treats `MIN_ATTACH_GAP` as a target
  bounded by what the tighter side allows — not a bug to chase.

## 6c. The sweep — run it before claiming anything is fixed everywhere

`documentation/ai/` has no scripts, so keep this one to hand: build every
example × every disposition (`wide/slide/page/tall`) in one process and count
violations per kind — overlaps, non-orthogonal segments, staircases (by size),
shared/tight attachments, coincident and near-parallel runs, runs crossing a
node box (**both** axes — an earlier check only tested horizontals and missed
26 vertical cases), dead bands, and detours over 2.2× direct.

Two findings that only a full sweep surfaces:

- **Per-example spot checks lie.** Everything looked clean on the diagrams
  under discussion while `page`/`tall` carried the defects untouched.
- **Widening the straightening threshold is not a knob.** `JOG_SNAP` 6 → 20
  removes 264 staircases but introduces 24 flows dragged through node boxes,
  12 merged lines and 14 shared attachment points, because every mutation in
  `edge-tidy` (diagonal snap, jog collapse, orthogonality fixpoint, separation)
  moves points and only some are guarded. Doing this properly means guarding
  *all* of them against nodes and other flows, then iterating the whole pass to
  a fixpoint — not raising the number.

Current sweep state (JOG_SNAP = 6), 108/108 cells rendered: invariants
`overlaps 0, diagonal 0, throughBox 0, deadBand 0`; ceilings `attachShared 2,
attachTight 4, coincident 9, jog≤6 64, jog≤20 229, nearParallel 39,
longDetour 88`. The ceilings are the ratchet — a run fails if any of them
grows, and the number here must match `CEILING` in `scripts/sweep.ts`.

Next two pieces, in order of value: restructure `edge-tidy` so every mutation
is guarded and the pass iterates to a fixpoint (unlocks the ~290 staircases
safely), then look at the remaining `longDetour` cases — the side-exit work
took the obvious ones, so what is left needs inspecting individually rather
than a new mechanism.

## 7. Known remaining work

Round 6 (crossings + compaction) is done; measured state below. Candidates:

- **elk's own near-parallel routes**: `large`/`large-fr` carry two horizontals
  9 px apart running ~1000 px (`F12`/`F13`), from `elk.spacing.edgeEdge: 9`.
  Pre-existing, not ours, and not fixable in the post-pass — it would need the
  elk spacing raised (costs width) or a parallel-run separation pass.
- **Legend overflows a narrow canvas**: on portrait/small diagrams the legend
  band emits text out to x≈584 regardless of the scene width, so it is clipped
  by the viewBox (`dispositions/small-page`, both before and after the DOWN
  routing work — pre-existing, in `svg-render.ts`, not a routing bug).
- **The folded slide layout still routes its own connectors** (`slide-fold.ts`)
  — it now gets `edge-tidy` and compaction, but not the detour reroute, since
  it is a different layout strategy rather than an elk result to repair.
- **Converging approach runs**: in `large-fr`, `F04`/`F06` reach the same node
  side and their approach runs sit 5.9 px apart over 114 px, though the
  attachments themselves are 8.2 px apart. `edge-tidy` only governs the
  terminal run, not the whole approach, and siblings are exempt from the merge
  guard. Fixing it means separating flows along their shared corridor, not just
  at the border. The behaviour gate covers six examples — `large-fr` is not one
  of them, so widen it if you take this on.
- **F09-type wraps remain**: `logical-fr` `INTER_ASSUREURS→FRAUDE` (external
  column, blocked on all sides, ratio 3.7) and similar external-return flows
  still use elk's wrap. Would need an east-side channel (right of the
  externals column) — symmetric to the west logic, not built yet.
- **A literal "enter from the top" is impossible under a container title.**
  In `logical-archi` the `Role group - Remote site` title spans x 74–267 while
  its only actor spans 79–180, so every vertical approach to that actor's top
  crosses the text; the flow enters from the side instead. Changing this needs
  a *style* decision, not a routing one: give container titles the same halo
  flow labels already use (`paint-order="stroke"`, `svg-render.ts`), after
  which a line may cross a title legibly. Ask before doing it — it restyles
  every diagram and re-baselines every snapshot.
- **Forced crossings**: `logical-archi` is down to 16 (from 19) and `large`
  holds at 78. The remainder are interleaved-span crossings, which are
  provably unavoidable by ordering alone; reducing them needs a different
  channel assignment (e.g. splitting a channel into left/right halves).
- **Sparse-but-pinned bands**: `compact.ts` only removes bands free of nodes
  across the *whole* width, so where an actor group pins a band that is empty
  in the centre the space stays. The common case — a channel lane held far
  from the content it serves — is now solved upstream by the per-lane anchor
  instead (round 7); what remains would need per-column compaction, i.e.
  re-layout. Note the lesson: "a node pins the band" was the right rule for
  the compaction pass but the wrong answer to the user's complaint, because
  the real fix belonged in the routing, not the compaction.
- **Candidate selection ignores the post-passes**: `slide`/`page` pick among
  elk candidates by fit score computed on elk's raw dimensions, before reroute
  and compaction change them. Scoring post-pass would pick better candidates
  but re-churns every disposition snapshot.
- **Title-constrained sides** (COORD north) can only spread ~12 px; a smarter
  option is routing one of the flows to a different side.
- Numbered-flow and `matrix --format svg` paths through the reroute are
  lightly exercised — `large-numbered` passes but hasn't been reviewed
  closely.

## 8. Working with the maintainer

Concise, direct, no flattery — they are a senior architect and wants best-practice
answers, not agreement. They reviews renders and annotates screenshots with red
tags; treat each tag as a precise, local defect report and confirm your
reading of it against the actual edge pts before coding. They explicitly asks to
be interviewed (option-style questions) when a design choice is his to make —
do it *before* implementing, with a recommended option first. Answer their
direct technical questions (e.g. "is this an elk limitation?") with evidence,
not hedging. They commits between rounds — check `git status` to see what's
already his baseline vs. your working delta.
