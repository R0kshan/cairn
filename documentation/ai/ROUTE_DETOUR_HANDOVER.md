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
`scene-layout.ts` (RIGHT-direction layouts only; `page`/`tall` dispositions
are untouched). Issue #8 (manual placement, scoped by the maintainer as *full
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
   `text-metrics` at the container font size — a riser must never strike title
   text); container **vertical borders** (a riser/descent may not run along a
   dashed edge); a registry of existing **vertical segments** (`usedVerticals`,
   ≥7 px clearance when spans overlap) and **horizontal segments**
   (`usedHorizontals`, ≥7 px). Registries are seeded from non-candidate edges;
   candidates that fail planning contribute their elk verticals afterward.
3. **Planning** — per candidate, a fallback chain; first feasible wins:
   - **Bottom channel** (preferred — maintainer's explicit policy): south
     riser out of the source, then entry = south riser into target → far-left
     west descent → east descent (enter the side facing the source) →
     near-west gutter descent (mirror of westTop). Every riser x is searched
     center-first through `RISER_DELTAS` (±72 max, clamped to the node).
   - **Top channel** (only when the south exit is blocked): north riser, lane
     above the content, entry = north riser → near-west descent below the
     title band (`westTop`). Content may be shifted down afterward if lanes go
     above y=4 — the shift is guarded on `topPlans.length` so bottom-only
     diagrams stay byte-identical.
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
   obstacles fragment the range), pick `(i+1)/(n+1)` through the free list,
   members ordered by **far-end x** (left-going flow takes the left slot — this
   is what lets two flows share one lane with disjoint spans and zero
   crossings). A side whose free range is small (titles) spreads as far as it
   honestly can.
5. **Placement** — lanes via first-fit interval allocator (shared when x-spans
   don't overlap), labels centered on the lane segment (settled later by
   `svg-render`'s existing label-settling), numbered badges near the target.
   Scene width/height recomputed from actual extents (+10) — diagrams often
   *shrink* because the elk wrap defined the old width.

Determinism rules: only `+ - * /`, `Math.round/ceil/min/max/abs`, fixed
iteration orders (numeric flow id, sorted group keys). `Math.hypot` is banned
here (CLAUDE.md allows it only for numbered-flow labels in scene-layout).

## 4. Non-negotiables the maintainer added during review (beyond CLAUDE.md)

These came from four rounds of screenshot review; violating them will get the
work sent back:

- **Every flow individually traceable.** No coincident vertical (or
  horizontal) segments, no shared attach point. Flows must not start/end at a
  node's center when several share a side — spread by count, on **every**
  side.
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
  forbidden is *collinear overlap* and *junction ambiguity*.

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
  `|x1−x2| < 3` and y-overlap > 8. Must be 0 on every example.
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

## 7. Known remaining work (his "there's still improvements to make")

He hasn't enumerated them yet — interview him. Candidates observed:

- **F09-type wraps remain**: `logical-fr` `INTER_ASSUREURS→FRAUDE` (external
  column, blocked on all sides, ratio 3.7) and similar external-return flows
  still use elk's wrap. Would need an east-side channel (right of the
  externals column) — symmetric to the west logic, not built yet.
- **Lane sharing**: two flows may share one lane y with disjoint spans
  (e.g. logical-archi F10+F13). Space-efficient but colinear segments 34 px
  apart could be misread as one broken flow. One-line change to give each
  edge its own lane if he objects.
- **Title-constrained sides** (COORD north) can only spread ~12 px; a smarter
  option is routing one of the flows to a different side.
- Numbered-flow and `matrix --format svg` paths through the reroute are
  lightly exercised — `large-numbered` passes but hasn't been reviewed
  closely.
- The redistribution pass validates slots against *base* obstacles only;
  pathological cases (slot landing within 7 px of a failed candidate's elk
  vertical) are theoretically possible.

## 8. Working with the maintainer

Concise, direct, no flattery — he's a senior architect and wants best-practice
answers, not agreement. He reviews renders and annotates screenshots with red
tags; treat each tag as a precise, local defect report and confirm your
reading of it against the actual edge pts before coding. He explicitly asks to
be interviewed (option-style questions) when a design choice is his to make —
do it *before* implementing, with a recommended option first. Answer his
direct technical questions (e.g. "is this an elk limitation?") with evidence,
not hedging. He commits between rounds — check `git status` to see what's
already his baseline vs. your working delta.
