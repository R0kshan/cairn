# Design Brief — Diagram-as-Code Tool for Architecture Views

Status: **v0.1.0** · Date: 2026-07-11

This document is the product brief: **what** cairn does, **why** it exists, and **how** the architecture is structured. Supporting research and settled architecture decisions live in their own directories and are referenced here.

| Directory | Contents |
|---|---|
| [`research/`](research/) | Layout engine evaluation, spike comparison results, alternatives analysis |
| [`decisions/`](decisions/) | Architecture Decision Records (ADRs) for settled decisions |
| [`/documentation/DSL_SPEC.md`](DSL_SPEC.md) | Complete DSL syntax reference |
| [`/documentation/DIAGNOSTICS.md`](DIAGNOSTICS.md) | Diagnostic code catalog |

---

## 1. Rationale

General-purpose diagram tools (Mermaid, D2, PlantUML) and the C4 model ([c4model.com](https://c4model.com), implemented by Structurizr and LikeC4) each serve specific diagramming needs. C4 was designed for *communication*: its diagrams fit on a whiteboard, are drawn quickly, and omit detail that is not essential to the story being told. This makes C4 effective for aligning teams around software structure, but it means C4 diagrams are intentionally incomplete as specification artifacts — they lack the network-zone detail, protocol-level validation, trust-boundary analysis, and flow-matrix export that regulated enterprise environments require.

cairn addresses a different scope: typed architecture views where the diagram type drives validation, layout, and output formatting. Its purpose is not to replace communication tools but to generate diagrams that are complete enough to stand in an architecture document — an architecture dossier, a compliance review, a technical specification — without supplementary work.

Cairn's approach: **typed diagram views** that drive validation, completeness checks, templates, *and* layout conventions — with a layout pipeline that treats labels as first-class citizens.

> **French EA alignment.** Cairn's four-view model (logical → application → infrastructure → security) and its flow-matrix output are directly inspired by French practice — the VITAM programme's architecture documentation and the standard *matrice des flux techniques* deliverable. Every flow carries a protocol and port in the infrastructure view; the matrix splits them into separate columns with zone-annotated endpoints, exactly as French EA conventions prescribe. `style { lang: fr }` localises all rendered chrome. Within its scope, cairn is the first diagram-as-code tool that natively produces a French-style architecture dossier.

### 1.1 Non-negotiables

Three pain points the CLI must **absolutely** address — every phase gate is measured against them:

1. **No label overlap** — in particular two opposite-direction arrows between
 the same nodes (`A → B` / `B → A`), each carrying a flow description. **Invariant: every flow is a distinct arrow with its own distinct label — flows are never visually merged.**
2. **Space management** — no sprawling diagrams full of unnecessary whitespace;
 output must stay compact and dense enough to read and print.
3. **Template generation + validation per diagram-type view** —
 `cairn new --[diagram-type]` scaffolds the expected elements; `cairn validate` enforces the view's rules and completeness checks.

---

## 2. Research findings (summary)

Detailed research is in [`research/`](research/). Key findings:

- **Layout engine.** ELK (elkjs) selected after evaluating 6 alternatives.
 Native partition support, label-space reservation during layout, orthogonal routing, and active maintenance. Post-passes handle residual label overlaps and edge-crossing hops. See [`/documentation/research/elk-test/ELK-EVALUATION.md`](/documentation/research/elk-test/ELK-EVALUATION.md), [`/documentation/research/ALTERNATIVES.md`](/documentation/research/ALTERNATIVES.md), and [ADR-0001](/documentation/decisions/ADR-0001-LAYOUT-ENGINE.md).

- **Stack.** TypeScript everywhere, Bun-compiled binaries for distribution.
 The deciding constraint: elkjs only exists as a JS library — bridging to Go would add ~20× latency on the layout hot path. See [`/documentation/research/elk-test/RESULTS.md`](/documentation/research/elk-test/RESULTS.md) and [ADR-0002](/documentation/decisions/ADR-0002-TYPESCRIPT-STACK.md).

- **Diagram type conventions.** Surveyed ArchiMate, C4, and French EA
 practice (VITAM). Key finding: protocol is **optional** on application flows, **required** on infra flows — validation rules differ per view. See [`/documentation/research/README.md`](/documentation/research/README.md) and [ADR-0004](/documentation/decisions/ADR-0004-BUILTIN-PROFILES.md).

- **Spike verdict: GO.** Zero label overlaps achieved natively on a 17-flow
 diagram (including A↔B bidirectional pair). 2.6× more compact than D2 baseline. Routing is partial (feedback edges form a perimeter "bus") but degrades gracefully. No kill criterion hit. See [`/documentation/research/elk-test/RESULTS.md`](/documentation/research/elk-test/RESULTS.md).

---

## 3. Proposed architecture

```
 .cairn DSL ──► Parser ──► Typed model ──► Validator ◄── view (per diagram type)
 (text)       (hand-rolled   (AST + refs)    │  errors/warnings/completeness
               lexer +                         ▼
               recursive-                 Constraint compiler ──► elkjs ──► Post-passes ──► SVG
               descent)                   (view layout rules)           (label collision,
                                                                           legend, zone packing)
```

### 3.1 Consumers — CLI-first

The CLI is the primary interface. The playground is secondary, deferred to post-launch (see [ADR-0003](/documentation/decisions/ADR-0003-CLI-FIRST.md)).

| Command | Behavior |
|---|---|
| `cairn new -L <file>` | Scaffold a typed template with the type header and base elements. Type chosen via `-L` (logical), `-A` (application), `-I` (infrastructure), `-S` (security). |
| `cairn build <file>` | Compile diagram to SVG. Non-zero exit on error. |
| `cairn validate <file>` | Full pipeline check: syntax → view schema → completeness. Rust-style human diagnostics; `--format json` for CI/agents. |
| `cairn matrix <file>` | Export the flow matrix (matrice des flux techniques) as CSV, MD, or SVG. |
| `cairn watch <file>` | Rebuild on save. Errors render as an SVG error panel (never a stale diagram). |
| `cairn explain <code>` | Print rule rationale (e.g. `cairn explain E0240`). |

view selection: the diagram type is chosen **once, at scaffolding**, via mutually exclusive flags. The generated template starts with the type header (`diagram logical "My system"`). All other commands read the type from the file — no flag needed.

### 3.2 Diagram views (the guidance system)

Built-in views define element types, validation rules, layout conventions, and visual defaults per diagram type. Four views ship compiled in the engine: **logical**, **application**, **infrastructure**, **security**.

Each view defines:
- Valid element kinds and nesting rules
- Flow validation requirements (label required, protocol required/recommended)
- Visual defaults per kind (fill, stroke, text) for light and dark themes
- Layout partitions (actors left, systems middle, externals right)
- Cross-cutting lint rules (trust-boundary crossing, isolated elements)

The engine is view-agnostic — the same `View` interface drives all views. Custom views (via a future mini-DSL) are deferred.

See [ADR-0004](/documentation/decisions/ADR-0004-BUILTIN-PROFILES.md) and [`/documentation/DSL_SPEC.md`](DSL_SPEC.md) for element kinds per view.

### 3.3 Diagnostics design (`cairn validate`)

Rust-style diagnostics with stable error codes, source spans, and machine-applicable fix suggestions:

```
error[E0203]: flow without a label
  --> billing.cairn:14:3
   |
14 |   crm -> billing
   |   ^^^^^^^^^^^^^^ this flow has no label
   |
   = note: the `logical` view forbids unlabeled arrows
help: add a label describing the exchanged data
   |
14 |   crm -> billing : "Quote request"
   |                      ++++++++++++++++++++
```

Contract:
- **Error codes** stable and namespaced: `E01xx` syntax, `E02xx` view schema,
 `W05xx` completeness warnings.
- **`--format json`**: `{code, severity, span, message, note, help, fix}` —
 one schema shared by CLI, editors, CI, and the playground.
- **Severity → exit code**: errors = 1, warnings = 0 (flag `--strict` promotes
 warnings).
- Every diagnostic with a deterministic fix carries a machine-applicable
 suggestion (`fix: { insert, atEndOfLine }`) — foundation for a future `cairn fix`.

Full code catalog: [`DIAGNOSTICS.md`](DIAGNOSTICS.md).

---

## Sources

- [ArchiMate 3 example viewpoints — Open Group](https://pubs.opengroup.org/architecture/archimate3-doc/ch-Example-Viewpoints.html)
- [C4 model — Deployment diagram](https://c4model.com/diagrams/deployment)
- [VITAM — flow matrix](https://www.programmevitam.fr/ressources/DocCourante/html/archi/archi-exploit-infra/90-flux-all.html)
- [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- [ELK: Constraining the model](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html)
- [Svelte Flow — layouting libraries comparison](https://svelteflow.dev/learn/layouting/layouting-libraries)
- [npm trends](https://npmtrends.com/dagre-layout-vs-diagram-js-vs-elkjs-vs-graphviz)
