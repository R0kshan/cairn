# Documentation index

Root-level entry points ([`AGENTS.md`](../AGENTS.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md),
[`CONTRIBUTING.md`](../CONTRIBUTING.md)) come first. This directory holds the
supporting detail they point into.

| Document | Read it when… |
|---|---|
| [`DSL_SPEC.md`](./DSL_SPEC.md) | Writing or changing `.cairn` syntax |
| [`DIAGNOSTICS.md`](./DIAGNOSTICS.md) | Adding or looking up a diagnostic code |
| [`READABILITY.md`](./READABILITY.md) | Understanding what the sweep gate measures and why — same weight as the invariants |
| [`PLAYGROUND_BUILD.md`](./PLAYGROUND_BUILD.md) | Rebuilding the browser/node bundles after touching `src/` |
| [`decisions/`](./decisions/) | Architecture Decision Records — settled *why* questions; check before re-proposing an approach |
| [`internals/`](./internals/) | Concept and implementation docs for the trickier parts of the pipeline (currently: flow routing) |
| [`research/`](./research/) | The evaluation work that produced the ADRs — layout engine comparison, domain-convention survey |

## Architecture Decision Records

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](./decisions/ADR-0001-LAYOUT-ENGINE.md) | ELK (elkjs) + custom post-passes as the layout engine | Accepted |
| [ADR-0002](./decisions/ADR-0002-TYPESCRIPT-STACK.md) | TypeScript with Bun-compiled binaries | Accepted |
| [ADR-0003](./decisions/ADR-0003-CLI-FIRST.md) | CLI-first, playground deferred | Amended — playground now ships |
| [ADR-0004](./decisions/ADR-0004-BUILTIN-VIEWS.md) | Built-in compiled views over a view mini-DSL | Accepted |
| [ADR-0005](./decisions/ADR-0005-FLOW-ROUTING.md) | Deterministic post-layout pass for backward hierarchical edges | Accepted |
