# Readability metrics

What `npm run sweep` measures, what each defect looks like on the page, and
how strictly each one is enforced. Read this alongside
[`AGENTS.md`](../AGENTS.md#non-negotiable-invariants) invariant 4 — this
document is the detail behind that one line.

## Two gates, not one

`scripts/sweep.ts` renders every example under `examples/` (top level,
`dispositions/`, and `themes/`) in every disposition — 288 drawings, 4352
flow-instances at last count — and classifies each defect it finds into one
of two buckets:

- **Zero-gated.** Seven kinds must never occur, anywhere, at any count. One
  occurrence fails the build.
- **Ceiling (ratchet).** The rest are tolerated debt, expressed as a
  *rate per swept flow-instance* rather than a raw count — so the ceiling
  doesn't spuriously tighten just because the corpus grows. A rate may only
  fall; raising one to make a run pass is the one thing this gate forbids
  outright.

Both are measured the same way — by rendering real diagrams and inspecting
the resulting geometry — the only difference is what the build does when one
fires.

## Zero-gated

### `overlaps`
**What you see:** a label sitting on top of another label, or on a node box
— one of the two is unreadable. Counted by the renderer after label
settling.

### `diagonal`
**What you see:** a slanted segment in a drawing that's supposed to be
strictly orthogonal (horizontal/vertical only).

### `throughBox`
**What you see:** a flow line crossing the interior of a component it has
nothing to do with. Only leaf nodes count — container interiors are
routable by design.

### `coincident`
**What you see:** two flows drawn as one line. Same axis, less than 3px
apart, sharing more than 8px of length — one of the two flows has
effectively vanished from the drawing.

### `attachShared`
**What you see:** two arrowheads merged into one at a node's edge — two
flows landing within 6px of each other on the same side, so the reader
can't tell how many flows connect there.

### `deadBand`
**What you see:** a wide empty stripe across the drawing — a horizontal
band 30px tall or more crossed by no node, label, or horizontal run.

### `labelAdrift`
**What you see:** a flow label that has floated more than 20px from its own
run — far enough that the reader can no longer tell which flow it
annotates.

## Ceilings (tolerated debt, may only fall)

`scripts/sweep.ts`'s `CEILING_RATE` is the source of truth for this list —
check there for the exact, currently-calibrated rate per kind; the
descriptions below are what each one looks like on the page.

### `attachTight`
**What you see:** attachment points crowded together on a node side —
legible, just cramped. Flagged when the gap is under 80% of a fair,
evenly-spaced width for that side.

### `jog<=6` / `jog<=20`
**What you see:** a small step in an otherwise straight run — reads as a
rendering glitch rather than a deliberate corner. Split into two buckets by
size (up to 6px, and 6–20px) since a tiny jog and a visible staircase step
are different severities of the same defect.

### `nearParallel`
**What you see:** two runs close enough to read as one thick line, without
actually merging — less than 10px apart for more than 40px of shared
length.

### `longDetour`
**What you see:** a flow taking the scenic route — more than 2.2× the
direct distance between its endpoints *and* more than 400px longer in
absolute terms (both conditions, so short flows aren't penalized for
rounding).

### `crossings`
**What you see:** two flows crossing anywhere in the drawing. Most crossings
are inherent to the topology; only ones caused by risers seated in the wrong
left-to-right order are fixable by re-seating.

### `fanTangle`
**What you see:** two flows leaving the same side of a node whose routes
tangle within its fan (within `FAN_REACH` = 48px), so the reader can't tell
which line owns which attachment point.

### `turnHeavy`
**What you see:** a flow that weaves — more than two turns between its
endpoints, when a straight run, an L, or a Z would always suffice
geometrically.

### `throughContainer`
**What you see:** a run crossing a container that holds neither of its
endpoints — reads as traffic transiting a component it has no business in.
Invisible to `throughBox`, which only tests leaf nodes.

### `attachAway`
**What you see:** a wrap-around attachment — a terminal segment departing
away from its counterpart, or arriving from beyond it, so the eye is carried
in the wrong direction before doubling back.

### `sideHug`
**What you see:** a run riding a node or container side it doesn't attach
to, close enough (within 3px, over more than 24px of shared span) that the
flow reads as part of the frame.

### `titleStruck`
**What you see:** a run or label drawn across a container's title — the
line strikes through the words since titles carry no halo.

### `labelOrphan`
**What you see:** a label sitting more than `LABEL_ATTACHED` (6px) from its
own run, with some other run's line closer to it than its own — the reader
would guess the wrong flow.

### `labelOffLine`
**What you see:** a label whose text centre doesn't sit on its own run (more
than the `ON_LINE_SLACK` of 2px off it) — the caption reads as floating
beside the flow rather than on it.

### `labelPierced`
**What you see:** a foreign run drawn directly through a label's text, for a
label that isn't already seated on its own run — the worst case, since two
flows are touching the same words.

### `labelStraddled`
**What you see:** a second run traveling parallel to the label's own run and
passing inside its box — both lines get masked by the same text halo, so
nothing tells them apart.

## Priority: what wins when fixing one defect risks creating another

There's no general scoring engine here — no severity table, no trade-off
calculator ranking every defect against every other. What exists is two
hard-coded, unconditional guards, each in the pass that could otherwise
introduce the tradeoff:

**In `edge-tidy.ts`** — every straightening or separation move is checked
*before* it's applied, in this order:
1. **A move may never drag a run through a node's interior.** Unconditional
   — checked regardless of what the move would otherwise fix.
2. **A move may never create a merge with another flow** — the exact same
   thresholds as the `coincident`/`nearParallel` metrics above (`gap < 4px`
   & `shared > 6px`, or `gap < 11px` & `shared > 36px`). This wins even over
   fixing a jog or a shared attachment point: **a jog or a shared attachment
   point is deliberately left in place rather than traded for a merged
   line** — two flows that are individually a little untidy beats two flows
   that read as one.

Only a move that clears both guards is applied.

**In `route-detour.ts`** — choosing between the preferred (bottom) and
fallback (top) channel: a flow is diverted to the fallback only when the
gain is clear *and* that channel is certain to plan successfully. The pass
guarantees a rerouted flow never ends up worse than elk's original route —
it only ever improves a flow's path or leaves it untouched, never trades one
problem for a different one.

## How to read a ceiling number

Each ceiling is a rate: defects ÷ total flow-instances swept. `npm run
sweep` prints both the count and the rate against its ceiling. A rate is
what lets the example corpus grow over time without the gate spuriously
failing on a drawing nobody touched — the numbers currently in
`scripts/sweep.ts`'s `CEILING_RATE` are corpus-wide, not per-drawing: an
individual example can carry more than its "fair share" of a ceiling as
long as the corpus-wide rate holds.

Lower a ceiling whenever a change earns it. Never raise one to get a run to
pass — that turns the gate into noise, the one thing
[`AGENTS.md`](../AGENTS.md#non-negotiable-invariants) singles out as never
acceptable.
