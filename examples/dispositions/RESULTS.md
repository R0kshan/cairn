# Disposition × size test matrix — results (2026-07-11)

12 variants: {small, medium, large} × {wide, tall, slide, page}. All validate clean, all build with **0 label overlaps** (§1.1 requirement 1 holds everywhere). Flows always distinct arrows + distinct labels (invariant holds — enforced by construction).

| File | Canvas | Ratio | Target | Layout | Overlaps |
|---|---|---|---|---|---|
| small-wide | 1600×301 | 5.32 | — | 85 ms | 0 |
| small-tall | 499×897 | 0.56 | — | 83 ms | 0 |
| small-slide | 1600×301 | 5.32 | 1.78 | 104 ms | 0 |
| small-page | 499×897 | 0.56 | 0.71 | 105 ms | 0 |

Update (same day): orientation made a **hard constraint** — `slide` always lands landscape (width ≥ height), `page` always portrait; the ratio is a soft target within the correct orientation. large-slide and medium-slide now select RIGHT (4.09 / 4.04, landscape) instead of the numerically-closer portrait candidate.
| medium-wide | 2642×654 | 4.04 | — | 196 ms | 0 |
| medium-tall | 1241×1418 | 0.88 | — | 204 ms | 0 |
| medium-slide | 1241×1418 | 0.88 | 1.78 | 309 ms | 0 |
| medium-page | 1241×1418 | 0.88 | 0.71 | 307 ms | 0 |
| large-wide | 4191×1024 | 4.09 | — | 357 ms | 0 |
| large-tall | 2240×2508 | 0.89 | — | 376 ms | 0 |
| large-slide | 2240×2508 | 0.89 | 1.78 | 620 ms | 0 |
| large-page | 2240×2508 | 0.89 | 0.71 | 622 ms | 0 |

## Visual review

- **small**: excellent in both orientations; tall reads as a clean top-down narrative (actors → system → external).
- **medium**: both orientations readable; tall is the best "document" shape (0.88).
- **large**: readable and traceable (hops help), but exposes the known routing backlog: inter-system stacking order within the middle band is arbitrary (Cœur commerce lands above Front commerce despite feeding from it), and side channels accumulate long parallel runs. No requirement violated; quality item for phase 1 routing work.

## Update 2: fitness = scale-to-fit, not ratio (same day)

Ratio was the wrong metric — what matters is **how big the text is after scale-to-fit on the physical target**. slide/page now maximize that, expanded candidate pool (label re-wrap, tight spacing, min-layer layering), and report it: small-slide **fits a 16:9 slide at 91% (labels ≈ 9.5px)** ✓; medium-slide 54% (≈5.7px) → **W0520 warns**; large-slide 32% (≈3.4px) → **W0520 warns**: 34 elements / 42 flows exceed what one slide can show readably, whatever the layout. The warning suggests splitting the view — that guidance IS the correct behavior for a tool whose job includes telling you when your diagram is overloaded. The structural fix for mid-size diagrams (fold systems into stacked rows with gutter routing) is the committed phase 2 layout feature.

## Update 3: folded composite layout for slide mode (same day)

`slide` now has a real structural answer for multi-system diagrams: the **fold** (`src/fold.ts`). Each system is laid out independently by ELK, systems stack as rows in a middle column (actors left, externals right), and inter-group flows route through demand-sized gutters via phantom ports (ELK-routed exit/entry segments inside each system). Lane allocation uses interval coloring (no two overlapping spans share a lane); each gutter reserves a dedicated label zone above its lanes so no lane line can strike through a label.

large-slide: **4191×1024 (4.09) → 2015×1846 (1.09), fit 32% → 39%, 0 label overlaps** — an actual slide-shaped canvas instead of a ribbon. Verified visually across three iterations (fixed: gutter overflow into system boxes, wrong coordinate frame for nested-container edges, lane-through-label strikes).

Remaining gap to exact 16:9 (1.78): rows currently stack in one column; packing small systems side-by-side on a shelf would push toward 1.6–1.8 but requires side-aware entry ports (mirrored internal layouts) — next refinement if needed. Regression sweep: all 12 disposition variants + 4 base examples rebuilt, **0 overlaps everywhere**, non-slide outputs unchanged, small-page improved to 111% fit.

## Honest findings on ratio targeting

1. `page` targets are approached well at medium/large (0.88–0.89 vs 0.71 — prints fine); small undershoots (0.56, a narrow chain has no material to widen).
2. `slide` is the weak mode: no candidate gets near 1.78 when the natural shapes are ~4.0 and ~0.9. True 16:9 fitting needs the band-wrapping post-pass (split long layer chains into rows) — phase 2 candidate, now with measured evidence.
3. Balanced modes cost ~2× layout time (two candidates) — worst case 622 ms, still fine for `build`; `watch` should cache the chosen direction between saves.
