# Alternative layout engines — evaluation

**Date:** 2026-07-11 **Context:** Selecting the core layout engine for cairn's diagram compilation pipeline. Six alternatives to ELK were evaluated.

> **Decision:** ELK (elkjs) with custom post-passes. See [ADR-0001](../decisions/ADR-0001-LAYOUT-ENGINE.md) and [ELK-EVALUATION.md](./elk-test/ELK-EVALUATION.md).

---

## dagre

| Aspect | Assessment |
|---|---|
| **Status** | Effectively unmaintained. The npm package is a community fork. |
| **Nested containers** | Container↔child edges are broken — the edge routing does not account for container boundaries. Dagre was never designed for compound graphs: clustering support was requested as [issue #13 (2012)](https://github.com/dagrejs/dagre/issues/13) and remains open 14 years later. Edges to/from containers crash with `Cannot set property 'rank' of undefined` — see [issues #236](https://github.com/dagrejs/dagre/issues/236), [#319](https://github.com/dagrejs/dagre/issues/319), [#426](https://github.com/dagrejs/dagre/issues/426). The D2 team had to implement a workaround "because dagre doesn't support edges to containers" ([d2#707](https://github.com/terrastruct/d2/issues/707)). For a tool that relies on nested containers (site→zone→server), this is a hard block. |
| **Label overlap** | No label-space reservation during layout — labels are placed after edge routing, giving no overlap guarantee. The layout API has no concept of edge-label dimensions influencing node/edge positions. |
| **Semantic positioning** | No partition support. The only horizontal constraints are `rankdir` (TB/LR/RL/BT) and an `align` hint (UL/UR/DL/DR). No way to assign nodes to semantic bands. |
| **Verdict** | **Eliminated.** Unmaintained codebase with broken container routing that has been a known, unfixed limitation for 14 years. No path to fix without effectively maintaining dagre ourselves. |

---

## Graphviz

| Aspect | Assessment |
|---|---|
| **Status** | Actively maintained (AT&T, then community); mature, broad feature set. |
| **Nested containers** | `subgraph` exists but is topological, not a semantic partition — subgraphs collapse into clusters with no constraint that they form visual bands. Graphviz' `dot` places subgraphs strictly by edge hierarchy ([Graphviz docs: "Layout of drawing subgraphs"](https://graphviz.org/docs/layout/dot/)). Positioning subgraphs as horizontal bands (zone→server) requires extensive post-processing. |
| **Edge routing** | Excellent — `ortho` + `splines` produce clean edges. Graphviz's router is arguably best-in-class. |
| **Label overlap** | Labels are placed after node/edge layout; no built-in overlap resolution. ELK treats edge labels as layout nodes (space reserved *during* layout), while Graphviz paints labels post-hoc ([Graphviz issue #1698](https://gitlab.com/graphviz/graphviz/-/issues/1698)). |
| **Distribution** | Requires native binary (`dot`) or WASM bridge. The native binary approach adds a platform dependency; WASM adds ~2–3 MB. |
| **Determinism** | Deterministic with fixed seeds, some algorithms have random tie-breaking. |
| **Verdict** | **Eliminated as core.** Strong routing but weak constraint support for semantic bands. Would need the same amount of post-processing as ELK, but without ELK's native partition support. Kept as a potential routing post-processor for ELK's feedback-edge "bus" problem, but not needed for v0.1. |

---

## TALA (D2's proprietary engine)

| Aspect | Assessment |
|---|---|
| **Status** | Closed-source, requires a paid license, developed by Terrastruct (D2). |
| **Feature set** | Designed for general-purpose diagram layout. ELK is an option *inside* D2 alongside dagre; TALA is D2's own engine. |
| **Semantic positioning** | TALA explicitly does "more random" layouts — its README states *"This search space has some randomness at each step. Choosing a different seed … can have significant impact on the overall layout"* ([TALA repo](https://github.com/terrastruct/TALA#readme)). D2 docs confirm: *"More random than other layout engines. A small change to a label can cascade into an entirely different layout"* ([D2 docs — TALA](https://d2lang.com/tour/tala/)). This is the opposite of cairn's determinism requirement. |
| **Customization** | We cannot extend or modify it. If it does not produce the layout we need (semantic bands, zero overlaps, deterministic output), we are stuck. |
| **Verdict** | **Eliminated.** Closed-source, requires a paid license, non-deterministic by design, no extension path. Not suitable for a tool whose differentiator runs through the layout engine. |

---

## Mermaid

| Aspect | Assessment |
|---|---|
| **Category** | Mermaid is a full diagram-as-code tool, not a layout engine. cairn needs a layout *library* to embed — not another diagramming tool whose primary interface is a DSL → SVG renderer. |
| **Layout engine** | Mermaid uses dagre for most diagram types (flowcharts, state diagrams, graphs). Dagre is already eliminated above: unmaintained, broken container routing ([#13](https://github.com/dagrejs/dagre/issues/13), [#236](https://github.com/dagrejs/dagre/issues/236), [#426](https://github.com/dagrejs/dagre/issues/426)), no label-space reservation, no partition support. Any layout limitation in dagre is a hard limit in Mermaid — Mermaid cannot swap in a different engine for complex layouts. |
| **Nested containers** | Mermaid's `subgraph` blocks rely on dagre's clustering, which has the same broken container-edge routing documented in the dagre section. Edges crossing subgraph boundaries are routed without accounting for container padding or nesting depth. |
| **Extensibility** | Mermaid is designed as a turnkey renderer (input DSL → rendered SVG). It does not expose its layout computation as a standalone library or data structure. Extracting intermediate layout data (node positions, edge paths, port coordinates) for cairn's post-processing — validation, overlap checking, matrix export — is infeasible without forking Mermaid. |
| **Dependency risk** | Adopting Mermaid means depending on a full diagram-as-code tool with its own DSL and roadmap. Any breaking API change or licensing shift would directly affect cairn's core pipeline. By contrast, ELK is a pure layout library with no diagramming DSL — no risk of scope conflict. |
| **Determinism** | Inherits dagre's pseudo-deterministic behavior — dagre has no formal determinism guarantee, and different versions produce different layouts for the same input. |
| **Verdict** | **Eliminated.** Mermaid is a full diagram-as-code tool with its own DSL and rendering pipeline, not a layout library. Using it would inherit all of dagre's layout limitations — broken containers, no label-space reservation, no semantic partitioning — without the ability to replace the layout engine. |

---

## PlantUML

| Aspect | Assessment |
|---|---|
| **Category** | PlantUML is a full diagram-as-code tool (Java-based), not a layout library. cairn needs a layout *library* to embed — not another diagramming tool whose primary interface is a DSL → PNG/SVG renderer invoked over a Java CLI. |
| **Layout engine** | PlantUML uses Graphviz (`dot`) as its primary layout engine for most diagram types (component, deployment, class, use-case). Graphviz is evaluated above: topological subgraphs only, no semantic band constraint, labels placed post-hoc ([Graphviz issue #1698](https://gitlab.com/graphviz/graphviz/-/issues/1698)). Any layout limitation in Graphviz is a hard limit in PlantUML. |
| **Nested containers** | PlantUML's `rectangle`, `node`, `component` and `package` blocks rely on Graphviz subgraphs — topological-only hierarchy with no semantic partition support. Same container-edge limitations as Graphviz. |
| **Extensibility** | PlantUML is designed as a turnkey renderer invoked via CLI (`java -jar plantuml.jar`) or Java API. It does not expose its layout computation as a standalone library or data structure. Extracting intermediate layout data for cairn's post-processing is infeasible without forking. |
| **Distribution** | Requires Java Runtime + Graphviz (`dot`) installed on the machine — a heavy platform dependency. cairn targets zero-install distribution via npm and single-binary (Bun-compiled). |
| **Dependency risk** | Adopting PlantUML means depending on a full diagram-as-code tool with its own DSL and rendering pipeline. Any roadmap change, CLI API shift, or Java version requirement would directly affect cairn's core pipeline. |
| **Determinism** | Inherits Graphviz's pseudo-deterministic behavior — Graphviz has no formal determinism guarantee, and different versions produce different layouts for the same input. |
| **Verdict** | **Eliminated.** PlantUML is a full diagram-as-code tool in the same category as cairn, not a layout library. It inherits all of Graphviz's layout limitations (topological subgraphs, post-hoc label placement) while adding Java + Graphviz as runtime dependencies — incompatible with cairn's JS-first, zero-install distribution model. |

---

## Custom engine from scratch

| Aspect | Assessment |
|---|---|
| **Differentiation** | ELK solves a generic problem (layered graph layout) that has decades of academic research and production use. ELK already satisfies cairn's layout requirements — native partitions, label-space reservation, orthogonal routing, compactness levers. cairn's product value is *above* the layout layer: architecture validation, overlap-checked CI gates, trust-boundary linting, medium-aware sizing, matrix export, and localized output. Building a custom layout engine would consume engineering effort on a commodity capability — effort that instead goes into cairn-specific features that no other diagram-as-code tool provides. |
| **Dependency, not differentiator** | A layout engine is a dependency, like an HTTP server or a parser library. cairn should own the parts that make it unique (validation rules, post-passes, output formatting, view models) and rely on a proven dependency for the parts that are well-understood (graph layout, constraint solving, edge routing). If ELK ever becomes a bottleneck (performance, bundle size, missing behavior), the post-pass layer (`fold.ts`, label offset, crossing hops) allows gradual extraction — post-passes absorb layout logic incrementally until ELK can be swapped out. |
| **Maturity** | ELK is actively maintained under the Eclipse Foundation, with regular releases since 2014 and production use in D2 (as an optional engine alongside dagre), Eclipse Sirius, Capella, KLighD, Yakindu, and other modeling tools. It is a proven, low-abandonment-risk dependency — the opposite of dagre's effectively unmaintained state. |
| **Verdict** | **Rejected for MVP.** ELK already meets cairn's layout needs. Building a custom layout engine would consume engineering time on a generic capability while delaying investment in cairn's actual differentiators. ELK is a dependency, not a bottleneck — and if it becomes one later, the post-pass architecture provides an incremental migration path without derailing product validation. |

---

## Summary

| Engine | Verdict | Reason |
|---|---|---|
| **ELK (elkjs)** | ✅ **Selected** | Native partitions ([docs](https://eclipse.dev/elk/reference/options/org-eclipse-elk-partitioning-partition.html)), label-space reservation, orthogonal routing, compactness levers. See [ELK-EVALUATION.md](./elk-test/ELK-EVALUATION.md). |
| dagre | ❌ Eliminated | Unmaintained, container edges broken for 14 years ([#13](https://github.com/dagrejs/dagre/issues/13), [#236](https://github.com/dagrejs/dagre/issues/236), [#426](https://github.com/dagrejs/dagre/issues/426)), no label-space reservation, no partition support. |
| Graphviz | ❌ Eliminated as core | Topological subgraphs only — no semantic band constraint ([dot docs](https://graphviz.org/docs/layout/dot/)). Labels placed post-hoc ([#1698](https://gitlab.com/graphviz/graphviz/-/issues/1698)). Post-processing matches ELK's effort without ELK's native advantages. |
| TALA (D2) | ❌ Eliminated | Closed-source, requires a paid license, non-deterministic by design ([TALA README](https://github.com/terrastruct/TALA#readme), [D2 docs](https://d2lang.com/tour/tala/)), no extension path. |
| Mermaid | ❌ Eliminated | Full diagram-as-code tool (not a layout library), uses dagre under the hood — inherits all dagre limitations (broken containers, no label-space reservation, no partitioning), no exposed layout API for post-processing. |
| PlantUML | ❌ Eliminated | Full diagram-as-code tool (not a layout library), uses Graphviz under the hood — inherits topological-subgraph limitations and post-hoc label placement, Java + Graphviz runtime dependency incompatible with JS-first distribution. |
| Custom | ❌ Rejected for MVP | ELK already satisfies cairn's layout requirements. A layout engine is a dependency, not a differentiator. Engineering effort belongs above the layout layer, where cairn's unique value lives. Post-pass architecture keeps an incremental migration path open if ELK ever becomes a bottleneck. |

## External references

- [Svelte Flow — layouting libraries comparison](https://svelteflow.dev/learn/layouting/layouting-libraries) — compares dagre, ELK, and Graphviz for layouting node-based UIs; validates ELK's label-space reservation and compactness advantages.
- [npm trends](https://npmtrends.com/dagre-layout-vs-diagram-js-vs-elkjs-vs-graphviz) — download trends for dagre-layout, diagram-js, elkjs, and graphviz; ELK shows the highest sustained adoption among JS layout libraries.
