# Non-negotiable invariants

These invariants must never be broken. Every change is verified against them.

## Contents

- [At a glance](#at-a-glance) — what enforces what
- [1. Zero label overlaps](#1-zero-label-overlaps)
- [2. Byte-deterministic output](#2-byte-deterministic-output)
- [3. Readability is gated by `npm run sweep`](#3-readability-is-gated-by-npm-run-sweep)
  - [A guard must measure what the invariant measures](#a-guard-must-measure-what-the-invariant-measures)
- [4. Flow labels](#4-flow-labels)
  - [4a. Every label belongs to a visible flow](#4a-every-label-belongs-to-a-visible-flow)
  - [4b. Flows leaving one node side must not tangle in its fan](#4b-flows-leaving-one-node-side-must-not-tangle-in-its-fan)
  - [4c. A flow's terminals face its counterpart](#4c-a-flows-terminals-face-its-counterpart)
  - [4d. Labels sit **on** their flow, never beside it](#4d-labels-sit-on-their-flow-never-beside-it)
  - [4e. Nothing is drawn across a container's name](#4e-nothing-is-drawn-across-a-containers-name)
  - [4f. Corridor risers nest, they do not interleave](#4f-corridor-risers-nest-they-do-not-interleave)
  - [4g. A flow does not weave](#4g-a-flow-does-not-weave)
  - [4h. A run only crosses containers it belongs to](#4h-a-run-only-crosses-containers-it-belongs-to)
  - [4i. An arrowhead has room to read as an arrow](#4i-an-arrowhead-has-room-to-read-as-an-arrow)
  - [4j. The run a label sits on is the only run under its words](#4j-the-run-a-label-sits-on-is-the-only-run-under-its-words)
- [5. Security](#5-security)
- [6. Diagnostics are coded, never thrown](#6-diagnostics-are-coded-never-thrown)
- [7. Nesting rules](#7-nesting-rules)
- [8. Every flow is a distinct edge](#8-every-flow-is-a-distinct-edge)
- [9. Layout reading order](#9-layout-reading-order)
- [10. Slide / page orientation](#10-slide--page-orientation)
- [11. Backward flow rerouting](#11-backward-flow-rerouting)
- [12. Element kind validity per view](#12-element-kind-validity-per-view)
- [13. `cairn new` must not overwrite files](#13-cairn-new-must-not-overwrite-files)
- [14. Snapshot & corpus gates](#14-snapshot--corpus-gates)
- [15. Flow matrix export invariants](#15-flow-matrix-export-invariants)
- [16. Flow positioning is blind to the DSL](#16-flow-positioning-is-blind-to-the-dsl)
- [17. Author positioning hints are honored, not negotiated](#17-author-positioning-hints-are-honored-not-negotiated)

## At a glance

Four kinds of gate hold this document up. Knowing which one holds a rule tells
you what a violation looks like when you cause one.

| Gate | What it does when broken |
|---|---|
| **zero** | `npm run sweep` fails on the first occurrence, at any count |
| **ratchet** | a rate ceiling in `scripts/sweep.ts` fails; ceilings only ever fall |
| **reference** | a committed digest, baseline or snapshot stops matching |
| **test** | a case in `tests/*.test.ts` fails |
| **structural** | the code cannot express the violation — types or imports forbid it |

| # | Invariant | Enforced in | Gate |
|---:|---|---|---|
| 1 | Zero label overlaps | `svg-render` label settling | zero |
| 2 | Byte-deterministic output | arithmetic discipline in the output path | reference (`corpus.digest`, snapshots) |
| 3 | Readability gated by the sweep | every geometry pass | zero + ratchet + `readability.baseline` |
| 4 | Flow labels required and attributable (§4a–§4j) | `validator`, `label-anchor`, `edge-tidy`, `svg-render` | zero (`labelAdrift`) + ratchet |
| 5 | User text escaped, reserved keys rejected | `xml-escape`, `parser` | test |
| 6 | Diagnostics are coded, never thrown | `parser`, `validator` | test |
| 7 | Nesting rules per view | `validator` (`E0210–E0218`, `E0202`, `E0220`, `E0222`) | test |
| 8 | Every flow is a distinct edge | `scene-layout`, `edge-tidy` | zero (`coincident`) + test |
| 9 | Layout reading order | `scene-layout` partitions | test |
| 10 | Slide landscape, page portrait | `scene-layout` | test |
| 11 | Backward flows rerouted, never left wrapped | `route-detour`, `edge-tidy` §4c | ratchet (`attachAway`) + test |
| 12 | Element kind validity per view | `validator` (`E0201`) | test |
| 13 | `cairn new` never overwrites | `cli.ts` (`wx` = `O_CREAT\|O_EXCL`) | test |
| 14 | Snapshot & corpus gates | `tests/corpus.ts` | reference |
| 15 | Flow matrix export | `flow-matrix` | reference + test |
| 16 | Flow positioning is blind to the DSL | `edge-tidy`, `route-detour`, `label-anchor`, `compact`, `readability` | structural + test |
| 17 | Author positioning hints honored, not negotiated | `parser`, `scene-layout`, `edge-tidy` | reference + test |

Two rules cut across all of them:

- **Never re-approve a reference to go green.** Digests, snapshots, ceilings and
  the per-drawing baseline move only when the change that moved them is
  understood and attributed (§3, §14).
- **A guard must measure what the invariant measures.** Where a pass avoids a
  defect and the sweep counts it, both must use the same predicate — the
  mismatch is invisible in code review and has cost four debugging sessions
  (§3).

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
wrap-around attachments §4c, labels off their line §4d, struck titles §4e, crossings §4f, weaving flows §4g, foreign containers §4h, straddled labels §4j) are a **ratchet** — expressed as a rate per swept flow-instance (not a raw count) so
adding fixtures doesn't spuriously fail the gate. Current rates are ceilings
that may only fall. Lower a rate when a change earns it; never raise one to go
green.

**No individual drawing may regress unless a more serious defect paid for it.**
The corpus-wide rates have a blind spot this repo has been bitten by: a change
can improve sixty drawings, quietly make one worse, and every total still falls.
`tests/__snapshots__/readability.baseline` records the accepted defect count per
drawing × metric. Improvements are locked in with
`npm run sweep -- --update-baseline` — floors only fall, like the rates. Treat
the baseline like a snapshot: never regenerate to silence a regression you don't
understand.

The exception is not a loophole, it is the routing rule restated. Flow repair is
built to trade — spending a turn to remove a crossing is the point of the ladder
in §4 — so a gate that failed any drawing getting worse on any metric would fail
every *correct* trade, and could only be passed by stopping the router doing its
job. The baseline therefore applies the same five tiers: a drawing may get worse
at tier N only if it improved at a tier that matters more, and the sweep reports
those separately as accepted trades. Tier 0 has nothing above it, so nothing
ever buys a tier 0 regression — metrics in MUST_BE_ZERO are checked unconditionally,
while tier-0 ratchets (throughContainer, titleStruck, labelPierced) are gated by their ceilings.
[`internals/ROUTING.md`](internals/ROUTING.md) explains the
ladder and [`READABILITY_METRICS.md`](READABILITY_METRICS.md) documents its
implementation — what every metric measures, its tier, and which of the three
gates holds it; [`../tests/README.md`](../tests/README.md) explains how the gates fit
together.

`--only=<substring>` and `--shard=i/n` restrict the matrix for iteration and CI
parallelism. Partial runs report the rates without gating them — a rate over
part of the corpus cannot judge a corpus-wide ceiling — but the per-drawing
baseline still gates, since each drawing is judged against its own line.

### A guard must measure what the invariant measures

Every defect above is checked in two places: a pass that avoids creating it, and
`npm run sweep` that fails the build if it exists. When those two measure the
same thing by different means, the pass believes it is safe while the gate
disagrees — and the bug is invisible, because the code *looks* like it checks the
right rule.

This has cost four separate debugging sessions:

- `label-anchor`'s revert guard uses `boxToPolylineSq` on the label **box**; §4d
  and the sweep measure the **text centre**. For a two-line label with a chip
  beneath, those read 8px and 44px. The guard passes; the gate reports
  `labelAdrift`.
- `optimiseRoutes` was handed `titleBoxes` captured before `compact` shifted
  every y — it dodged title bands where they used to be and struck them where
  they now are. 17 regressions.
- A fan-clearance check and a `nearParallel` check each used a threshold that
  did not match the sweep's.

So: when adding a rule, take the predicate from `scripts/sweep.ts` rather than
writing a second one that means the same thing. When adding a *metric*, give the
router the same expression. If the two must differ, say why in a comment next to
both.

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
- **`labelStraddled` — ratchet.** The on-line exemption above holds only for a
  run *crossing* the label. A run **parallel** to the one it sits on, inside its
  box, leaves the reader nothing at all. §4j.

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
design. So are edges the author pinned to a node side in the DSL
(`APP.right -> DB.left`, §17): a pinned terminal is intent, and this rule exists
to overrule elk, not the author.

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

**The port-constrained relayout is where that remainder goes**
(`constrainPorts` in `scene-layout`): the flows this rule flags are given elk
ports on the side facing their counterpart and the winning configuration is laid
out again. Three things about it are load-bearing.

- **It also takes flows nothing else can see.** A route can measure far longer
  than the distance it covers with both terminals pointing the right way — a
  backward flow whose channel plan fell through to a lane over the top of the
  drawing leaves north and arrives north, and when its two nodes sit at the same
  height neither offset clears the 24px tolerance. `scripts/sweep.ts` counts that
  as `longDetour`; the flagged population is `attachAway` **plus** `isLongDetour`
  (`geometry.ts`, the sweep's own predicate — §3a), because no post-pass can
  repair it: the corridor between the two nodes is one lane wide and already
  carries the answering flow, so the §4c reroute is refused for merging with it.
- **It is re-entered, at most twice.** Constraining one pair's ports moves every
  layer around it, and the layout that comes back can wrap a flow that was
  straight before. The second round measures that layout and repairs it in turn.
- **Every round is judged against the layout elk drew unaided**, never against
  the round before it. Chaining the verdicts refuses strictly better candidates:
  a second round measured on `logical`-shaped input removed two wrap-arounds and
  sixteen net crossings and was rejected for gaining eight of them. Among rounds
  that beat that base, the one paying at the better tier wins; ties go to the one
  carrying fewer `longDetour` routes — `relayoutVerdict` refuses on any per-key
  gain, so it cannot weigh two whole layouts that both clear a tier-0 defect,
  even when one leaves flows wrapped around the drawing and the other does not
  (`beatsRelayout`). An exact tie keeps the earlier round, so the choice does not
  depend on iteration order (§2).

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

### 4g. A flow does not weave

No flow takes more than two turns between its endpoints (`turnHeavy`, ratchet).
Two nodes are always joinable by a straight run, an L or a Z, so a third turn
cannot be explained by geometry — it means the flow left through a side that did
not face where it was going, usually queueing on a busy side while another sits
unused. `Payment hub` in `infrastructure-large` puts both its outbound flows on
its east side, one of them taking four turns to reach the database, with north
and south free and one turn away.

The corpus turn histogram is why the threshold is three and not two: 830 flows
sit at 0–2 turns and the tail beyond is a different population entirely.

**Deliberately measured on the outcome, not the opportunity.** The tempting rule
— "a terminal on a crowded side when a free side faces the counterpart" — matches
**676 of 2160 terminals (31%)** in `wide` alone. A rule that fires on a third of
all attachments describes a configuration, not a defect, and a pass acting on it
would rewrite every drawing. Turns are what the reader actually pays for.

**The repair runs last, and that is the whole design.** Unweaving re-sides a
flow through the face that actually points at its counterpart — often one
standing empty while the flow queues on a busy side. A first attempt placed it
beside the §4c reroute at the top of `edge-tidy`, where it validated candidates
that four later mutations (attachment separation, de-coincidence, title lifting,
riser nesting) then reshaped: routes proven crossing-free when chosen were not
crossing-free when drawn, and the corpus paid 16 per-drawing regressions.
Running it after every other mutation, so that what is validated is what is
rendered, took the same idea to zero regressions. §4f works for the same reason.

Acceptance order is the readability ranking: **a candidate may never gain a
crossing partner it did not already cross, may not add a fan tangle, must leave
every label a seat clear of nodes and titles, and must clear title bands by
`BAND_MARGIN`; among those that turn less than the route they replace, the
shortest wins.** Size is the tie-break, never the gate.

*Partners, not counts* — and that distinction was paid for. Counting crossings
let `Hub de paiement → PostgreSQL primaire` trade two crossings with one flow for
one with another: the drawing's total fell 4→3, the per-drawing gate recorded an
improvement, and a new crossing appeared beside the node in an area that had been
clean. **A per-metric total cannot see a defect move.** Comparing the *set* of
crossed flows can, and it is the only form of this check that is safe.

`BAND_MARGIN` is 38 and calibrated, not chosen: `compact` runs after this pass
and shifts bands and runs by different per-row amounts, so a route that merely
grazes a title here can be sitting on one by the time it is drawn. Below ~30 that
leaked struck titles; at 46 it started refusing good routes.

Folded slide layouts (`slide-fold`) are exempt — they hand-route on a lane grid
where re-siding a terminal costs a lane and the neighbours reflow.

What remains is mostly flows whose straighter route would cross something the
weave currently dodges. Lowering this rate means giving those flows somewhere to
go, not relaxing the count.

### 4h. A run only crosses containers it belongs to

A run may pass through a container that **holds one of its endpoints** — that is
how anything leaves a data centre or a zone — and through no other
(`throughContainer`, ratchet). Cutting through a container you have no business
in reads as traffic transiting that component.

Nothing could see this before: `throughBox` and every routing guard in
`edge-tidy` test **leaf** nodes only, because container interiors are routable by
design. `Kafka → Backup server` ran the full width of `PostgreSQL standby` — a
`server` that merely happens to hold a replica, and therefore a container —
completely unguarded.

Measured at 102; the reroute in `edge-tidy` now clears **44** of them and may
never create one. This is a **Tier 0** concern (see the ladder below), so it
outranks weaving (§4g): a candidate that clears a container is accepted even
when it turns no *less* — but never when it turns *more*, since paying for it
with a new weave only moves the reader's problem down a tier.

What remains are flows with no acceptable alternative: for `Kafka → Backup`,
every one of the candidate routes — including entering the backup server from
the north, which is the right shape — is rejected by the merge-clearance guard,
because the corridor above the DR zone already carries parallel runs. Lowering
this rate means giving those corridors room, not weakening the guard.

### 4i. An arrowhead has room to read as an arrow

A flow's **terminal segment** — the one carrying the arrowhead — must be at
least **14px** long. The head itself is ~7px, so a shorter run leaves nothing
between the head and the corner feeding it, and the arrow reads as a line with a
thickening at the end. Direction is meaning, not polish, so this sits at tier 2
of the ladder (§3) rather than in the polish tier.

Reported on `application-small`, where `MANAGER -> APPROVAL` arrived
`(83,168) (368,168) (368,161)` — a **7px** riser — and `APPROVAL -> PAYROLL` left
on a **5px** stub. Both ran a few pixels off the `HR portal` container's bottom
border, which is what made them look like one line with a smudge on it. The
repair pass now re-sides them: `MANAGER` enters `APPROVAL` from the west with a
243px terminal, and `APPROVAL` leaves south with a 22px stub clear of the
container.

**Scoped to the arrowhead on purpose.** The wider rule — "no run may sit within
8px of a parallel container border" — was implemented and measured first. It
pushed runs off borders and straight onto container *names*, fighting §4e: ten
drawings gained a `titleStruck` (tier 0) to lose a shadowed border (tier 2),
which is the ladder upside down. A border a run merely runs near is a cosmetic
complaint; a name drawn through is destroyed information.

Not yet a swept metric — the router avoids it, but nothing gates it. Adding
`arrowCramped` to `scripts/sweep.ts` needs a corpus-wide count to calibrate the
ceiling from.

### 4j. The run a label sits on is the only run under its words

No **foreign** run may pass inside a flow label's box **parallel to the run the
label sits on** (`labelStraddled`, ratchet, tier 1).

§4a exempts an on-line label from `labelPierced`, and for a run *crossing* the
label that exemption is right: the crossing is masked behind the halo and the
label's position already says which line is speaking. It collapses when the
intruder is **parallel**. Then both lines are masked the same way, both emerge
above and below the words, and position says nothing — the label is sitting on
two lines and naming one of them.

`small/page` is the case that produced the rule. `PATIENT → PORTAL` took a west
channel whose lane came out at x=91; `SCHEDULER → PATIENT` had a riser at x=96.
Both labels are seated on their own risers and each has the other's flow through
its box. Nothing in the pipeline objected: `labelPierced` exempts them for being
on their line, `labelOrphan` cannot fire when `own` is 0, and `nearParallel`
saw it — as a tier-2 complaint about a tier-1 loss.

**Strictly inside the box, not within `PIERCE_SLACK`.** A run grazing the box
edge is what the halo is for; it is the line between the first and last letter
that costs the reader the attribution.

Two things enforce it, and neither is the label:

- **`laneBeyond` in `edge-tidy` derives channel lanes clear of parallel runs**,
  by half the label the lane will carry rather than the fixed `CHANNEL_CLEAR`
  that keeps the *lines* apart — 10px of separation is no help to a 90px label
  centred on one of them. The clear lane is **added** to the candidates, never
  substituted for the box-derived one: replacing it was measured and moved five
  `slide` drawings onto container names, because a lane clear of every parallel
  run can be a long way out and folded layouts reflow around whatever the
  unfolded scene hands them. As a candidate it is longer, so it sorts after the
  lane it would replace and the ladder reaches it only when the nearer one is
  refused. Canvas growth stays what it always was — the last lane in the list.
- **Moving the label is the fallback, not the fix.** Its escape is off its own
  line, which trades one tier-1 defect (`labelStraddled`) for another
  (`labelOffLine`) and leaves it beside two lines it still cannot distinguish.
  Separating the runs is the only repair that removes the ambiguity.

What remains at 329 is not one shape: channel lanes are only one way two runs
end up parallel under a label. Elk's own routing and `route-detour`'s channels
are others, and neither has been taught the rule.

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

Within a partition, order is the layout engine's to choose — unless the author
declares one (`order: 2`, §17). A top-level `order:`
splits its partition into bands (`readingSlots` in `scene-layout`, emitted as
`partition * SLOT_SCALE + slot`), so the author sequences elements *inside* the
partition the view gave them and can never move one into a different partition:
every slot of band *n* still precedes every slot of band *n+1*.

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

One exception: a flow whose terminals the author pinned (`A.top -> B.right`,
§17) is never sent through a channel. A channel replaces both terminals with the
lane's own entry and exit, so routing one would silently overrule the pin — and a
backward flow is the case an author is most likely to be pinning.

## 12. Element kind validity per view

Element kinds are restricted by view. Examples: `queue` is valid only in
application & infrastructure; `gateway`, `firewall`, `auth`, `idp` only in
infrastructure;
`trust-zone`, `security-node`, `asset` only in security; `system` in logical and
application (a C4 system boundary there, grouping applications, queues and
datastores); `datastore` renders as cylinder; business objects are logical-view
only. Unknown element kinds for the
active view are rejected (`E0201`).

Which kinds accept `logo:` is the same kind of registry fact, declared as
`View.logoKinds`: application view only, on `application`, `module`, `queue`,
`datastore` and `external`. A view that declares none takes no logos at all, so
the capability is opt-in rather than inherited (`E0108`).

A logo is always **inlined, never linked** — a built-in path from `src/logos.ts`,
or a workspace file read at build time and embedded as a `data:` URI. A URL is
refused (`E0105`). A cairn SVG is one self-contained file that renders offline
and identically forever; a diagram that fetches at open time would give that up,
leak the reader's address, and rot when the far end changes. Reading those files
is the CLI's job: `svg-render.ts` never touches a filesystem, because the
playground has none.

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

Columns are view data, not exporter logic: `views.ts` declares each view's
column list and zone kinds (`View.matrix`), and `flow-matrix.ts` never branches
on a diagram type — the same rule the rest of the registry follows
([ARCHITECTURE §4](./ARCHITECTURE.md#4-the-views-registry-as-the-extension-point)).
The infrastructure table is the reference shape and may not change silently:
`examples/infrastructure.flow.{csv,md,svg}` and the snapshots gate it.

One table, two callers: `cairn matrix` and `compile(source, { matrix: true })`
both go through `buildFlowMatrix` and the same formatters, so the CLI and an
embedder can never produce different bytes for the same source. The locale comes
from the model (`style { lang }`) and nowhere else — no exporter takes a language
argument of its own. `tests/api.test.ts` holds the API output against the
committed `examples/infrastructure.flow.csv` the CLI wrote.

## 16. Flow positioning is blind to the DSL

Everything that moves a flow — `edge-tidy`, `route-detour`, `label-anchor`,
`compact`, and the `readability` metrics that judge them — sees **geometry
only**. No pass branches on an element kind (`actor`, `datastore`,
`trust-zone`, …) or on a view name (`logical`, `application`, …).

DSL meaning enters at exactly one place: `scene-layout`, which reads the
`views` registry to decide partitions and reading order (§9, §12). From the
moment a `Scene` exists, a node is a box with an id and a `container` flag, and
a flow is a polyline. `SceneNode` still carries `kind`, because the renderer
needs it to pick a shape — the invariant is that no *positioning* pass reads
it.

This is what makes the pipeline extensible in the way
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §4 claims: adding a view or an element
kind is one registry entry and touches no routing code. The moment a router
special-cases a kind, every ratchet in `scripts/sweep.ts` becomes a measurement
of that special case rather than of the layout rules, and a new view inherits
none of the tuning.

Enforced structurally and by test:

- `edge-tidy`, `label-anchor`, `compact` and `readability` import nothing but
  `scene-layout` types and `geometry` — they *cannot* see a kind.
- `route-detour` is the one pass importing `Model`, and only for style and
  metrics: `model.style.font.size`, `model.style.compact`, and `model.flows`
  for numbering. Never a kind.
- `tests/dsl-agnostic.test.ts` fails if any kind or view name from the `views`
  registry appears in those sources, so the check covers kinds added later.

Three DSL-declared positioning hints exist (§17), and none breaches this: an
`order:` becomes a partition band and a `layout` rank an elk position, both
before any `Scene` exists, and a pinned
attachment side becomes an elk port plus a plain `pinned` boolean on the
`SceneEdge`. The passes that read `pinned` read a boolean on geometry, exactly
as they already read `detour` — no kind, no view name, so a new view inherits
the behavior for free.

Not to be confused with declaration-order independence, which does **not**
hold: reversing the flow declarations in `logical-archi.cairn` moves 48 path
segments and 60 node boxes, because elk orders its layers by edge insertion.
That is a known limitation, not a guarantee.

## 17. Author positioning hints are honored, not negotiated

Three opt-in DSL controls (`DSL_SPEC.md` § Positioning controls) let the author
override layout: `order:` on an element, `ID.side` on a flow endpoint, and the
arrow glyph's line style. Three rules hold for them.

**`order:` reads along the drawing at the root, across it inside a container.**
A top-level `order:` becomes a partition band (§9), and a band is a contiguous
run of layers, so it sequences elements along `elk.direction` — left to right for
`wide`/`slide`, top to bottom for `tall`/`page`. That is the only lever that does: elk's own
`layerChoiceConstraint`, `layering.strategy: INTERACTIVE` and
`elk.interactiveLayout` were each measured to be no-ops on these graphs. An
`order:` on an element *inside a container* stays `elk.position` under
`crossingMinimization.semiInteractive` — an index inside a layer, which orders
what the engine already draws side by side. Nested elements get no choice about
it: under `hierarchyHandling: INCLUDE_CHILDREN` every layer constraint elk
offers, partitioning included, is ignored for a container's children.

An element nobody ordered still needs a band, because a node left unpartitioned
was measured to drift to the end of the drawing. It takes the highest band that
flows into it (a monotone fixed point: terminates on a cycle, independent of the
order the flows are visited — §2), so a hint never drags a consumer ahead of its
own source. Where an author's order does contradict a flow, the order wins and
the flow is drawn backwards; nothing is reported, because the hint is a statement
about reading order, not about the flows.

**Opt-in means byte-identical.** A diagram that declares none of them must
render exactly as it did before the feature existed — the elk options that
implement them are emitted only where an author asked. `tests/corpus.test.ts`
and the committed `examples/*.svg` are the gate.

**A pin fixes the ends, not the path.** Where the author pinned a terminal, the
passes that would *move* that terminal stand down: `route-detour` never sends the
flow through a channel (§11), `edge-tidy`'s re-siding (§4c) offers that terminal
only the side it already sits on, `clearSideHugs` gives up on the run rather
than take its one fallback that lands the terminal elsewhere, and `attachAway`
exempts it in both the layout's own count and `scripts/sweep.ts`. Sliding a seat
*along* the side it is already on is not moving it, so every pass keeps that.

The exemption is **per terminal**, because `SceneEdge.pinned` records the two
ends separately. Pin one end and the other stays the layout's to answer for: it
is still re-aimed, still unwoven, and still counted by `attachAway`. Only a flow
pinned at both ends has no terminal left to choose, and `route-detour` is the
one whole-edge exception — a channel replaces *both* terminals, so a single pin
takes the flow out of the running.

The route between those ends stays the repair's business. `optimiseRoutes` keeps
a pinned edge as a candidate but generates only routes that leave the pinned end
on its declared side (the free end of a half-pinned flow keeps the full search),
and offers it one shape an unpinned flow never needs: the two-lane approach into
a side the plain L cannot reach without hugging a node border. Both lanes come
from `laneBeyond`, so the approach clears the corridors already in the drawing
instead of ploughing through them. Without it a pinned flow would keep whatever
the layout engine drew — measured at 5 turns and a 334px climb over a sibling
container on `positioning-sides`, against 3 turns after.
What the layout genuinely cannot deliver is dropped and reported as `W0570` —
never forced into an unreadable route, and never silently ignored.
