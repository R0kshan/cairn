# ELK layout engine — evaluation

**Date:** 2026-07-11 **Context:** Selecting the core layout engine for cairn's diagram compilation pipeline.

## Source

[Eclipse Layout Kernel (ELK)](https://www.eclipse.org/elk/) is an academic layout framework developed at Kiel University, available as a Java library and as a JavaScript port ([elkjs](https://www.npmjs.com/package/elkjs), ~2.7M weekly npm downloads as of 2026-07, actively maintained).

## Why ELK fits architecture diagrams

ELK was designed for directed graph layout with strong constraint support, which maps directly onto architecture-diagram conventions:

| Architecture need | ELK capability |
|---|---|
| Semantic bands (actors left, systems middle, externals right) | `elk.partitioning.partition` — per-node partition assignment |
| Layer ordering and constraints | `elk.layered.layering.layerConstraint` — FIRST, LAST, SEPARATE |
| Nested containers (site → zone → server) | `elk.hierarchyHandling: INCLUDE_CHILDREN` — full container nesting |
| Orthogonal edge routing | `elk.edgeRouting: ORTHOGONAL` |
| Compact output with minimal whitespace | Post-compaction via `NETWORK_SIMPLEX` + `EDGE_LENGTH` strategy; tunable spacing options |
| Label space reservation (no overlaps) | Edge labels treated as layout nodes — space reserved *during* layout, not painted after |
| Deterministic output (byte-identical across runs) | Deterministic algorithms when no random tie-breaking is enabled |
| Slide/page fit | `elk.aspectRatio` + multi-candidate evaluation (RIGHT/DOWN, label wraps, tight spacing) |

**Likelihood of future maintenance:** High — academic team with active publications, 2.7M weekly npm downloads, regular releases.

## Pain-point mapping

How ELK addresses (or does not address) cairn's three non-negotiables (see [DESIGN_BRIEF.md §1.1](/documentation/DESIGN_BRIEF.md)):

| Non-negotiable | ELK native | Post-pass layer adds | Spike-validated |
|---|---|---|---|
| **No label overlap** (incl. A↔B bidirectional pairs) | ◑ Edge labels are layout nodes — space reserved during layout. This is the root cause of Mermaid/D2 overlap. | Detect residual overlap, offset/stack labels, parallel-edge separation. Each flow keeps a distinct arrow with a distinct label (**merging forbidden**). | **Verified:** 0 overlaps on a 17-flow diagram including one bidirectional pair and 5 feedback edges. Post-pass had nothing to fix in this case. |
| **Compact space management** | ◑ Real levers: per-pair spacing, `NETWORK_SIMPLEX` node placement, `EDGE_LENGTH` post-compaction, `elk.aspectRatio`. Defaults are generous — untuned output sprawls. | Tuned spacing defaults per view, container padding trim, whitespace measurement in CI. | **Verified:** 2.6× more compact than D2 baseline on the same diagram (≥1.5× font-normalized). Adding 4 flows increased area by only 4%. |
| **Semantic positioning** (typed bands) | ✅ Native — partitions, `layerConstraint`, fixed ordering. Layered dataflow diagrams are literally what ELK was built for. | Constraint compiler: view conventions → ELK options. Users never touch ELK config. | Implicit in architecture — all examples ship with correct banding. |
| **Edge routing** (no chaos, traceable lines) | ◑ Orthogonal routing with crossing minimization — clear upgrade over dagre/Mermaid. | Routing clean-up pass for cross-hierarchy edges; edge-crossing hops (circuit-diagram arcs). | **Partial:** Feedback edges (system→actor, external→system) form a long perimeter "bus". Gracefully degrades (longer lines but no overlaps). Crossing hops keep the bus traceable. |

## ELK-version-specific notes

Tested against **elkjs 0.11.1**. Key behaviors:

- **Synchronous in-process layout** works under Node and Bun — the fake-worker
 workaround (`self` removal for UMD) is documented in [ADR-0002](/documentation/decisions/ADR-0002-TYPESCRIPT-STACK.md).
- `INCLUDE_CHILDREN` mode is required for nested containers but disables
 ELK's aspect-ratio targeting — the multi-candidate slide/page approach (trying both directions, label wraps, tight spacing) compensates.
- The `rectpacking` algorithm for container children is available but not yet
 used — current container sizing uses `layered` hierarchically.

## Known limitations

1. **Cross-hierarchy routing** is a known ELK weak spot. Edges crossing
 container boundaries (`INCLUDE_CHILDREN`) produce longer paths than same-level edges. Mitigated by the fold composited layout ([`fold.ts`](/src/fold.ts)) for slide mode and by edge-crossing hops for the standard layout.
2. **ELK is heavy** — the elkjs bundle is ~1.5 MB. Acceptable for CLI
 (embedded in the binary) and playground (loaded once).
3. **No incremental layout** — every build runs the full layout from scratch.
 For single-file diagrams this is fine (36–414 ms for realistic sizes); for future multi-file assembly, caching layer may be needed.

## Verdict

**ELK is the right foundation, not the finished answer** — and the gap between the two is precisely cairn's product value:

1. Semantic constraint compiler (view rules → ELK options)
2. Label collision resolution post-pass
3. Zone packing and legend placement
4. Fold composited layout for slide mode
5. Edge-crossing hops for traceability

See [ADR-0001](/documentation/decisions/ADR-0001-LAYOUT-ENGINE.md) for the formal decision.
