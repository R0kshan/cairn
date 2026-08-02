# Handover — same-side U routes and the post-settle audit

Status at handover: **not landed.** Work is in
`documentation/ai/u-route-wip.patch`, applied on top of `612b46e`. The tree is
clean; `git apply documentation/ai/u-route-wip.patch` to resume.

## The problem this started from

In `examples/logical.cairn`, flow `F19` (`CASE -> POLICYHOLDER`, "Notify steps
and decision") ran west across the whole drawing at a single y, cutting through
the **Reporting layer** — a container holding neither of its endpoints
(`throughContainer`, INVARIANTS §4h, tier 0) — and across that layer's title
(`titleStruck`, §4e, tier 0). It also grazed 2px above the "Supporting-document
collection" box.

The wanted route: up out of `CASE`, west along a free lane, down into
`POLICYHOLDER` — a **U**, leaving both nodes by the same side.

## Three blockers, all now understood

**1. The router could not express a U.** `shapesFor` in `edge-tidy.ts` returned
`[]` for same-facing side pairs ("same-facing sides give a wrap, not a route").
Fixed by `channelU`: two lane candidates per side — just past the nearer seat,
and just outside the drawing — giving a 2-turn route. The premise in the old
comment was wrong: a U is not a weave.

**2. Seat offsets could not reach past a container title.** `SEAT_OFFSETS` is
`[0, -18, 18]`; the U's descent leg needed to clear the "Policyholders" group
title, which ends at x=142 while the seat range only reached x=129. Fixed by
`U_SEAT_OFFSETS = [0, -18, 18, -40, 40]`, applied **only** when `aSide === bSide`
— widening every side pair is what previously tripled build time.

**3. The renderer's repair audit was judging the wrong thing.** This was the real
blocker and it is the interesting one.

`optimiseRoutes` records `repairedFrom` on every route it moves. `svg-render`
then settles labels and decides whether to keep the repair. That decision used to
compare **label damage only**, as a flat count. So it would revert a flow that
had stopped cutting through a layer because putting it back cost one label less
— trading two tier-0 defects for one, invisibly.

Measured directly: with only blockers 1–2 fixed, `logical/slide` was *clean after
layout* (`F19: 969,237 -> 969,55 -> 149,55 -> 149,79`) and *dirty after render*
(`box:F19~REPORTING  title:F19~342,60`) because the audit reverted the U.

Fixed by `stateHarm()` — both states measured the same way, on runs **and**
labels, as a per-tier vector, compared lexicographically. Runs come from
`inspect(...).local(ids, new Map(), true)` (`soloOnly`, so no pairwise phase:
every defect needed is a route against a fixed obstacle).

**A dead end worth not repeating.** Before this, I tried making the audit
tier-aware via a `scene.repairTier` scalar ("a loss at tier T is payable only by
a gain at a tier strictly better"). It does not work: when *both* states carry
tier-0 defects the rule cannot compare magnitudes and reverts unconditionally.
`scene.repairTier` is still added by the patch in `scene-layout.ts` but is now
**unused** — delete it.

Also ruled out: `compactVertical` at `svg-render.ts:430` runs after
`optimiseRoutes` and does move geometry on 25/68 drawings — but measurement shows
it changes **no** tier-0 counts. It is not the leak. `LADDER.md`'s claim that
"nothing may move edge geometry after `optimiseRoutes`" is still literally false,
but it is not what was breaking things.

**4. `attachAway` on U routes.** A channel U necessarily departs away from its
counterpart at both ends. §11 already exempts flows routed through a channel, and
`route-detour` marks its own that way, so `tryMove` now sets `edge.detour = true`
when the committed route is a U, recognised geometrically by `isChannelU`
(4 points, parallel terminal legs, both on the same side of the joining lane).
This alone took shard-1/4 regressions from 12 to 4.

## Where it stands, measured on the full corpus (260 drawings, 3884 flows)

All 7 must-be-zero invariants: **0**. 281 per-drawing improvements, 11
regressions.

| ratchet | before | after | |
|---|---|---|---|
| titleStruck | 714 | **213** | −70% |
| throughContainer | 44 | **20** | −55% |
| turnHeavy | 860 | 620 | |
| jog<=20 | 277 | 161 | |
| crossings | 4256 | 3803 | |
| fanTangle | 69 | 110 | ceiling 59 ✗ |
| nearParallel | 73 | 110 | ceiling 53 ✗ |
| attachTight | 19 | 35 | ceiling 4 ✗ |
| labelPierced | 0 | 7 | ceiling 6 ✗ **new** |
| longDetour | 187 | 175 | ceiling 172 ✗ |

Note `attachTight`, `fanTangle` and `nearParallel` were **already over ceiling on
`main`** (19/4, 69/66, 73/59) — see the three open items below. `labelPierced` and
`longDetour` are newly over.

## What remains

The 11 per-drawing regressions are the work queue:

- **7 × `labelPierced 0 -> 1`** (tier 0) on `logical/page`, `medium/page`,
  `security/{page,tall}`, `dispositions/medium-{slide,tall,page}/page`. A foreign
  run through a floating label. More routes moving into corridors gives the
  settler more collisions. This is the blocking one — nothing buys tier 0.
- **4 × `application-compact/{page,tall}`**: `crossings 2 -> 4`,
  `fanTangle 0 -> 2` (tier 2, unpaid on that drawing).

### The 7 pierces are `stateHarm`'s own fault — fix that first

`stateHarm` compares the two states as **per-tier counts**, lexicographically.
That lets two cleared `titleStruck` pay for one new `labelPierced`, because the
tier-0 total falls from 2 to 1.

The ladder forbids exactly this, twice over:

- LADDER.md tier 0: *"nothing buys a tier-0 loss — not even another tier-0 fix."*
- `sweep.ts` enforces it with a strict comparison, `if (bestGain < item.tier)`,
  so a tier-0 gain cannot pay for a tier-0 loss — which is why these 7 land in
  `regressions` and not in `trades`.
- LADDER.md "sets, not counts": a total cannot see a defect *move*. This is that
  bug, re-introduced in a new place.

The obvious repair is to compare tier-0 by **identity**, like `ladderVerdict`
does: reject the repaired state if it gains any tier-0 defect key, whatever it
clears; counts from tier 1 down, where trading is legal.

**That was tried and it is worse. Do not repeat it.** Measured on shard 1/4:

| audit rule | regressions | of which tier 0 |
|---|---|---|
| per-tier counts, lexicographic (the patch) | 4 | 0 |
| tier 0 by identity, all-or-nothing revert | 29 | **19** (18 titleStruck, 1 throughContainer) |

The strict rule makes tier 0 *worse* because of the audit's **granularity**, not
its comparison. The revert is all-or-nothing over the whole repair set, so one
edge gaining a tier-0 key throws away every other edge's tier-0 fix in the same
batch. Tightening the rule just triggers that more often.

So the real next step is a **guided partial revert**: when the kept state gains a
fatal key, drop only the repair implicated in it, re-settle, re-measure, repeat
until no fatal is gained. `LADDER.md` warns that per-edge reverts produced
`coincident` runs (a must-be-zero breach) — but `coincident` is itself a tier-0
key in the `fatal` set, so a guided loop that re-measures after every drop
catches exactly what killed the naive per-edge version.

The awkward part: label-side fatal keys (`pierce:`, `adrift:`, `ltitle:`) name
the *victim* label, not the run that caused it, so "the repair implicated in it"
needs resolving — probably the repaired edge whose route is nearest the label
box. Route-side keys already carry the edge id.

Only if pierces survive that is a router-side term worth adding: `readability`
models labels solely as "is there somewhere to sit" (`unlabelled`, tier 1) and
has no pierce term, so it cannot avoid creating one. If you add it, take the
predicate from `sweep.ts` rather than writing a second one (INVARIANTS §3), and
note the tension: `readability.ts`'s header states a router cannot evaluate label
placement because labels move after every geometry pass. A pierce term would be
the first label-position-dependent term in the file, working off the provisional
boxes `label-anchor` seated. Defensible — `hug` and `unlabelled` already
approximate — but it deserves a comment saying so.

## Verifying

`npm run sweep` is ~64s, which exceeds some agent tool timeouts. Shard it:

```
for i in 1 2 3 4; do
  node --experimental-strip-types scripts/sweep.ts --shard=$i/4 --emit-json > /tmp/p$i.json
done
```

then merge the four `totals`/`perDrawing` blobs and apply `CEILING_RATE` and the
per-drawing `TIER` rule from `scripts/sweep.ts`. `--jobs=auto` does this properly
in-process on a machine with ≥4 cores.

Fast single-case loop:

```
node --experimental-strip-types scripts/sweep.ts --only=logical.cairn --detail
```

`logical.cairn` is the canonical case: 0 regressions, 13 trades, 11 improvements
with the patch applied, and F19 takes the U.

## Landed separately (already on main)

- `a53bb2e` optimiser speedups — memoised unmoved profile, `soloOnly` early
  reject. Corpus build 125s → 71s, byte-identical output.
- `2db8bc5` `--jobs`/`--emit-json` on the sweep.
- `612b46e` deleted 7 no-op `-wide` fixtures. Corpus 288 → 260 drawings.

## Open decisions for the maintainer

1. **Three ceilings were already breached on `main`** before any of this work:
   `attachTight` 19/4, `fanTangle` 69/66, `nearParallel` 73/59. `npm test` is
   therefore red on `main`, and because it is `sweep && node --test`, the test
   files never run. Separately, `behavior.test.ts` has one pre-existing failure
   (`application.cairn BILL_ISSUE|east|47`, F07/F08 6px apart).
2. **`fanTangle` passing is an artefact.** Deleting the `-wide` fixtures moved it
   from 69/66 (failing) to 59/59 (passing) with nothing improved — see `612b46e`.
3. **`examples/application.cairn` and `examples/application-medium.cairn` are
   byte-identical.** Both names are referenced (tests; README image).
