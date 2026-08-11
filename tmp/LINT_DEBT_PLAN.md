# Plan — clear the remaining complexity debt

`npm run typecheck` is **clean** (exit 0) with all six new compiler flags on.
Everything below is lint and nesting debt, measured against the tree as of this
run.

**Note on a moving tree:** another session has landed the `tidyEdges`
decomposition — `createTidyContext`, `straightenAndCollapse`,
`reaimWrapAroundTerminals`, `decoincideParallelRuns`, `liftRunsOffTitleBands`,
`nestCorridorRisers`, `unweaveAndClearContainers` are all top-level now and
`tidyEdges` is ~40 lines. That work is **done**; this plan starts after it.
Re-measure before acting if more lands.

---

## 1. The debt, measured

**42 warnings**: 17 cognitive complexity, 13 lines-per-function, 12 max-params.
Plus three files over the nesting default.

### Cognitive complexity (ceiling 60)

| Score | Location | Function |
|---:|---|---|
| **218** | `edge-tidy.ts:821` | inner block of `clearSideHugs` |
| **159** | `label-anchor.ts:110` | `anchorFlowLabels` |
| **132** | `edge-tidy.ts:459` | `clearSideHugs` |
| **129** | `edge-tidy.ts:1222` | `swapCrossingSiblingSeats` |
| **115** | `edge-tidy.ts:2343` | `unweaveAndClearContainers` |
| **107** | `svg-render.ts:286` | `settleLabelPositions` |
| **101** | `edge-tidy.ts:2040` | `decoincideParallelRuns` |
| 86 | `edge-tidy.ts:2124` | `liftRunsOffTitleBands` |
| 84, 82, 72, 68 | `edge-tidy.ts:380/85/471/265` | `spreadAttachments` / `straighten` internals |
| 77 | `slide-fold.ts:179` | `foldedLayout` |
| 76 | `edge-tidy.ts:2734` | `optimiseRoutes` |
| 74 | `edge-tidy.ts:1450` | `straightenAndCollapse` |
| 70 | `tests/behavior.test.ts:136` | test body |
| 61 | `label-anchor.ts:343` | inner block |

### Lines per function (ceiling 150)

| Lines | Location | Function |
|---:|---|---|
| **609** | `route-detour.ts:63` | `rerouteDetours` |
| **599** | `svg-render.ts:79` | `render` |
| **528** | `edge-tidy.ts:459` | `clearSideHugs` |
| **417** | `slide-fold.ts:179` | `foldedLayout` |
| 339 | `edge-tidy.ts:2734` | `optimiseRoutes` |
| 279 | `parser.ts:18` | `parse` |
| 252 | `edge-tidy.ts:1655` | `reaimWrapAroundTerminals` |
| 234 | `readability.ts:89` | `inspect` |
| 219 | `scene-layout.ts:510` | `layout` |
| 213 | `edge-tidy.ts:2343` | `unweaveAndClearContainers` |
| 192 | `edge-tidy.ts:927` | `resideAttempt` |
| 191 | `label-anchor.ts:110` | `anchorFlowLabels` |
| 160 | `readability.ts:200` | `local` |

### Max params (ceiling 4)

`edge-tidy.ts:2961` `laneBeyond` **8** · `edge-tidy.ts:3084` 6 ·
`route-detour.ts:236` 6 · `parser.ts:495` 6 · `tests/sidehug.test.ts:28` 6 ·
`edge-tidy.ts:3034`, `edge-tidy.ts:190`, `route-detour.ts:623`,
`route-detour.ts:803`, `slide-fold.ts:99`, `slide-fold.ts:137`,
`text-metrics.ts:58` all 5.

### Nesting (`npm run nesting`)

`edge-tidy.ts` **16** (`:1118`) · `slide-fold.ts` **13** (`:288`) ·
`scene-layout.ts` 9 · four files at 8 · `watch.ts` 7.

---

## 2. The one observation that sets the order

**`clearSideHugs` is four problems in one place.** `edge-tidy.ts:459-987`
carries cognitive 132 *and* the 218 inner block *and* 528 lines *and* the
worst nesting in the repo (depth 16 at `:1118`, inside `resideAttempt`). No
other site overlaps like this. One campaign there removes the top cognitive
score, the top nesting figure, and two of the four largest functions.

Everything else is ordinary work by comparison.

---

## 3. Campaigns, in payoff order

### C1 — `clearSideHugs` transaction + validator (highest payoff)

`edge-tidy.ts:459-987`. Three propose/validate/revert blocks — `attempt`,
`relocateRiser`, `resideAttempt` — sharing one helper set, with
`relocateRiser` and `resideAttempt` declared *inside* the per-run loop so they
close over `run`/`edge`/`own` and are rebuilt every iteration.

1. Extract the shared route validator first. The same opening ~12 lines
   (orthogonality → run extraction → `runHitsNode` → `runIsClear`) appear in
   every gate here and five more times across the file. `INVARIANTS.md` §3 is
   explicit that duplicated guards drift, and names it as the cause of four
   debugging sessions.
2. Wrap it: `proposeRoute(edge, build, accept)` — validate the *finished*
   polyline, keep or discard wholesale. Partial validation is what merged two
   flows into one line.
3. Lift the three blocks to top-level functions taking their loop state as
   explicit parameters.
4. Guard-clause the survivors: `if (a && b) { … }` → `if (!a) continue;`
   `if (!b) continue;`. Same operands, same short-circuit order — safe.

**Clears:** cognitive 218 and 132; lines 528 and 192; nesting 16 → ~6.
**Then lower** `CEILING["edge-tidy.ts"]` in `scripts/nesting-depth.ts` to what
it actually reaches. The gate prints `← ratchet earned: lower to N`.

### C2 — `label-anchor.anchorFlowLabels`

`:110`, cognitive 159 (second worst in the repo), 191 lines, plus a 61 inner
block at `:343`. Not yet touched by any plan. Same treatment: extract the
per-label seat search, guard-clause the loop body.

### C3 — `route-detour.rerouteDetours`

`:63`, **609 lines** — the largest function left. Phase-extract like
`tidyEdges`: the channel planner, the slot allocator and the acceptance test
are three jobs behind one name. Its cognitive score is already under 60, so
this is purely a size and readability win — lower risk than C1.

### C4 — `svg-render` settling, still a spike

`render` `:79` is 599 lines; `settleLabelPositions` `:286` is cognitive 107.
The extraction target is understood, but the risk is unchanged: settling runs
up to three times, interleaved with the repair audit and
`edge.pts = edge.repairedFrom`, and `RenderResult.overlapsAfter` feeds the
sweep's zero-gated `overlaps` metric (asserted `=== 0` at
`tests/behavior.test.ts:90`). Time-box it. If it stalls, document the stage in
`ARCHITECTURE.md` §2 and stop.

### C5 — the remaining `edge-tidy` phases

`unweaveAndClearContainers` 115/213, `decoincideParallelRuns` 101,
`liftRunsOffTitleBands` 86, `straightenAndCollapse` 74,
`reaimWrapAroundTerminals` 252 lines, `optimiseRoutes` 76/339. These are now
*isolated*, which is the whole point of the extraction that just landed —
each can be split on its own without touching its neighbours. §4g and §4h stay
one function.

### C6 — `slide-fold.foldedLayout`

`:179`, 417 lines, cognitive 77, nesting 13. Same phase pattern. Low traffic,
so it goes last.

### C7 — parameter counts

Twelve sites. Two rules:

- **Bundle only where the call is not hot.** `parser.ts:495` (6),
  `route-detour.ts:236` (6), `text-metrics.ts:58` (5) are fine as option
  objects.
- **In `optimiseRoutes`' inner loops — `laneBeyond` (8 params),
  `edge-tidy.ts:3034`/`:3084` (5–6) — pass a context object created once**, not
  an object literal per call. A literal per invocation allocates inside a hot
  path; `useMaxParams` cannot tell the difference and would happily make the
  code slower.

---

## 4. Tests: a config decision, not a refactor

Two warnings are in `tests/` — `behavior.test.ts:136` (cognitive 70) and
`sidehug.test.ts:28` (6 params, a scene-building helper). Test helpers
legitimately take many arguments, and a long assertion body is not the same
defect as a long routing pass.

Recommendation: relax these two rules for `tests/` via a biome override rather
than churn the tests.

```jsonc
"overrides": [
  {
    "includes": ["tests/**/*.ts"],
    "linter": { "rules": { "complexity": {
      "useMaxParams": "off",
      "noExcessiveCognitiveComplexity": { "level": "warn", "options": { "maxAllowedComplexity": 100 } }
    } } }
  }
]
```

Say so explicitly in the config rather than letting two permanent warnings sit
there — a gate people learn to ignore is not a gate.

---

## 5. Ratchet schedule

Tighten only after a campaign lands green. Never raise one to pass.

| After | `maxAllowedComplexity` | `maxLines` | `nesting-depth` CEILING |
|---|---:|---:|---|
| today | 60 | 150 | as calibrated |
| C1 | 60 | 150 | `edge-tidy.ts` 16 → ~6 |
| C1 + C2 | 40 | 120 | — |
| C3 + C5 | 40 | 100 | `scene-layout.ts` 9 → 6 |
| C4 + C6 | 25 | 80 | `slide-fold.ts` 13 → 6 |
| long term | 15 (`error`) | 60 (`error`) | `DEFAULT` 6 everywhere, drop the table |

---

## 6. Verification, every commit

```
npx tsc --noEmit
npm run lint                                                   # biome + nesting gate
node --experimental-strip-types --test tests/corpus.test.ts     # ~14 s
```

Full `npm test` (sweep included) at each campaign boundary.

Pass condition is unchanged and non-negotiable:
**`tests/__snapshots__/corpus.digest` byte-identical, zero baseline writes,
zero snapshot re-approvals.** A campaign that cannot hold that is not a
refactor — revert it.
