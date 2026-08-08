# Flow routing implementation reference

Companion to [`ROUTING.md`](./ROUTING.md) — read that first for *why* this
pass exists and the concept behind it. This document is the code-level
detail for anyone editing `src/route-detour.ts` (970 lines, the largest file
in the repo) or `src/edge-tidy.ts`: constants, function names, and the
micro-decisions that took several rounds of review to get right.

## The transpose trick — implementation notes

`route-detour.ts` is written once, for a RIGHT-direction (`wide`/`slide`)
layout. `scene-layout.ts` transposes the scene across the diagonal before
calling it for a DOWN layout (`page`/`tall`), then transposes back — see
`ROUTING.md` for why. Two things do not rotate with the geometry:

- **Container titles** — their bands are computed by `titleBoxesOf` *before*
  transposing and passed in already in final orientation.
- **Label dimensions** — a label's width/height are swapped on the way in
  deliberately, since a vertical lane must be spaced by label *width*, not
  height.

**Verify the entry point is actually reached, not inferred from a passing
corpus** — for eight rounds of this work the pass was scoped to RIGHT-direction
layouts only, so `page`/`tall` kept elk's raw wraps untouched while every
other improvement silently passed them by. Grep the call site in
`scene-layout.ts`'s `sceneFromResult` when in doubt.

## Architecture of `route-detour.ts`

Pipeline inside the function, in order:

1. **Candidates** — leftward edges (`target center x < source center x`) whose
   elk path length ≥ `RATIO_THRESHOLD` (1.4) × direct manhattan distance AND
   wastes ≥ `MIN_WASTE` (300px). Sorted by numeric flow id for determinism.
   If none qualify: return before touching anything — this no-op path is
   what keeps untouched examples byte-identical.
2. **Obstacle model** — leaf nodes (containers are pierceable through their
   *horizontal* borders); container **title bands** (measured with
   `text-metrics` at the container font size, plus `TITLE_CLEARANCE` — edges
   draw last and titles carry no halo, so a riser crossing one strikes
   through the words); container **vertical borders** (a riser/descent may
   not run along a dashed edge); a registry of existing **vertical segments**
   (`usedVerticals`) and **horizontal segments** (`usedHorizontals`), seeded
   from non-candidate edges. Proximity rule for both registries: a hard 7px
   minimum for any overlap, *plus* `LINE_CLEARANCE` (12px) whenever the
   shared extent exceeds `MIN_PARALLEL_RUN` (40px) — two lines 8px apart
   running 170px read as one merged line, which a flat 7px test alone would miss.
3. **Planning** — per candidate, a fallback chain; first feasible wins:
   - **Bottom channel** (preferred): south riser out of the source, then
     entry via south riser into target → far-left west descent → east
     descent (entering the side facing the source) → near-west gutter
     descent. Every riser x is searched center-first through `RISER_DELTAS`
     (±72 max, clamped to the node).
   - **Top channel** (only when the south exit is blocked): north riser, lane
     above the content, entry via north riser → descend beside the target
     entering its **east** side first (these flows travel leftward, so the
     side facing the source avoids overshooting past the target) → far side
     (`westTop`) as fallback. Content may shift down if lanes rise above
     `y=4` — guarded on `topPlans.length` so bottom-only diagrams stay
     byte-identical.
   - **Side exits** (`exitVia`): a source hemmed in on both channel sides can
     still leave through its perpendicular edge, run clear of neighbors, then
     turn into the channel. This is the mechanism to reach for when a
     planning failure reports `southExit null northExit null`.
   - Descent deltas reach ±106px on purpose: a node inside a container is
     often reachable only from *outside* it, past both its border and title
     text overflowing it.
   - Entry **y** for side entries comes from `findEntryY`: center-first,
     bounded to the node ±4, avoiding (a) horizontal clashes ≥7px, (b) leaf
     boxes, (c) **foreign containers** — an entry segment may pierce only
     containers that geometrically contain the target, never thread between
     unrelated actors, and (d) the **attached-horizontal rule** — the
     approach descent must not cross a horizontal attached to the *same
     side* of the target (endpoint within 3px of the edge); horizontals
     merely passing by must NOT veto, or crowded sides become unroutable.
4. **Redistribution** — attachments sharing a node side get evenly spaced
   slots: free positions sampled at 2px across the side, picking
   `(i+1)/(n+1)` through the free list. Order is **travel direction first,
   then reach descending**: opposite-going flows diverge to opposite slots,
   and among same-going flows the longest reach sits outermost so channel
   spans **nest** rather than interleave (two channel flows can be drawn
   without crossing iff their spans are nested or disjoint — an interleaved
   pair forces at least one crossing). A side whose free range cannot hold
   the members `MIN_SLOT_GAP` apart is left alone — the flow that doesn't fit
   falls through to a side approach instead.
   Lane labels sit on the *outer* side of their lane, away from the drawing;
   lane spacing budgets the *previous* lane's label — both channels use this
   consistently (an earlier asymmetry between top and bottom channels showed
   up as an uneven gap around the content).
5. **Placement** — lanes via a first-fit interval allocator (shared when
   x-spans don't overlap), labels centered on the lane segment, numbered
   badges near the target. Scene width/height recomputed from actual extents
   (+10) — diagrams often *shrink* since the elk wrap defined the old
   dimensions.
   Lanes are handed out **innermost span first** via a topological pass over
   containment (containment is a partial order, not a total one — a sort is
   the wrong tool), so an enclosing span always gets the deeper lane.
   The channel anchors on the **node content only** — elk geometry outside it
   (its own wraps and their labels) is a *blocking band* that can nudge a
   lane, never an anchor; anchoring on it would push the whole channel past
   every stray wrap.
   A container holding **both ends** of every flow on a lane is exempt from
   that lane's anchor *and* blocking bands (`sharedEnclosers`) — a flow
   between two boxes of the same container belongs inside it. The exemption
   opens the container's interior only; its borders stay blocking (with
   `LINE_CLEARANCE` over a long shared run).
   Lane placement tries a tighter approach gap (10 → 8 → 6 → 4px) before
   pushing outward.
   Entry side (turning up beside the target vs. a longer approach) is
   **chosen, not fixed by a rule**: the shorter option is taken only when it
   lifts the lane by at least `MIN_DEPTH_GAIN` — a fixed order in either
   direction produces avoidable crossings.
   The anchor is **per lane**, over the nodes that lane's x-span actually
   overlaps (`spanAnchor`), not the drawing's full extent — anchoring
   globally lets an unrelated tall element on one side of the diagram hold
   every lane far below content it never passes under.
   Lane order stays monotone (a deeper lane never rises above a shallower
   one); node boxes are blocking bands so a raised lane cannot land on one —
   audit with "horizontal segments through a leaf box" (must be 0; a
   horizontal through a *container* is fine, elk legitimately routes through
   container padding).

Determinism rules: only `+ - * /`, `Math.round/ceil/min/max/abs`, fixed
iteration orders (numeric flow id, sorted group keys). `Math.hypot` is banned
here — it's reserved for numbered-flow labels in `scene-layout.ts`.

## `edge-tidy.ts` — the two rules that apply to *every* edge

Runs after the reroute, before compaction. Straighten first, then separate:
separation moves a terminal run rigidly, so it cannot reintroduce a jog
straightening just removed.

- **Guards on both moves.** Aligning a run, or sliding one 12px aside, must
  not park it on another flow. `runIsClear` mirrors the sweep's own
  coincidence/near-parallel metrics exactly (`gap < 4 && shared > 6`,
  `gap < 11 && shared > 36`).
- **Siblings are exempt from that guard** — flows leaving the same node side
  are parallel and close *by construction*; the guard would otherwise block
  the very separation it exists to perform.
- **Orthogonality is re-enforced after separation, not just after
  straightening** — a jog left in place (because straightening it would have
  merged two flows) can tilt when a later separation move shifts one of its
  ends. This is a fixpoint: fixing one segment can tilt its neighbor.
- **A terminal may slide along its side but never off its border** — a
  two-point flow has no interior point to absorb a shift, so both ends move
  together, only if the far end can follow.
- **Straightness couples the two sides a flow connects** — a straight run
  cannot be 12px apart at one end and 10px at the other, so a crowded side
  dictates the spacing at *both* ends. `MIN_ATTACH_GAP` is a target bounded
  by whichever side is tighter, not a bug to chase when it isn't met.

## Verifying a routing change holds everywhere

Per-example spot checks lie: a change can look clean on the diagram under
discussion while `page`/`tall` dispositions carry the same defect untouched.
Run `npm run sweep` (see [`READABILITY.md`](../READABILITY.md) for what it
measures and the current numbers) before claiming a routing fix works — and
run it on the full corpus, not just the example you were looking at.

**A wider straightening threshold is not a free knob** — one experiment
raising `JOG_SNAP` from 6 to 20 removed 264 staircases but introduced 24
flows dragged through node boxes, 12 merged lines, and 14 shared attachment
points, because every mutation in `edge-tidy.ts` (diagonal snap, jog
collapse, orthogonality fixpoint, separation) moves points and only some are
guarded. Doing this safely means guarding *all* of them against nodes and
other flows, then iterating the whole pass to a fixpoint — not raising the
ceiling.

## Known remaining work

- **elk's own near-parallel routes** — `large`/`large-fr` carry two
  horizontals 9px apart running ~1000px (`elk.spacing.edgeEdge: 9`),
  pre-existing and not fixable in this post-pass; would need the elk spacing
  raised (costs width) or a dedicated parallel-run separation pass.
- **The folded slide layout routes its own connectors**
  (`slide-fold.ts`) — it gets `edge-tidy` and compaction, but not this
  reroute, since it's a different layout strategy rather than an elk result
  to repair.
- **Converging approach runs** — two flows reaching the same node side can
  have their *approach* runs closer together than their attachments, since
  `edge-tidy.ts` only governs the terminal run and siblings are exempt from
  the merge guard. Fixing it means separating flows along their shared
  corridor, not just at the border.
- **Externally-blocked flows still use elk's wrap** when blocked on all
  sides (ratio > 3.5-ish) — would need an east-side channel symmetric to the
  west-side logic above, not yet built.
- **A container title directly above a narrow child** makes a top approach
  geometrically impossible without crossing the title text; the flow enters
  from the side instead. Giving container titles the same halo flow labels
  use (`paint-order="stroke"` in `svg-render.ts`) would allow crossing them
  legibly, but that's a style decision that restyles every diagram and
  re-baselines every snapshot — raise it explicitly before doing it.
- **Forced crossings from interleaved spans** are provably unavoidable by
  slot/lane ordering alone; reducing them needs a different channel
  assignment (e.g. splitting a channel into left/right halves).
- **Sparse-but-pinned bands** — `compact.ts` only removes a band that is free
  of nodes across the *whole* width, so a band pinned by an unrelated
  element elsewhere on the same row stays. The per-lane anchor (this pass)
  solves the common case upstream; the residual would need per-column
  compaction, i.e. re-layout.
- **Candidate selection for `slide`/`page`** scores elk candidates on raw
  pre-reroute, pre-compaction dimensions — scoring post-pass would pick
  better candidates but re-churns every disposition snapshot.
