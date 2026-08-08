# The readability ladder

Every defect cairn can see, what it looks like on the page, how much it matters,
and how it is enforced.

[`FLOW_ROUTING.md`](FLOW_ROUTING.md) explains why the ladder exists.
[`INVARIANTS.md`](INVARIANTS.md) states the rules normatively. **This file is
the one to read when a sweep line puzzles you**, or before touching anything that
scores or gates a drawing.

---

## Three questions, not one

Almost every confusion about this system comes from running three separate
questions together. Keep them apart and the rest follows.

| Question | Answered by | Example |
|---|---|---|
| **What went wrong?** | the **metric** | `nearParallel` — two runs 8px apart for 60px |
| **How much does it matter?** | the **tier** | tier 2 — you can attribute both lines, but following one takes effort |
| **Is this output allowed to ship?** | the **gate** | ratchet — 73 of them are tolerated corpus-wide today |

A metric is a measurement. A tier is a *ranking*, used when deciding whether a
change is an improvement. A gate is a *policy*, deciding what the build tolerates
right now. They move independently: a tier-0 defect can be tolerated debt, and a
tier-4 defect could in principle be forbidden outright.

## So what is the difference between the ladder and the invariants?

**The invariants judge an output. The ladder judges a change.**

> *Invariant:* "this SVG must have zero label overlaps."
> Absolute, about the finished drawing, never traded away.
>
> *Ladder:* "moving this flow removes a crossing but adds two corners — is that
> better?" A preference ordering among imperfect outcomes.

They meet at one point: **a tier-0 defect is the kind of thing invariants are made
of** — information destroyed — and every current `MUST_BE_ZERO` metric sits at
tier 0. But the converse does not hold. Three tier-0 metrics
(`throughContainer`, `titleStruck`, `labelPierced`) are *ratchets*, not
invariants, because the corpus has not reached zero yet. They are debt of the
highest severity, not permission.

Put another way:

- **Invariant** — a promise cairn keeps. Break it once and the build fails.
- **Tier** — how loudly a defect argues when two defects disagree.
- **Ratchet** — a debt ceiling that may fall and must never rise.

Note also that `INVARIANTS.md` covers much more than readability — determinism,
escaping, nesting rules, CLI behaviour. Only §3 and §4 concern the ladder.

---

## The tiers

A tier answers exactly one question: **what does the reader lose?** Not how ugly
it is, not how hard it was to avoid.

### Tier 0 — information is destroyed

The diagram now says something false, or fails to say something it was asked to.
No amount of tidiness elsewhere compensates, and **nothing buys a tier-0 loss —
not even another tier-0 fix.**

> A flow drawn straight through a database it never touches. A reader
> reasonably concludes those two components talk. That is not untidiness; it is
> the diagram lying.

### Tier 1 — attribution is broken

Every line is visible and every word legible. You simply cannot tell which word
belongs to which line.

> Two flows run side by side and a label sits between them. Both are readable.
> Which one is `(TCP/5432)`? The diagram no longer says.

### Tier 2 — the line is hard to follow

You can attribute everything correctly, but tracing one flow end to end takes
deliberate effort.

> Two runs 6px apart for 200px. Nothing is wrong, exactly — you just have to
> concentrate to keep hold of which is which.

### Tier 3 — eye travel

Perfectly clear. Just further, or more wandering, than it needed to be.

> A flow taking four corners to reach a node that was two corners away. You lose
> a second, not a fact.

### Tier 4 — polish

Cosmetic. Modelled only so the optimiser cannot quietly degrade it while every
tier it *does* watch looks fine.

---

## How a change is judged

`ladderVerdict(before, after)` walks the tiers from 0 to 4 and stops at the first
one whose defect **set** differs:

- **Gained a defect at this tier?** → reject. No exceptions.
- **Only lost defects?** → accept, and everything below this tier is fair payment.
- **Nothing changed?** → look at the next tier down.

Two properties the code depends on, both learned the hard way:

**Payment only flows downward.** Removing a crossing (tier 2) may cost turns and
jogs (tier 3). Removing a run through a component (tier 0) may cost anything
below it. Nothing at tier 2 ever buys a tier-1 loss — a clearer line is never
worth a label you cannot attribute.

**Sets, not counts.** Defects are compared by identity
(`cross:F01~F03@812,240`), never tallied. A total cannot see a defect *move*:
trading two crossings on one pair of flows for one crossing somewhere previously
clean makes the total fall while the drawing gets worse in a place that used to
be fine. That bug shipped twice before the comparison was changed to identity.

---

## Tier 0 — information destroyed

### `overlaps` · must be 0
**What you see:** a label sitting on top of another label, or on a node box; one
of the two is unreadable.
Counted by the renderer after label settling. A name the diagram was asked to
carry is simply gone.
*Note: `overlaps` is absent from `TIER`, so `TIER[kind] ?? 4` would score it
tier 4 in the per-drawing gate. Harmless today only because must-be-zero is
checked unconditionally.*

### `diagonal` · must be 0
**What you see:** a slanted segment in an orthogonal drawing.
Both deltas ≥ 0.5px. Always a bug — a pass wrote geometry without squaring it.

### `throughBox` · must be 0
**What you see:** a flow line crossing the interior of a component it has nothing
to do with.
Leaf nodes only. Container interiors are routable by design and covered by
`throughContainer`.

### `coincident` · must be 0
**What you see:** two flows drawn as one line.
Same axis, less than 3px apart, sharing more than 8px of length. One of the two
flows has silently vanished from the drawing.

### `attachShared` · must be 0
**What you see:** two arrowheads merged into one at a node's edge.
Two flows landing within 6px on the same side. The reader cannot tell how many
flows connect there.

### `labelAdrift` · must be 0
**What you see:** a label floating in open space, nowhere near the flow it names.
The label **box** more than 20px (`LABEL_ADRIFT`) from its own polyline. Past
that it is further from its flow than the neighbouring flow is, so nothing
identifies what it belongs to.

### `deadBand` · must be 0
**What you see:** a wide empty stripe across the drawing.
A horizontal band ≥ 30px tall crossed by no node, no label and no horizontal run
— height `compact` should have reclaimed.

### `throughContainer` · ratchet
**What you see:** a flow cutting across a layer or zone it has no business in.
A run crossing a container that holds **neither** of its endpoints. Reads as
traffic transiting that component. Passing through a container you start or end
inside is how anything leaves a data centre and is *not* counted.

### `titleStruck` · ratchet
**What you see:** a container's name with a line drawn through it, or a label
parked on top of it.
Boxes are drawn first and titles carry no halo, so anything crossing one destroys
the words. Charged for runs **and** labels.

### `labelPierced` · ratchet
**What you see:** a floating label with a stranger's flow line running through
its words.
A foreign run within 1px (`PIERCE_SLACK`) of the box of a label that is **off**
its own line. Labels sitting *on* their run are exempt: their own line is masked
by the text halo and their position already settles attribution. It is the
floating label with a second flow through it that leaves no cue at all.

---

## Tier 1 — attribution broken

### `labelOrphan` · ratchet, ceiling 0
**What you see:** a label sitting closer to a neighbouring flow than to its own.
More than 6px (`LABEL_ATTACHED`) from its own run **and** some other run nearer.
Inside 6px it is visibly on its own line and a grazing neighbour changes nothing
a reader would notice.

### `labelOffLine` · ratchet
**What you see:** a label floating beside its flow like a caption, instead of
sitting on it.
The label's **text centre** more than 2px (`ON_LINE_SLACK`) from its own run.
Measured on the text rows, which sit at the top of the box — a protocol line and
business-object chips hang below, so the box centre is not the text centre.

### `labelStraddled` · ratchet

**What you see:** a label with two parallel lines running under it, one of them
someone else's.
A foreign run **parallel to the run the label sits on**, passing strictly inside
its box. `labelPierced` cannot see this — it exempts labels that are on their
line, and being on the line is what makes this ambiguous rather than merely
untidy: both runs are masked behind the same halo, both emerge above and below
the words, and the label's position no longer picks one. A run crossing the
label *transversally* stays exempt, which is why the predicate tests the axis
and not just the distance.

Charged on-line only, so it and `labelPierced` partition the population rather
than overlapping it.

*The router models this tier only as "does this route leave each label somewhere
to sit". Real attribution is decided after every geometry pass, by `label-anchor`
and the renderer's settler. `labelStraddled` is the one tier-1 defect a pass
avoids up front — not by scoring it, but by deriving channel lanes far enough
from parallel runs that the label cannot land on both (§4j).*

### `sideHug` · ratchet
**What you see:** a flow line merging with a node or container border so they
read as one line.
A run travelling within 3px of a side it does not attach to, crossing more than
24px of that side. The eye cannot tell the flow from the frame it rides. Rated
tier 1 because it destroys attribution — a hug fix may be paid for with a
crossing (verified on logical-archi's F02, where every re-side crosses F11's
riser), never the reverse.

---

## Tier 2 — the line is hard to follow

### `crossings` · ratchet
**What you see:** two flows crossing.
Anywhere in the drawing. Most are inherent to the topology; the avoidable ones
come from risers placed in the wrong left-to-right order.

### `fanTangle` · ratchet
**What you see:** two flows leaving the same side of a node and immediately
crossing back over each other.
Within 48px (`FAN_REACH`) of that node. Spreading attachment points is pointless
if the runs cross straight back.

### `nearParallel` · ratchet
**What you see:** two runs close enough to read as one thick line.
Same axis, less than 10px apart, sharing more than 40px. Not merged — that is
`coincident` — but hard to keep apart.

### Router-only, with no sweep metric

Two tier-2 defects exist in the router's model and **are not measured by the
sweep at all**:

- **`hug`** — a run travelling within 8px of a leaf's border for 12px or more, so
  the two read as one line.
- **`cramped`** — a terminal segment shorter than 14px, leaving no room between
  the arrowhead and the corner feeding it, so direction stops being legible
  (§4i).

This asymmetry matters: any scorer built on the router's profile but gated by the
sweep will find trades that look free to it and read as regressions to the gate.

---

## Tier 3 — eye travel

### `turnHeavy` · ratchet
**What you see:** a flow that weaves.
More than two turns. Two nodes are always joinable by a straight run, an L or a
Z, so a third corner cannot be explained by geometry — it means the flow left
through a side that did not face where it was going.

### `jog<=6` · ratchet
**What you see:** a tiny step in an otherwise straight run.
An **interior** segment of 6px or less. Reads as a rendering glitch rather than a
deliberate corner.

### `jog<=20` · ratchet
**What you see:** a visible staircase step.
An interior segment between 6px and 20px.

### `attachAway` · ratchet
**What you see:** a flow setting off in the wrong direction before doubling back.
A terminal departing away from its counterpart, or arriving from beyond it, when
the two nodes are genuinely offset (more than 24px) on that axis.

### `longDetour` · ratchet
**What you see:** a flow taking the scenic route.
More than **2.2×** the direct centre-to-centre distance **and** more than 400px
longer in absolute terms. Both conditions, so short flows are not charged for
rounding.

---

## Tier 4 — polish

### `attachTight` · ratchet
**What you see:** attachment points crowded together on a node side.
Closer than 80% of `min(12, (side − 6) / (flows − 1))`. Perfectly legible, just
cramped. Modelled so the optimiser cannot crowd node sides invisibly while every
tier it does watch stays clean.

---

## The three gates

`npm run sweep` renders 288 drawings — every fixture × four dispositions — and
gates three independent ways.

**1. Invariants (`MUST_BE_ZERO`).** Seven metrics. One occurrence fails the
build, unconditionally. No trade buys these.

**2. Ratchets (`CEILING_RATE`).** A ceiling expressed as a rate *per swept
flow-instance*, not a raw count — so adding fixtures cannot spuriously fail the
gate. Rates may only fall.

**3. The per-drawing baseline.** `tests/__snapshots__/readability.baseline`
records the accepted count for every drawing × metric. The rates alone have a
blind spot: a change can improve sixty drawings, quietly make one worse, and
every total still falls. This catches that — and applies the same tier rule:

```js
if (bestGain < item.tier) trades.push(...)   // accepted: paid for by a better tier
else regressions.push(...)                   // fails
```

Strict `<`, so a tier-0 gain cannot pay for a tier-0 loss.

`--only=` and `--shard=i/n` restrict the matrix. Partial runs report the rates
without gating them — a rate over part of the corpus cannot judge a corpus-wide
ceiling — but the per-drawing baseline still gates, since each drawing is judged
against its own line.

### A known gap

```js
const allKinds = [...MUST_BE_ZERO, ...Object.keys(CEILING_RATE)].filter(
  (kind) => baseline.size === 0 || baselineKinds.has(kind),
);
```

The filter exists so that *adding* a metric does not fail every drawing at once.
But `--update-baseline` writes only **non-zero** entries — so a metric driven to
0 across the whole corpus disappears from the baseline file, and the filter then
stops checking it per-drawing.

**Driving a defect to zero is what stops it being watched.** Observed directly:
after `labelPierced` and `labelOrphan` reached 0 and the baseline was updated,
the gate reported "0 regressions" on a drawing that had just gained two pierced
labels. A kind should count if the baseline knows it *or* the current run
observed it.

---

## Where the ladder lives

The ranking is written down twice and the two must agree:

| | file | used by |
|---|---|---|
| `TIER` | `scripts/sweep.ts` | the gate, judging a change against the baseline |
| tier argument to `profile.set` | `src/readability.ts` | the router, judging a candidate route |

They are not generated from one source, so a new metric must be added to both.

**`optimiseRoutes`** (`edge-tidy.ts`) is the only ladder-driven pass, and it runs
**last** — after `label-anchor` and `compactVertical` — because those reshape
geometry, and a route validated before them is not the one that gets drawn.
Running it earlier cost 36 per-drawing regressions.

Its candidates per edge: four sides × four sides, seat offsets `[0, -18, 18]` at
each end, giving **one** L when the sides are perpendicular, three Zs when they
oppose, and nothing when they face the same way. Ordered fewest-turns-then-
shortest, and **the first candidate the ladder accepts wins** — the ladder decides
what is *allowed*, never which of two allowed routes is better.

One thing the ladder cannot see: moving a route can cost a *neighbouring* flow
its label seat, and which label the settler lifts is not a fact until settling has
run. So the pass records `repairedFrom` and `svg-render` audits afterwards,
reverting the whole repair set if labels came out worse. All-or-nothing on
purpose — making it per-edge produced `coincident` runs, a must-be-zero breach.

---

## Changing a ceiling

Rates may only fall. Lower one when a change earns it; **never raise one to make
a run pass.** The single exception is a deliberate recalibration with the reason
recorded next to the number — `longDetour` carries two such notes. A raise
without a recorded reason is indistinguishable from hiding a regression, and six
months later nobody can tell which it was.

Promoting a ratchet to an invariant works the same way in reverse: drive the
count to 0, confirm it holds across unrelated changes, *then* add it to
`MUST_BE_ZERO`. Declaring it early only makes the build red.

## Adding a metric

1. Write the predicate in `scripts/sweep.ts` and emit it via `note()`.
2. Add it to `TIER` — otherwise `TIER[kind] ?? 4` silently scores it tier 4.
3. Add it to `CEILING_RATE` (with a ceiling calibrated from a corpus-wide count,
   and a comment saying so) or to `MUST_BE_ZERO`.
4. If a pass should *avoid* it, give `readability.ts` the same expression at the
   same tier — **take the predicate from `sweep.ts`; do not write a second one
   that means the same thing.** Four separate debugging sessions have been spent
   on guards that measured *almost* what the gate measured (INVARIANTS §3).
