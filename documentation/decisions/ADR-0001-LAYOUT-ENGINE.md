# ADR-0001: Use ELK (elkjs) with custom post-passes as the layout engine

## Context

Cairn needs a layout engine that can produce architecture diagrams with:

1. **Zero label overlaps** — in particular two opposite-direction arrows between
 the same nodes (`A → B` / `B → A`), each carrying a distinct label. INVARIANT: every flow is a distinct arrow with a distinct label — flows are never merged.
2. **Semantic positioning** — actors left, systems middle, external systems
 right (or top→bottom in tall disposition); infrastructure zones band in declaration order.
3. **Compact output** — no sprawling diagrams full of unnecessary whitespace;
 output must be dense enough to read and print.
4. **Deterministic output** — byte-identical across runs and across runtimes
 (Node vs Bun-compiled binary), for CI comparison and reproducible builds.
5. **Nested containers** — sites contain zones contain servers contain instances;
 systems contain layers contain blocks.

## Options considered

Four alternatives plus a custom engine were evaluated. Full analysis: [ALTERNATIVES.md](/documentation/research/ALTERNATIVES.md).

| Option | Verdict |
|---|---|
| **ELK (elkjs)** | ✅ Selected |
| dagre | ❌ Eliminated — unmaintained, broken container routing |
| Graphviz | ❌ Eliminated as core — weak semantic constraint support |
| TALA (D2) | ❌ Eliminated — closed-source, non-deterministic |
| Custom from scratch | ❌ Rejected for MVP — 6–12 months before product value |

## Decision

**Use ELK (elkjs) as the core layout engine, wrapped by a semantic constraint compiler and followed by layout post-passes.**

The pipeline is:

```
view conventions → ELK options → elkjs layout → Post-passes → Scene
(constraint compiler)                  │              │
                                       │              ├─ Label collision resolution
                                       │              ├─ Parallel-edge separation
                                       │              └─ Crossing-hop detection
                                       │
                                  Layout result
                                  (node positions,
                                   edge routes,
                                   label boxes)
```

ELK provides the native capabilities that are hardest to build correctly: partitioned layered layout, orthogonal routing with crossing minimization, nested container support, and label-space reservation during layout. Cairn's value lives in the constraint compiler (translating view rules into ELK-config) and the post-passes (resolving residual label overlaps, edge-crossing hops, zone packing).

## Key ELK options used

| Option | Value | Purpose |
|---|---|---|
| `elk.algorithm` | `layered` | Directed graph layout (default for architecture flows) |
| `elk.direction` | `RIGHT` or `DOWN` | Horizontal (wide/tall) or vertical orientation |
| `elk.hierarchyHandling` | `INCLUDE_CHILDREN` | Nested containers with cross-hierarchy edges |
| `elk.edgeRouting` | `ORTHOGONAL` | Clean right-angle edges |
| `elk.partitioning.activate` | `true` | Semantic bands (actors, systems, externals) |
| `elk.layered.nodePlacement.strategy` | `NETWORK_SIMPLEX` | Compact node positioning |
| `elk.layered.compaction.postCompaction.strategy` | `EDGE_LENGTH` | Minimal whitespace |
| `elk.separateConnectedComponents` | `false` | Single unified diagram |
| `elk.edgeLabels.placement` | `CENTER` | Labels centered on edges |

## Consequences

### Positive
- ELK handles the hardest parts of layout (layering, partitioning, label-space
 reservation) correctly out of the box — the spike proved zero overlaps on a real 17-flow diagram.
- Elkjs is available as a standard npm package — no native binary or bridge
 needed from TypeScript.
- The post-pass architecture is independent of ELK: if we ever replace ELK
 with a custom engine, the post-passes and constraint compiler remain.
- ELK's active maintenance (academic team, regular releases) means bugs get
 fixed upstream.

### Negative
- Elkjs is ~1.5 MB — adds ~50–100 MB to the self-contained binary (Bun
 embeds the full JS runtime + dependencies).
- ELK's cross-hierarchy routing (`INCLUDE_CHILDREN`) is a known weak spot —
 feedback edges form a perimeter "bus" rather than direct routes. Mitigated by edge-crossing hops and the fold composited layout for slide mode.
- ELK cannot operate under aspect-ratio constraints with `INCLUDE_CHILDREN`
 enabled, requiring a multi-candidate approach (try RIGHT/DOWN, label wraps, tight spacing → keep best fit).
- The Java→JS transpiled codebase is not amenable to deep debugging — we treat
 ELK as a black box.

### Neutral
- Layout time on typical diagrams (20–60 nodes) is 36–126 ms, well within the
 `watch` live-preview budget.
- Synchronous in-process layout is the right mode for a CLI — the browser
 playground uses a real web worker natively.

## Confirmation

The phase-0 spike validated the decision on a real diagram:
- 0 label overlaps (native)
- 2.6× more compact than D2 baseline
- 5 feedback edges degraded gracefully (longer bus, no overlaps)
- A↔B bidirectional pair produced two distinct, readable labels

See [RESULTS.md](/documentation/research/elk-test/RESULTS.md) for full numbers.

## Links

- [ELK layered algorithm reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- [ELK: Constraining the model](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html)
- [ELK-EVALUATION.md](/documentation/research/elk-test/ELK-EVALUATION.md) — detailed ELK capability mapping
- [ALTERNATIVES.md](/documentation/research/ALTERNATIVES.md) — why other engines were not chosen
- [Design brief §1.1](/documentation/DESIGN_BRIEF.md#11-non-negotiables) — the non-negotiables this decision serves
