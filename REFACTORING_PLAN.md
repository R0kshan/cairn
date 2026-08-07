# cairn — refactoring plan (v2)

Review of `src/` (11,962 lines, 29 files) at `abc4ff5` (v1.0.0-RC10). **Proposal only — nothing implemented.**

v2 adds: a no-regression protocol for the ladder and invariants (§2), cyclomatic complexity measurement and remediation (§4), and a comment policy (§5).

---

## 1. Verified baseline

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npx biome lint src tests` | clean, 35 files |
| Tests | `node --experimental-strip-types --test "tests/*.test.ts"` | **90/90 pass, 158 s** |
| Sweep | `npm run sweep` | >10 min (not completed in review) |

---

## 2. No-regression protocol — ladder and invariants

This is the governing section. Everything else is subordinate to it.

### 2.1 What already guarantees this

The repo has built exactly the machinery needed. The refactor's job is to **not touch it**:

| Gate | Artefact | Enforces |
|---|---|---|
| Invariants | `MUST_BE_ZERO` (`sweep.ts:38`) — `overlaps`, `diagonal`, `throughBox`, `deadBand`, `coincident`, `attachShared`, `labelAdrift` | tier-0, must stay 0 |
| Ladder ratchet | `CEILING_RATE` (`sweep.ts:50`) — per-flow rate ceilings | corpus-wide debt |
| Per-drawing floors | `readability.baseline` — 823 lines, 288 drawings × defect kind | *no single drawing gets worse* |
| Geometry | `corpus.digest` | every coordinate, colour, glyph |
| Fidelity | `*.snap.svg`, `examples/*.svg` | full output |

The per-drawing baseline is the important one: the sweep's own header (`sweep.ts:354`) notes that corpus totals alone can "improve sixty drawings and quietly make one worse."

### 2.2 The rules

**Rule 1 — `--update-baseline` is forbidden for the entire refactor.**
Not "used carefully." Forbidden. A behaviour-preserving change has no reason to move a defect floor. If the sweep demands an update, the change was not behaviour-preserving. This single rule is what makes ladder regression structurally impossible rather than merely unlikely.

**Rule 2 — no snapshot re-approval.** Same logic for `npm run snapshots` and `examples/*.svg`.

**Rule 3 — `corpus.digest` unchanged after every commit.** The fast gate.

**Rule 4 — `MUST_BE_ZERO` and `CEILING_RATE` are not edited.** They are calibration, not configuration.

If any of Rules 1–4 would need breaking, **revert the commit** rather than re-approve the artefact.

### 2.3 Two-tier verification

The sweep is >10 min — too slow per commit. But the digest is a near-complete proxy: ladder metrics are computed by `inspect()` from scene geometry, and the digest fingerprints what that geometry renders to. Identical digest ⟹ identical routes, nodes and labels ⟹ identical ladder verdict.

*Near*-complete, not complete: a few scene fields never reach the SVG (`detour`, `repairedFrom`, `repairTier`). So:

- **Per commit (seconds):** `tsc --noEmit` + `biome lint` + `node --experimental-strip-types --test tests/corpus.test.ts`
- **Per phase (full):** `npm test`, sweep included, with **zero** baseline writes

### 2.4 The determinism constraint

Byte-identical SVG is an invariant, and floating-point addition is not associative.

- **Safe:** moving a block into a function; renaming; extracting a closure that captures the same values; deleting an unused export; naming a constant with the same literal value.
- **Unsafe — and therefore forbidden, per Rule 2:** reordering arithmetic; `for` → `reduce`; changing accumulation order; `Math.abs(a)+Math.abs(b)` → `Math.hypot`; changing `Map`/`Set` insertion order; a non-stable sort comparator.

Worked example — merging the three path-length copies (§6.5) *is* safe: `route-detour` accumulates `pts[i] - pts[i-1]` for `i = 1..n-1`, `edge-tidy` accumulates `pts[i+1] - pts[i]` for `i = 0..n-2`. Same terms, same order, float-identical. Every such merge needs this argument made explicitly in the commit message, not assumed.

**Consequence for the complexity work:** guard-clause rewrites and de-nesting must preserve short-circuit evaluation order. `if (a && b)` → nested `if` is safe; reordering to `if (b && a)` is not.

---

## 3. What is **not** wrong

- **Type safety is good.** One `: any` in all of `src/`, 11 non-null assertions, no `@ts-ignore` — despite biome having `noExplicitAny` and `noNonNullAssertion` switched off.
- **No speculative abstraction.** No single-implementation interfaces, no registries, no premature generics.
- **Dependencies are disciplined.** One runtime dep (`elkjs`), three dev deps. Add none.
- **Zero restate-the-code comments.** Searched the whole `// Loop through…` / `// Check if…` / `// Return the…` family across 11,962 lines: **not one instance.** See §5.

---

## 4. Cyclomatic complexity

### 4.1 Measurement

Decision points (`if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`, `?:`), comments and string literals stripped, brace-matched per function.

| CC | Lines | Location | Function |
|---:|---:|---|---|
| **450** | 1301 | `edge-tidy.ts:1380` | `tidyEdges` |
| **319** | 745 | `edge-tidy.ts:468` | `clearSideHugs` |
| **246** | 930 | `svg-render.ts:79` | `render` |
| **209** | 893 | `route-detour.ts:79` | `rerouteDetours` |
| **143** | 347 | `readability.ts:116` | `inspect` |
| **135** | 653 | `edge-tidy.ts:2719` | `optimiseRoutes` |
| **108** | 216 | `parser.ts:352` | `applyStyleEntry` |
| **104** | 516 | `slide-fold.ts:179` | `foldedLayout` |
| 86 | 358 | `label-anchor.ts:118` | `anchorFlowLabels` |
| 84 | 144 | `edge-tidy.ts:1235` | `swapCrossingSiblingSeats` |
| 61 | 175 | `edge-tidy.ts:276` | `spreadAttachments` |
| 57 | 344 | `scene-layout.ts:518` | `layout` |

Distribution over 80 top-level functions — **total CC 2,604**:

| Band | Count |
|---|---:|
| 1–10 (simple) | 49 |
| 11–20 (moderate) | 12 |
| 21–50 (complex) | 7 |
| 51–100 (very high) | 4 |
| **>100 (effectively untestable)** | **8** |

Eight functions carry ~1,700 of the 2,604 total. `edge-tidy.ts` also reaches **32 columns of indentation — nesting depth 16**.

### 4.2 The critical distinction: aggregated vs. intrinsic

Not all high CC is the same problem, and treating it as one would be a mistake.

`tidyEdges`, broken down by the phases its own comments already name:

| CC | Lines | Phase |
|---:|---:|---|
| 12 | 49 | setup + shared predicates |
| 60 | 204 | straighten + S-curve collapse |
| **188** | 481 | §4c re-aim wrap-around terminals |
| 31 | 75 | §4e lift off title bands |
| 49 | 156 | §4f nest corridor risers |
| **115** | 324 | §4g/§4h unweave + container clear |

**CC 450 is aggregation, not one tangled algorithm.** Pure extraction — moving code, changing nothing — takes the worst function from 450 to 188, with five of six phases under 60. Cheapest and safest complexity win available.

`clearSideHugs` is the opposite case:

| CC | Lines | Third |
|---:|---:|---|
| 100 | 233 | scan / collect |
| 105 | 250 | candidate generation |
| 116 | 262 | accept / revert |

Uniformly branchy — **splitting it into three functions leaves three CC-100 functions.** It needs real simplification (the transaction helper of §6.9, table-driven candidate generation), which is riskier and should follow, not lead.

### 4.3 Enforcement — no new dependency required

Biome already ships `complexity/noExcessiveCognitiveComplexity` (since 1.0, default threshold 15). Enabled against the current tree:

| Threshold | Violations |
|---:|---:|
| 15 | 70 |
| 25 | 43 |
| 40 | 27 |
| **60** | **19** |

By file at threshold 15: `edge-tidy` 33, `scene-layout` 10, `svg-render` 6, `route-detour` 4, `parser` 4, `label-anchor` 3, others 1–2.

**Proposal: add it as a ratchet, exactly like `CEILING_RATE`.** Start at 60 (`warn`), tighten as phases land, promote to `error` once clean at target. Trajectory: **60 → 40 after Phase 3 → 25 after Phase 4a → 15 long-term.**

This matches the repo's existing culture — a debt ceiling that only moves down — and it makes complexity a gate rather than something a reviewer has to notice.

```jsonc
"complexity": {
  "noForEach": "off",
  "noExcessiveCognitiveComplexity": {
    "level": "warn",
    "options": { "maxAllowedComplexity": 60 }
  }
}
```

> Biome truncates at 20 diagnostics by default. Use `--max-diagnostics=300` or the counts silently under-report.

### 4.4 Remediation per function

| Function | CC | Approach | Phase |
|---|---:|---|---|
| `tidyEdges` | 450 | pure extraction into 6 named phases → max 188 | 3a |
| §4c sub-pass | 188 | split *after* isolation, not before | 3b |
| `clearSideHugs` | 319 | intrinsic — transaction helper + table-driven candidates | 3c |
| `render` | 246 | ~400 lines are layout, not rendering (§6.3) | 4b |
| `rerouteDetours` | 209 | same phase pattern; lower traffic | defer |
| `optimiseRoutes` | 135 | transaction helper absorbs propose/revert branches | 3c |
| `applyStyleEntry` | 108 | **best quick win** — likely a dispatch chain → lookup table | 2 |
| `inspect` | 143 | one function per defect kind; already a natural table | 3d |
| `foldedLayout` | 104 | same treatment; low traffic | defer |

`applyStyleEntry` deserves the callout: highest CC-per-line in the codebase, sitting in the parser where the safety net is strongest (`behavior.test.ts` covers parser and validator directly). Good first target to prove the protocol works.

---

## 5. Comments — measured, then a policy

You asked to reduce bloated comments so the code is self-explanatory. Here are the numbers first, because they change the recommendation.

### 5.1 What is actually there

1,999 comment lines across 376 blocks in `src/`:

| Block size | Blocks | Lines |
|---|---:|---:|
| 1 line | 103 | 103 |
| 2–3 lines | 78 | 190 |
| 4–6 lines | 95 | 487 |
| 7–12 lines | 70 | 612 |
| **13+ lines** | **30** | **607** |

Composition matters more than volume. Representative, `edge-tidy.ts:41`:

> *"Kept at 6 deliberately: collapsing wider steps means moving a run by that much, and a sweep over every example × disposition showed 20px trading 264 staircases for 24 flows dragged through node boxes, 12 merged lines and 14 shared attachment points."*

**No amount of renaming makes code express that.** It is a measurement of a rejected alternative. Delete it and the next contributor raises `JOG_SNAP` and reintroduces a bug already fixed once. The repo's own `CLAUDE.md` frames these as *"facts an agent cannot infer from the code."*

So: no bloat in the sense of comments restating code — **zero instances**. But there is bloat in a different, real sense.

### 5.2 The real problem: misplacement, not excess

`scene-layout.ts:692` is a 25-line block stacked in front of **one statement**. It holds four unrelated rationales: why repair runs after compaction; why title boxes are re-derived; why the repair is audited rather than refused; why the snapshot is a deep copy.

That is unreadable *because it is in the wrong place*, not because it is too long. Each rationale belongs on the thing it explains.

**So the extraction work of §4 and the comment work are the same job.** Split `layout()` into named stages and those four rationales become four short doc comments, each on its own function — and each function's *name* now carries the "what", leaving the comment to carry only the "why". That is what "self-explanatory code" means here, and it is reachable.

### 5.3 Policy

Three buckets, applied during extraction:

**Keep, attached to the extracted function (majority).** Anything recording a calibration, a rejected alternative, a shipped regression, an elk quirk, or an ordering constraint. Moves with the code it explains; wording untouched.

**Relocate (the 30 blocks of 13+ lines, 607 lines).** Long forensic narratives go to the existing `documentation/` tree — `LADDER.md` for ladder-trade stories, `documentation/decisions/` for the ADR-shaped ones (four ADRs already exist) — leaving a one-line pointer in code. Candidates: `edge-tidy.ts:1` (32 lines), `edge-tidy.ts:2925` + `:3002` (62 between them), `readability.ts:1` (36), `scene-layout.ts:692` (25), `svg-render.ts:481` (22).

**Delete (small).** Genuine redundancy only — the duplicated doc comment on `MIN_ATTACH_GAP`/`MIN_SLOT_GAP` (§6.5), and comments made redundant by a rename. If a comment states *what* and a better name can state it instead: rename, delete.

**Target: in-code comment lines down ~35% (≈1,999 → ≈1,300) with zero knowledge lost** — because the reduction comes from relocation and from names absorbing the "what", not from deletion.

**Non-negotiable:** no *why* comment is deleted without its content landing somewhere in `documentation/`. That knowledge was paid for in shipped bugs.

If you want a harder cut than that, I'd rather talk it through first — I think it would cost more than it returns, and it's better to say so now than after the fact.

---

## 6. Structural findings

### 6.1 Five functions are 38% of source
`tidyEdges` 1301, `render` 930, `rerouteDetours` 893, `clearSideHugs` 745, `optimiseRoutes` 653. 13 of 108 top-level functions are ≥120 lines.

### 6.2 `tidyEdges` is already a pipeline, unwritten as one
Only 422 of 1301 lines are its 20 nested closures. The rest is straight-line phase code the comments already name (§4.2).

### 6.3 `render()` performs layout
~400 of 930 lines mutate the scene: `label.x`/`label.y` at `:364, 388, 401`; `edge.pts = edge.repairedFrom!` at **`:524`**. `CLAUDE.md` states *"nothing may move edge geometry after `optimiseRoutes`"* — line 524 does. It is deliberate and well-argued (`:409-433`), but it means **the pipeline diagram in `CLAUDE.md` is missing its last stage**, hidden inside the renderer.

### 6.4 The pipeline ordering is invisible
`scene-layout.ts:669-770` is the real pipeline, as bare sequential statements inside a 344-line function, surrounded by ~200 lines of comments each recording a shipped regression (`:674` stale title boxes; `:692` 17 tier-0 regressions; `:746` batch-revert of F19's fix). The knowledge is captured; its structure is not.
Also: `titleBoxesOf(folded, model)` recomputed three times at `:812, :813, :818` — it measures text, so not free.

### 6.5 Duplicated primitives

| Duplicate | Locations |
|---|---|
| `interface Point` | `geometry.ts:18`, `edge-tidy.ts:79`, `readability.ts:41`, `route-detour.ts:40` |
| Manhattan path length | `edge-tidy.ts:1686` (`pathLength`), `edge-tidy.ts:2466` (`lengthOf`), `route-detour.ts:45` (`pathLength`) — two in the *same file* |
| `MIN_ATTACH_GAP` / `MIN_SLOT_GAP` = 12 | `edge-tidy.ts:51`, `route-detour.ts:35` — identical value, **identical doc comment** |
| `Side` | `edge-tidy.ts:84` (`"north"`), `scene-layout.ts:443` (`"NORTH"`) |

### 6.6 `TitleBox` is in the wrong module
Declared in `route-detour.ts:57`, consumed by five modules. Structurally identical to `Box` in `geometry.ts`.

### 6.7 `SceneNode`/`SceneLabel` don't extend `Box`
Both carry `x, y, width, height` without declaring it → **13 `as Box` casts**.

### 6.8 `titleBoxes = []` default silently disables an invariant
Six exported passes default it to empty, disabling title-band protection (§4e) without failing. Every production call site passes it; only `tests/sidehug.test.ts` relies on the default.

### 6.9 The propose/validate/revert transaction is copy-pasted ~14×
`edge-tidy.ts:24-28` states the rule and the bug that violating it caused. Re-implemented by hand at `:97, 678, 861, 1026, 1045, 1251, 1443, 1488, 2030, 2159, 2331, 2337, 3162, 3286` under six names (`pts`, `before`, `beforeSimplify`, `attempt`, `probe`, `current`). Nothing structurally stops the next one validating only the changed part.

### 6.10 Magic numbers and convention drift
`edge-tidy.ts`: 6 named constants vs 46 raw `0.5` tolerances and bare thresholds (`24`, `400`, `36`, `20`, `11`, `14`, `48`). `index` (32) vs `i` (23); `(point) =>` (3) vs `(p) =>` (17).

### 6.11 Nineteen gratuitous exports
Never imported anywhere: `buildMatrixRows`, `MatrixRow`, `darkPalette`, `Palette`, `Theme`, `logicalView`, `applicationView`, `infrastructureView`, `securityView`, `NestingRule`, `errorPanelSvg`, `CHIP_HEIGHT`, `FONT_SIZE_BASE`, `DEFAULT_FONT_SIZE_EDGE`, `RenderResult`, `LaidOutLabel`, `LaidOutEdge`, `CompileResult`, `UIStrings`.

---

## 7. Phases

### Phase 0 — Instrument
- Fast digest-only pre-flight (§2.3); optional `sweep --changed` subset mode
- Add `noExcessiveCognitiveComplexity` at **60**, level `warn` (19 violations, no new dep)
- Commit the pre-refactor digest as reference

**Gate:** `npm test` green, zero baseline writes. **Risk: none.**

### Phase 1 — Types and primitives
Delete local `Point`s → `geometry.ts`; `SceneNode`/`SceneLabel extends Box` (drops 13 casts); `SceneEdge.pts: Point[]`; move `TitleBox`/`titleBoxesOf` out of `route-detour` (prefer `TitleBox = Box` alias); unify `MIN_ATTACH_GAP`/`MIN_SLOT_GAP`; merge the three path-length copies; unify `Side` casing; drop the 19 exports.

**Gate:** digest unchanged. Steps 1–3 and 8 are type-level and *cannot* change output. **Risk: very low.** Check `bin/` and `playground/api` before any rename.

### Phase 2 — Naming, constants, first CC win
Name the `0.5` orthogonality tolerance (`ORTHOGONAL_EPSILON`, 46 uses) and remaining thresholds; settle `index`/`i` and `point`/`p` per file; **rework `applyStyleEntry` (CC 108 → target <25)** as a lookup table.

*Out of scope:* abbreviated theme keys in `themes.ts` (`pal`, `cFill`, `sub`, `lv`, `blueF`). Cryptic, but a dense data table where terseness earns its keep. Add a legend comment on `ThemeSpec` instead.

**Gate:** digest unchanged. **Risk: very low.** Constants must preserve literals exactly.

### Phase 3 — Decompose `tidyEdges`

**3a — pure extraction.** Six phases lifted to top-level functions over a `TidyContext` carrying the shared predicates. No logic change. CC 450 → 188. `tidyEdges` becomes ~20 lines listing its phases in order.

```ts
interface TidyContext {
  scene: Scene; leaves: SceneNode[]; titleBoxes: Box[]; folded: boolean;
  runsExcept(...edgeIds: string[]): Runs;
  runHitsNode(vertical: boolean, at: number, from: number, to: number): boolean;
  runIsClear(others: Run[], at: number, from: number, to: number): boolean;
  enforceOrthogonal(edge: SceneEdge): void;
}
function straightenAndCollapse(ctx: TidyContext): void;      // CC  60
function reaimWrapAroundTerminals(ctx: TidyContext): void;   // §4c, CC 188
function liftRunsOffTitleBands(ctx: TidyContext): void;      // §4e, CC  31
function nestCorridorRisers(ctx: TidyContext): void;         // §4f, CC  49
function unweaveAndClearContainers(ctx: TidyContext): void;  // §4g+§4h, CC 115
```

**3b** — split §4c (CC 188), *after* isolation, never before.

**3c** — introduce the transaction helper, then apply to `clearSideHugs` and `optimiseRoutes`:

```ts
/** Propose a route; validate the FINISHED polyline; keep or revert wholesale.
 *  Partial validation merged two flows into one line — see edge-tidy.ts header. */
function proposeRoute(edge: SceneEdge, build: (pts: Point[]) => Point[] | null,
                      accept: (pts: Point[]) => boolean): boolean;
```

The one place this plan *adds* an abstraction. Justified: names a real domain contract, removes 14 duplications, and turns a documented invariant into something enforced rather than remembered.

**3d** — `inspect` (CC 143) → one function per defect kind.

**Gate:** digest after every extraction; full `npm test` + sweep at the 3a and 3c boundaries; tighten CC threshold to 40.

**Risk: medium.** Two hazards: §4g and §4h share one reroute loop (`:2503`) and are **not** separable; and `enforceOrthogonal` is a 205-line closure whose top-level twin `enforceOrthogonalOn` **already exists at `:218`** — check whether the closure is now redundant.

### Phase 4 — Layout / rendering separation

**4a.** Turn `scene-layout.ts:669-770` into a named, ordered stage list, carrying each comment onto its stage (§5.2). Makes the ordering inspectable and testable. Fix the triple `titleBoxesOf`.

**4b.** Lift label settling (`svg-render.ts:155-580`) into `label-settle.ts`. `render()` becomes scene → string, no mutation; CC 246 drops sharply.

**Risk: high for 4b.** The audit at `:409-433` depends on running after settling, which depends on final label positions, which depends on themes and font metrics resolved *inside* `render()`. The coupling is real — extracting means threading a resolved-style object out first.

**Recommendation: do 4a; treat 4b as a time-boxed spike.** If the style dependency is deeper than it looks, the right outcome is to **document the stage in `CLAUDE.md`'s pipeline diagram and stop.** A documented irregularity beats a risky untangling of correct code.

**Gate:** full sweep, zero baseline writes; tighten CC threshold to 25.

---

## 8. Deliberately excluded

| Not doing | Why |
|---|---|
| Deleting *why* comments | Zero noisy instances; content unrecoverable from code (§5) |
| Build step / `dist/` | `CLAUDE.md` forbids it; `.ts` imports intentional |
| New dependencies | Complexity enforcement ships with biome already |
| Splitting `themes.ts`/`views.ts` | Flat data tables — length is not complexity |
| Renaming theme spec keys | High churn, zero behavioural gain |
| `rerouteDetours`, `foldedLayout` | Same pattern applies; defer until Phase 3 proves it |
| Enabling `noExplicitAny`/`noNonNullAssertion` | Policy change, not a refactor (and they would pass) |
| `playground/cairn-engine.js` | Generated bundle |

---

## 9. Cost and sequencing

| Phase | Effort | Risk | Max CC after | Payoff |
|---|---|---|---:|---|
| 0 — instrument + ratchet @60 | S | none | 450 | unblocks everything |
| 1 — types & primitives | M | very low | 450 | high |
| 2 — naming + `applyStyleEntry` | S–M | very low | 450 | medium |
| 3a — extract `tidyEdges` phases | M | medium | **188** | **highest** |
| 3b–3d — split §4c, transaction, `inspect` | L | medium | ~90 | high |
| 4a — explicit pipeline | M | medium | ~90 | high |
| 4b — settling out of render | L | high | ~60 | medium — **spike first** |

Phases 0–2 are worth doing regardless. **Phase 3a is the single highest-value step**: pure code movement, no logic change, worst function from CC 450 to 188.

Phase 4b is the only item that might reasonably be abandoned after investigation — and if it is, that belongs in `documentation/decisions/` as an ADR, not silently dropped.
