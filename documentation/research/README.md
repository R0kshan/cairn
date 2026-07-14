# Research phase

This directory documents the research that informed cairn's architecture decisions. Conducted 2026-07-11.

## Questions asked

1. **Which diagram-as-code tools exist, and what scope do they cover?** —
 Surveyed Mermaid, D2, PlantUML, Graphviz, and C4-based tools to understand how their scope differs from cairn's focus on typed architecture views — establishing the product rationale (see [`DESIGN_BRIEF.md`](/documentation/DESIGN_BRIEF.md)).

2. **Which layout engine can produce architecture diagrams with zero label
 overlaps, semantic positioning, and compact output?** — Evaluated five candidates (ELK, dagre, Graphviz, TALA, custom). Result: ELK, with custom post-passes. See [`ELK-EVALUATION.md`](elk-test/ELK-EVALUATION.md) and [`ALTERNATIVES.md`](ALTERNATIVES.md).

3. **What stack lets us ship a self-contained CLI that runs ELK
 efficiently?** — Evaluated TypeScript (via Bun), Go (via goja bridge), and Rust/WASM. Result: TypeScript everywhere, Bun-compiled binaries. See [`RESULTS.md`](elk-test/RESULTS.md) and [`ADR-0002`](/documentation/decisions/ADR-0002-TYPESCRIPT-STACK.md).

4. **Does ELK actually fix the pain points on a real architecture diagram?** —
 Built a phase-0 spike with a 17-flow logical-architecture diagram, measured overlaps, compactness, routing quality, and layout time. Result: **GO** — zero overlaps achieved natively, no kill criterion hit. See [`RESULTS.md`](elk-test/RESULTS.md) (spike results).

## Diagram type conventions (domain research)

Before designing the built-in views we surveyed architecture-framework conventions for the three target views:

- **ArchiMate** Application Cooperation Viewpoint — application components,
 services, information flows. Matches the planned `application` view. Middleware and data stores are legitimate elements of this view.
- **C4 Deployment diagram** — application/container instances mapped inside
 deployment nodes (VM, K8s, app server). Confirms the `infrastructure` view design: nested deployment nodes, infra nodes (DNS, LB), environments, and communication paths labeled with protocol.
- **VITAM** ([Programme VITAM](https://www.programmevitam.fr/)) — French government archival platform whose architecture documentation places the flow matrix (ports, network zones, exact protocols) in the **infrastructure** view, not the application view, and distinguishes infrastructure components from application modules.

Key finding: **protocol is optional on application flows, required on infra flows** — validation rules differ per view, which is exactly what typed views enable. The four built-in views embody these conventions.

## What the spike validated

The phase-0 spike proved on a real diagram (not a toy) that ELK can be constrained to produce:

- **Zero label overlaps** (the primary non-negotiable)
- **≥1.5× more compact** output than a D2 baseline
- **Distinct arrows** for every flow, including A↔B bidirectional pairs
- **Graceful degradation** of feedback-edge routing without collapsing into
  overlap chaos

**Why D2 as the baseline?** D2 ([Terrastruct](https://d2lang.com/)) uses ELK as its layout engine — the same library cairn's prototype uses. This makes the comparison a controlled experiment: both tools use the same low-level layout engine, so any difference in overlap count, compactness, or routing quality is attributable to *how* the engine is configured rather than to the engine itself. D2 feeds ELK a generic graph with no semantic type information, producing ELK's default-heuristic output, which still generates label overlaps and sprawl. Cairn's constraint compiler translates typed view conventions into ELK options (partition bands, label-space reservation, compaction tuning), producing compact, overlap-free output from the *same* engine. The comparison validates that cairn's value proposition — typed architecture views driving layout — holds independently of the engine choice.

The spike uncovered two areas needing post-pass work (edge-routing for feedback edges, parallel-edge separation for bidirectional pairs), neither of which was a kill criterion. See [`RESULTS.md`](elk-test/RESULTS.md) for the full numbers.

## Outcomes → decisions

| Research finding | Decision | ADR |
|---|---|---|
| ELK best fits the layout requirements | Layout engine = ELK + post-passes | [ADR-0001](/documentation/decisions/ADR-0001-LAYOUT-ENGINE.md) |
| TypeScript avoids JS-bridge overhead, fits layout hot-path | Stack = TypeScript + Bun-compiled binaries | [ADR-0002](/documentation/decisions/ADR-0002-TYPESCRIPT-STACK.md) |
| CLI proves the concept fastest; playground is secondary | CLI-first, playground post-launch | [ADR-0003](/documentation/decisions/ADR-0003-CLI-FIRST.md) |
| Domain conventions differ per view → typed views | Ship built-in views (logical, application, infrastructure, security) | [ADR-0004](/documentation/decisions/ADR-0004-BUILTIN-PROFILES.md) |
