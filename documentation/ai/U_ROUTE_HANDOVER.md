# Handover — same-side U routes, derived seats, and the post-settle audit

Status: **works, does not yet pass the gate.** The change lives in
`documentation/ai/u-route-wip.patch`, applied on top of `612b46e`.
`git apply documentation/ai/u-route-wip.patch` to resume.

One must-be-zero invariant is breached (`labelAdrift` 1), so `npm run sweep`
exits 1. Everything else about the change is a large net improvement.

## What it does

Two flows that were drawn wrong are now drawn right.

**`examples/logical.cairn`, F19 (`CASE -> POLICYHOLDER`).** Was a single westward
run at y=85 straight through the **Reporting layer** — a container holding
neither endpoint (§4h, tier 0) — and across that layer's name (§4e, tier 0). Now
rises out of `CASE`, runs west in a free lane above the drawing, and drops into
`POLICYHOLDER`:

```
before:  M 1097 237  L 1097 85  L 155 85
after:   M 1097 237  L 1097 12  L 149 12  L 149 79
```

**`examples/dispositions/infrastructure-small-tall.cairn`, F01/F02.** Were
straight verticals at x=119 that ran through the "Public zone" and "Web VM"
names. Now step sideways just enough to clear them:

```
before:  M 119 87   L 119 139   L 119 195     (through "Public zone")
after:   M 133 72.5 L 149 72.5  L 149 173     (one slight turn)
before:  M 119 242  L 119 323.5 L 119 405     (through "Web VM")
after:   M 149 220  L 149 301.5 L 149 383     (straight down)
```

## The four pieces

**1. `channelU` — the U shape.** `shapesFor` returned `[]` for same-facing side
pairs ("same-facing sides give a wrap, not a route"). That premise was wrong: a U
is 2 turns, not a weave. When every L and Z ploughs through a container the flow
has no business in, out-and-around is the only clean route left.

**2. `laneBeyond` — the lane is derived, not guessed.** §4h turned from a score
into a coordinate: collect the obstacles a run may never enter (every leaf, every
container name, every container holding **neither** endpoint), keep those
overlapping the span the run must cross, and push the lane out until it clears
them all, iterating because clearing one can expose the next. So the turn happens
exactly as late as the invariant requires and no later.

**3. `seatOffsetsFor` — the seats are derived too.** A container name lying
across a node side yields two extra attachment points, one either side of it,
clamped to the side. Offered to **all** side pairs.

That last word matters. An earlier version gave the extra reach to same-facing
sides only (`U_SEAT_OFFSETS`), so on `infrastructure-small-tall` no L or Z could
escape from under the "Public zone" name and a U won *by being the only shape
that could* — a flow that should have stepped 16px sideways bulged out of its
column instead. Symmetry restored, and the existing fewest-turns-then-shortest
order picks the cheap escape unaided. `U_SEAT_OFFSETS` is deleted.

**4. `SEAT_CLEAR = 14`, not 4.** The step past a name becomes the first leg of
whatever route uses the seat, and a leg under 14px is charged `cramped` (§4i). At
4px the optimiser cleared a struck title, was immediately handed a tier-2
`cramped` terminal for the 12px leg it had just created, and bought its way out
with a two-turn detour. Traced round by round:

```
round 0  F01: 101,87 101,199        ->  133,73 145,73 145,199   damage=[0,0,1,1,0]   <- correct
round 1  F01: 133,73 145,73 145,199 ->  133,73 179,73 179,205 155,205  damage=[0,0,0,2,0]
```

Round 0 was already producing the right route; round 1 threw it away to fix a
defect the seat itself had introduced. Any future "derive a position" pass should
respect `ARROW_ROOM` for the same reason.

**5. The post-settle audit (`svg-render.ts`).** `optimiseRoutes` records
`repairedFrom`; the renderer settles labels and decides whether to keep the
repair. That decision used to weigh **label damage only**, as a flat count, so it
would revert a flow that had stopped cutting through a layer because putting it
back cost one label less. `harmOf()` now measures both states the same way, runs
**and** labels, per tier. Runs come from `local(ids, new Map(), true)` —
`soloOnly`, so the expensive pairwise phase is skipped; every tier-0 route defect
is a route against a fixed obstacle.

**6. `isChannelU` → `edge.detour = true`.** A channel U necessarily departs away
from its counterpart at both ends; §11 already exempts channel-routed flows and
`route-detour` marks its own the same way. Recognised geometrically (4 points,
parallel terminal legs, both on the same side of the joining lane) rather than
tagged at construction, because the squaring pass rebuilds the points.

## Measured, full corpus (260 drawings, 3884 flow-instances)

**337 per-drawing improvements against 15 regressions.** 14 of the 15 are tier 3.

| ratchet | now | ceiling | |
|---|---|---|---|
| titleStruck | **96** | 789 | was ~714 pre-change |
| throughContainer | **18** | 52 | |
| turnHeavy | 555 | 814 | |
| crossings | 3685 | 3830 | |
| longDetour | 154 | 172 | |
| jog<=20 | 152 | 374 | |
| labelPierced | **0** | 6 | was 7 before the seat work |
| attachAway | 305 | 247 | ✗ newly over |
| labelOrphan | 1 | 0 | ✗ |
| fanTangle | 108 | 59 | ✗ also over on main |
| nearParallel | 81 | 53 | ✗ also over on main |
| attachTight | 23 | 4 | ✗ also over on main |

## What blocks it

1. **`labelAdrift` 1 — must-be-zero.** `logical-fr/slide`, F10
   `"Mission d'expertise si dommage > seuil"`, 39px off its own run (limit 20).
   The same label is also the single `labelOrphan` (F13's run is 32px away). One
   label, one drawing, two breaches. Fix this and `labelOrphan` goes with it.
2. **`attachAway` 305 vs 247.** Derived seats produce more wrap-around
   departures. Worth checking whether the derived seat should prefer the side
   that faces the counterpart when both clear the name.
3. Twelve tier-3 `attachAway`/`jog<=20` per-drawing regressions, concentrated in
   `application-compact` and `application-medium`.

## Two dead ends — do not repeat

**`scene.repairTier` as a scalar.** The idea: "a loss at tier T is payable only
by a gain at a tier strictly better." It cannot work — when *both* states carry
tier-0 defects it has no way to compare magnitudes and reverts unconditionally.
The field is still added in `scene-layout.ts` by the patch and is now **unused**;
delete it.

**Tier-0 by identity in the audit.** `LADDER.md` says "nothing buys a tier-0
loss", so the audit ought to reject any repaired state gaining a tier-0 key.
Measured on shard 1/4: per-tier counts gave 4 regressions, 0 of them tier 0;
tier-0 by identity gave **29, of which 19 were tier 0** (18 titleStruck). The
comparison was never the problem — the **granularity** is. The revert is
all-or-nothing over the whole repair set, so one edge gaining a tier-0 key
discards every other edge's tier-0 fix in the same batch, and a stricter rule
pulls that trigger more often.

The real fix, if the audit needs to get stricter: a **guided partial revert** —
drop only the repair implicated in a gained fatal key, re-settle, re-measure,
repeat. `LADDER.md` warns per-edge reverts once produced `coincident` runs, but
`coincident` is a tier-0 key in the same set the loop checks, so the failure that
killed the naive version is caught by the loop itself. Note that label-side keys
name the *victim* label, not the run that caused it, so "the implicated repair"
needs resolving — probably the repaired edge whose route is nearest the label.

**Also ruled out:** `compactVertical` at `svg-render.ts:430` runs after
`optimiseRoutes` and does move geometry on 25/68 drawings, but measurement shows
it changes **no** tier-0 counts. `LADDER.md`'s "nothing may move edge geometry
after `optimiseRoutes`" is still literally false; it is not what was breaking
things.

## Verifying

`npm run sweep` is ~64s, which exceeds some agent tool timeouts. Shard it:

```
for i in 1 2 3 4; do
  node --experimental-strip-types scripts/sweep.ts --shard=$i/4 --emit-json > /tmp/r$i.json
done
```

then merge the four `totals`/`perDrawing` blobs and apply `CEILING_RATE` plus the
per-drawing `TIER` rule from `scripts/sweep.ts`. `--jobs=auto` does this properly
in-process on a machine with ≥4 cores.

Single-case loop, and the canonical cases:

```
node --experimental-strip-types scripts/sweep.ts --only=logical.cairn --detail
node --experimental-strip-types src/cli.ts build examples/dispositions/infrastructure-small-tall.cairn -o /tmp/x.svg
```

## Open items, unrelated to this work

1. **Three ceilings were already breached on `main`**: `attachTight`,
   `fanTangle`, `nearParallel`. `npm test` is therefore red on `main`, and
   because it is `sweep && node --test`, the test files never run. Separately,
   `behavior.test.ts` has one pre-existing failure
   (`application.cairn BILL_ISSUE|east|47`, F07/F08 6px apart).
2. **`fanTangle` passing at 59/59 after `612b46e` is an artefact** — ten fan
   tangles left the numerator with the deleted fixtures; nothing improved.
3. **`examples/application.cairn` and `examples/application-medium.cairn` are
   byte-identical.** Both names are referenced (tests; README image).
