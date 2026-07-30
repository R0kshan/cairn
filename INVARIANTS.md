# Non-negotiable invariants

These invariants must never be broken. Every change is verified against them.

## 1. Zero label overlaps

Every example builds with `label overlaps: 0` (CI-gated).

## 2. Byte-deterministic output

Same input → identical SVG across runs and platforms. Only `+ - * /`, `round`,
`ceil`, and one normalized `Math.hypot` are allowed in the output path. Never
introduce `Date.now()`, randomness, or locale-formatted numbers.

## 3. Readability is gated by `npm run sweep`

Sweeps every `.cairn` fixture × every disposition. Seven invariants must stay at
**0**: label overlaps, segments off orthogonal, runs crossing a leaf box, dead
horizontal bands, coincident segments, shared attachment points, and labels
adrift from their own flow (§4a). The rest (staircases, tight attachments,
near-parallel runs, long detours, orphaned labels, pierced labels, fan tangles,
wrap-around attachments §4c, labels off their line §4d, struck titles §4e, crossings §4f) are a **ratchet** — expressed as a rate per swept flow-instance (not a raw count) so
adding fixtures doesn't spuriously fail the gate. Current rates are ceilings
that may only fall. Lower a rate when a change earns it; never raise one to go
green.

**No individual drawing may regress on any metric.** The corpus-wide rates have
a blind spot this repo has been bitten by: a change can improve sixty drawings,
quietly make one worse, and every total still falls.
`tests/__snapshots__/readability.baseline` records the accepted defect count per
drawing × metric; exceeding any recorded count fails the sweep. Improvements are
locked in with `npm run sweep -- --update-baseline` — floors only fall, like the
rates. Treat the baseline like a snapshot: never regenerate to silence a
regression you don't understand.

`--only=<substring>` and `--shard=i/n` restrict the matrix for iteration and CI
parallelism. Partial runs report the rates without gating them — a rate over
part of the corpus cannot judge a corpus-wide ceiling — but the per-drawing
baseline still gates, since each drawing is judged against its own line.

## 4. Flow labels

Flow labels are **required** on logical view (`E0203`), optional on
application & infrastructure. Infrastructure flows must still carry
`protocol/port` (`(HTTPS/443)` — `E0240`) even when unlabelled.

### 4a. Every label belongs to a visible flow

Where a label sits is §4d; this section is about which flow it names. A reader
must never have to guess which run a label annotates. Three rules, all
swept, catching three different ways attribution fails:

- **`labelAdrift` — must be 0.** No label sits more than 20px from its own
  polyline. `src/label-anchor.ts` re-centres labels on their own route after
  the passes that move routes (`route-detour`, `edge-tidy`) and *before*
  `compact`, which measures where labels are.
- **`labelOrphan` — ratchet.** No other flow's run may be closer to a label
  than its own, once the label is more than 6px off its own run. Inside 6px it
  is visibly sitting on its run and a grazing neighbour changes nothing.
- **`labelPierced` — ratchet.** No foreign run may be drawn *through* the box of
  a label that is **off** its own line (§4d). Neither rule above sees this: a
  floating label sits beside one flow while a second crosses its words, and
  distance alone cannot tell them apart. On-line labels are exempt — their run
  is masked behind the halo and position already settles attribution. Because a
  pierced label need not overlap anything, `settleLabelPositions` moves a label
  when it is *either* colliding or unattributable, not on collision alone.

All three fight invariant §1. An overlapping label is unreadable; an ambiguous
one is only misleading, so **zero overlaps wins**. `settleLabelPositions` tries
every escape that preserves attribution first — including re-seating the label
on a different run of the same flow — and only then a round that abandons it.
That relaxed round is the one path that can break `labelAdrift`. If it ever
fires, widen the attribution search; do not move the gate.

What is left in the two ratchets is one shape of problem: a corridor of flows
`MIN_ATTACH_GAP` (12px) apart, where a two-line label carrying a business-object
chip is simply taller than any gap between the runs. No placement can win there;
the bundle has to be spread instead.

### 4b. Flows leaving one node side must not tangle in its fan

Two flows attached to the same node side must not cross each other within 48px
of that node (`fanTangle`, ratchet). Spreading attachment points is pointless if
the runs immediately cross back over each other.

This is **not** fixable after routing. Reseating a flow without rerouting its
body just moves the tangle further along: a seat-permutation pass measured
across the corpus cut the inverted cases from 207 to 26 while pushing total
crossings from 287 to 501, and broke `coincident` and `nearParallel`. The real
fix is port ordering inside the elk graph.

### 4c. A flow's terminals face its counterpart

A terminal segment must not set off *away* from the flow's other end, nor
arrive from beyond it, when the two nodes are genuinely offset (>24px) on that
axis — a flow that leaves eastward for a target up-and-left sends the reader's
eye the wrong way before doubling back (`attachAway`, ratchet). Edges routed
through §11 channels that keep their channel are exempt: their wrap is the
design.

The same pass also re-sides a flow that **crosses its own return leg** — the
other flow joining the same two nodes the opposite way. A round trip is the one
case where a crossing is never necessary, because the two legs can always nest,
so a tangle-driven candidate may be up to 64px *longer* than what it replaces
(untangling usually means entering from the far side rather than cutting across
your partner). In `logical` the pair COMPENSATION↔SUPERVISOR crossed because the
return leg rose to the container's west side at x=1550 while the outbound leg ran
left at y=439 from x=1628 — and *every* riser position between the two nodes
crosses that run, so no interior lane can fix it (§4f leaves it alone for exactly
that reason). Entering from the south at x=1646, outside the outbound leg, does.

Restricted to the return leg on purpose: widening it to any flow merely *sharing*
an endpoint was measured and rejected, since it disturbed three `large-slide`
drawings for tangles that were not structurally avoidable.

The reroute pass in `edge-tidy` replaces a wrap-around with the direct L or Z
between facing sides **only when it can prove the replacement clean**: no node
crossed, no other flow merged into, no seated label pierced, no container title
band struck, no container border ridden, no new fan tangle, no crowding of an
occupied side, the edge's own labels re-seatable, and strictly shorter. If any
check fails, the wrap stays — a wrap is a blemish, each of those is worse. Do
not weaken a check to reroute more; the remainder needs elk port constraints.

### 4d. Labels sit **on** their flow, never beside it

A flow label's **text** is centred on its own run — not above, below, left or
right of it (`labelOffLine`, ratchet). The run passes behind the words and is
masked by the label's halo, so the text is not struck through; a protocol line
and any business-object chips hang below the line, under the text they belong to.

Two mechanics make this work, and both are load-bearing:

- **Text, not box.** The text rows sit at the *top* of the label box; centring
  the box puts the run between the text and the chip — under the words, which is
  exactly what "on the line" is not. `SceneLabel.textH` carries the text height
  so `label-anchor` and the sweep centre the same thing.
- **All flow lines are drawn before any label.** The halo can only mask a line
  already on the canvas. While the renderer emitted each edge's path and its
  labels together, a label's halo hid its own flow and nothing else, so every
  edge drawn afterwards struck straight through the words.

The escape ladder is ordered by what it costs the reader: seats *along* the run
first (sliding never leaves the line), then off-line seats that keep
attribution, then anything overlap-free. A pierced seat on the run beats a clean
one beside it, because a crossing run is masked while a floating label is not —
which is why `labelPierced` only counts labels that are already off their line.

### 4e. Nothing is drawn across a container's name

No run and no label may cross a container's title band (`titleStruck`, ratchet).
Edges are emitted after every box and a title carries no halo, so anything
crossing one strikes through the words — in `infrastructure-large` a flow ran
the length of the "K8s cluster business" title with its own label parked on top.

`route-detour` has always treated title bands as obstacles when planning a
channel; elk never learned to, so the runs it plans itself go straight through.
The repair pass in `edge-tidy` slides an offending **interior horizontal** run
clear of the band — below it first, since a container's body is routable and its
name is not — validated like every other mutation here, and refused if it would
leave a neighbouring segment shorter than `JOG_SNAP` (a struck title traded for
a visible wobble is not a fix: without that guard, 9 drawings gained a sub-6px
jog).

Vertical runs are **not** repaired yet, which is most of the remaining 1058:
`page`/`tall` layouts are transposed, so their band crossings are vertical.
Lowering this rate means teaching the pass to shift a riser sideways, or giving
elk the bands as obstacles in the first place.

### 4f. Corridor risers nest, they do not interleave

Flows crossing the same corridor almost always keep their relative order end to
end — and flows that never change order never *need* to cross (`crossings`,
ratchet). When they do, it is because their vertical risers sit in the wrong
left-to-right order: `infrastructure-large` had three flows in strict
top-to-bottom order at both ends crossing four times, purely because the one
descending deepest turned last instead of first.

This is the rule `route-detour` already applies to its channels ("travel
direction first, then reach descending, so spans **nest** instead of
interleave"), here for ordinary traffic. Two things make it safe where two
earlier attempts at rearranging routes were not:

- **The lanes are a fixed set; only their owners change.** Every x a group uses
  was already legal for some flow, so no new corridor is invented and whatever
  made those lanes legal still holds.
- **Permutations are scored, never reasoned about.** Hand-derived orderings were
  wrong twice. A pairwise swap of those three flows fixes its own pair (2
  crossings → 0) and costs 2 elsewhere, because the correct answer is a 3-cycle
  no swap can express. So the pass applies every permutation of a group's lanes,
  validates each, counts crossings across the **whole drawing**, and keeps the
  best only if it is strictly better overall.

Groups are the connected components of "these two flows actually cross" — no
corridor width to guess at, and by construction only flows that have a defect
are touched. Capped at 4 members (24 permutations, exhaustively scored); larger
tangles are not a lane-ordering problem and guessing at them is how a pass
starts shuffling damage around. The riser taken is the one nearest the target:
requiring exactly one riser per flow made the first version a no-op on the very
case it was written for, because the flow at the centre of the tangle turned
twice.

## 5. Security

All user text is escaped before SVG emission (`esc()` / `escAttr()`). Reserved
keys (`__proto__`, `constructor`, `prototype`) are rejected at parse time.
Every security fix ships with its exploit as a regression test.

## 6. Diagnostics are coded, never thrown

Errors `E0xxx`, warnings `W0xxx`, each with a `span` + `help`; rationale in
`explanations` (via `cairn explain`). A user error is a `Diagnostic`, not an
exception.

## 7. Nesting rules

Element kinds are per-view (`views` registry). Nesting rules are enforced per
view (`E0210–E0218`). Business objects are logical-view only (`E0222`
elsewhere). Duplicate IDs are rejected (`E0202`). Dangling flow references are
rejected (`E0220`).

## 8. Every flow is a distinct edge

Flows are never visually merged. Each declared flow corresponds to exactly one
scene edge with its own label and arrow.

## 9. Layout reading order

For `wide`/`slide` dispositions, actor-group elements (user-facing sources) are
placed on the left; external systems stay on the right. For `tall`/`page`
dispositions, they go on the top and bottom respectively. The infrastructure
view models users as actors (person glyph) on the entry side.

## 10. Slide / page orientation

`slide` must be landscape (width ≥ height). `page` must be portrait (height ≥
width). These are hard layout constraints.

## 11. Backward flow rerouting

Backward hierarchical edges that cross container boundaries must never be left
as elk's native wrap-around detours. The dedicated top/bottom channels are the
default replacement; the §4c reroute may substitute a **validated, strictly
shorter direct route** for a channel — the channel planner never tries direct
routes, so this is the only path to one. Priority: direct beats channel beats
elk wrap. Rerouting applies to every disposition. Deterministic: no-op
(byte-identical scene) when nothing qualifies.

## 12. Element kind validity per view

Element kinds are restricted by view. Examples: `queue` is valid only in
application & infrastructure; `gateway`, `auth`, `idp` only in infrastructure;
`trust-zone`, `security-node`, `asset` only in security; `datastore` renders as
cylinder; business objects are logical-view only. Unknown element kinds for the
active view are rejected (`E0201`).

## 13. `cairn new` must not overwrite files

The `new` command uses `O_CREAT|O_EXCL` (`wx` flag) for atomic exclusive
creation. It exits with code 2 if the target file already exists, leaving the
existing file untouched.

## 14. Snapshot & corpus gates

`npm test` includes three regression layers against committed reference files:
structural digest (geom/color/text per example), example-SVG fidelity
(committed `examples/*.svg` stay in sync), and detailed snapshots (one per
view + themes + matrix exports). All snapshots are normalized to 1dp to absorb
cross-platform floating-point variation. Never regenerate to silence a diff you
don't understand.

## 15. Flow matrix export invariants

The matrix (csv/md/svg) splits protocol from port, annotates each endpoint with
its network zone (infrastructure), and localises headers via `style { lang: fr
}`. Matrix output is byte-deterministic like SVG.
