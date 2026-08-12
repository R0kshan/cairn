# Complexity debt — status record

The campaign described by the earlier version of this file has landed. This is
what actually happened, measured, so the next session starts from the tree as it
is rather than from a stale map.

**Baseline** is `70df40a` (`Refactor (WIP)`), measured with the six compiler
flags and the biome gate already in place.

---

## 1. Result

| Rule | Baseline | Now |
|---|---:|---:|
| `noExcessiveCognitiveComplexity` | 19 | **0** |
| `noExcessiveLinesPerFunction` | 8 | **2** |
| `useMaxParams` | 15 | **0** |
| **total** | **42** | **2** |

Worst scores, before → after:

- cognitive: **255** (`readability.local`) → **58** (`label-anchor.ts:209`)
- parameters: **10** (`tryResideCandidate`) → **4** (every function in `src`)
- nesting: **13** (`slide-fold`) → **10** (`edge-tidy`)

Five files went from carrying debt to completely clean: `readability.ts`,
`route-detour.ts`, `slide-fold.ts`, `parser.ts`, `scene-layout.ts`.

---

## 2. What the earlier plan got wrong

Worth recording, because both errors came from measuring once and acting later.

- **`readability.ts` was the worst file in the repo and the plan never listed
  it as a campaign.** It appeared only under *lines*; its `local` closure scored
  **255**, the highest anywhere. It was also the cheapest to fix — an inspector,
  pure computation, no geometry mutation — so it went first and cleared three
  warnings in one pass.
- **C3 was described as "purely a size and readability win — lower risk than
  C1", on the grounds that `rerouteDetours` scored under 60.** Against the
  measured tree it scored **246**. The claim came from an older measurement. The
  campaign was fine, but it was never the low-risk one.

The lesson is the one `WORKING_METHODOLOGY.md` already states: re-measure before
acting. Both mistakes are invisible until you run the gate.

---

## 3. Duplication removed (§3)

The extractions were worth more than the scores suggest, because several
collapsed genuinely duplicated guards — the drift `INVARIANTS.md` §3 names as the
cause of four debugging sessions:

- `route-detour.findSideApproach` replaces **five** near-identical "try each
  delta beside the node for a clear descent" blocks. They had already drifted:
  only some carried the `x < 4` canvas guard.
- `edge-tidy.seatedLabelsExcept` replaces **three** copies of the seated-foreign-
  label scan; `segmentGapSq` / `segmentTouchesBox` replace four more copies of
  the segment-to-box gap formula.
- `readability.memoise` replaces three near-identical per-edge cache blocks.
- `SEAT_OFFSETS` is now one constant shared by the reaim and unweave searches,
  which previously kept private copies of the same ladder.

---

## 4. What is left

Two warnings, both `noExcessiveLinesPerFunction`, both orchestrators rather than
complex code — every cognitive and parameter warning in `src` is gone.

| Lines | Location | Why it was left |
|---:|---|---|
| 568 | `svg-render.ts` `render` | The settling / repair-audit interplay the earlier plan flagged: settling runs up to three times interleaved with the audit and `edge.pts = edge.repairedFrom`, and `RenderResult.overlapsAfter` feeds the sweep's zero-gated `overlaps` metric (asserted `=== 0` at `tests/behavior.test.ts`). The **cognitive** spike there (`settleLabelPositions`, 107) *was* cleared — what remains is size alone. |
| 308 | `edge-tidy.ts` `optimiseRoutes` inner block | Splitting it means separating the seat / lane / shape / ladder models, which share a mutable `generation` counter that invalidates several caches. Mechanical but coupled; the driver loop was already extracted, which is what cleared its cognitive 76. |

Neither is complexity debt. Both are "one function holds a long sequence of
steps" — real, but a different kind of risk, and worth doing deliberately rather
than as the tail of a long session.

---

## 5. Ratchets taken

Tightened only after the work landed green; none was ever raised to pass.

- `biome.json` `maxAllowedComplexity`: **60 → 58**, the exact figure the tree now
  reaches. It cannot go lower without decomposing `label-anchor.ts:209` (58),
  `scene-layout.ts:431` (57) and `lexer.ts:27` (56) — those are the next targets
  if the score is to keep coming down.
- `useMaxParams` stays at **4**: every function is now at or under it, so the
  rule is exactly tight. Going to 3 would raise 55 warnings.
- `maxLines` stays at **150** — it cannot tighten while the two functions above
  exceed it.
- `scripts/nesting-depth.ts` `CEILING` shrank from seven entries to four:
  `readability.ts` (8→5), `route-detour.ts` (8→6) and `slide-fold.ts` (13→6) all
  dropped to or below the `DEFAULT` of 6 and were removed from the table
  entirely; `scene-layout.ts` 9→7, `edge-tidy.ts` 11→10, `svg-render.ts` 8→7.

---

## 6. Verification

Every campaign was verified the same way, and the pass condition never moved:

```
npm run typecheck                                            # clean, exit 0
npm run lint                                                 # biome + nesting gate
node --experimental-strip-types --test tests/corpus.test.ts  # after every edit
npm test                                                     # at each campaign boundary
```

**`tests/__snapshots__/corpus.digest` stayed byte-identical throughout** —
SHA-256 `1150A1C16008BC2856FB1FD42BAC39EC4383E0EC7C8EE62E60FF15A625E1AB26`,
unchanged from the baseline commit to the final state. Zero baseline writes, zero
snapshot re-approvals, 97/97 tests green at every boundary.

One extra check was needed. `slide-fold`'s output is used only when it wins a
fit-score comparison against the default layout, so an unchanged digest would not
by itself prove the refactor was a no-op — it could simply have lost. The old and
new `foldedLayout` were run side by side over all nine `slide` examples: three
produce a real folded layout with identical structural hashes, six correctly
return `null` in both. That harness was temporary and is not in the tree.

---

## 7. Regressions caught during the work

Recorded because they show what the gates are for:

- Extracting `spreadAttachments` introduced a **new** rule violation
  (`useIterableCallbackReturn`) by giving a `forEach` callback an implicit
  return. Caught by the next lint run, fixed with a block body.
- The first draft of `slide-fold.routeConnector` made the `"D"`-class left-side
  seat **eager** where the original computed it lazily inside the branch. On a
  flow whose endpoint box was missing from the map that would have thrown where
  the original never evaluated it. Caught by re-reading the diff before running,
  and restored to lazy.
