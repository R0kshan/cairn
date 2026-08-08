# Entry point for AI Agents

Read this file first.

## Specialized Roles

Skim [`.agents/reference/WORKING_METHODOLOGY.md`](./.agents/reference/WORKING_METHODOLOGY.md)
before any non-trivial change — it defines the core workflow (reproduce →
diagnose → experiment → decide → implement → verify) that every role builds
on; its one hard rule (git ownership) is already stated below. Then consult
the role for the phase you're in:
- **System Planning:** [`.agents/architect-agent.md`](./.agents/architect-agent.md)
- **Code Generation:** [`.agents/coder-agent.md`](./.agents/coder-agent.md)
- **Code Review:** [`.agents/reviewer-agent.md`](./.agents/reviewer-agent.md)

## What cairn is

A diagram-as-code CLI for enterprise-architecture views — `logical`,
`application`, `infrastructure`, `security` — rendered to SVG, plus an
infrastructure *matrice des flux techniques* export. It sells **dense diagrams
that stay readable**: overlap-free labels, typed views, deterministic output.
Not a general diagramming tool.

## Runtime model

- **No build step.** `.ts` runs directly via `node --experimental-strip-types`
  (Node ≥ 22.6). Don't add a transpile/bundle step, emit `dist/`, or rewrite
  imports to `.js` — the explicit `.ts` import extensions are intentional.
  This flag erases type annotations at runtime without compiling them. It
  matters in **development only** (the shipped binary uses Bun's compiler
  and runs without Node). In dev it eliminates the compile step — change
  source and re-run, no `tsc --watch` or `dist/` overhead. The project uses
  none of the unsupported TS features (`enum` initializers, `const enum`,
  `namespace`, legacy decorators). The tradeoff: it's experimental
  ([node#53725](https://github.com/nodejs/node/issues/53725)). If it changes,
  the fallback is a one-liner `tsc` compile step.
- **Type checking exists ONLY in `npm run typecheck`** — the runtime strips
  types without checking them. (TS 7.x native compiler; needs its per-platform
  binary installed.)
- **elkjs runs in-process** (sync fake worker). **Bun compiles release binaries
  only** — never a dev/test dependency; no Bun/Deno APIs in `src/`.
- **`elkjs` is the only runtime dep.** Keep it that way. Dev deps are exactly
  biome + typescript + @types/node.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
