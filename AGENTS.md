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
`application`, `infrastructure` — rendered to SVG, plus a
*flow matrix* export per view (columns declared in `views.ts`),
reachable from the CLI and from `compile()`. It sells **dense diagrams
that stay readable**: overlap-free labels, typed views, deterministic output.
Not a general diagramming tool.

## Runtime model

- **No build step for dev or test.** `.ts` runs directly via
  `node --experimental-strip-types` (Node ≥ 22.6). Don't add a transpile step,
  emit `dist/`, or rewrite imports to `.js` — the explicit `.ts` extensions are
  intentional. Unsupported TS features (`enum` initializers, `const enum`,
  `namespace`, legacy decorators) are unused; keep it that way. Rationale and
  fallback plan: `CONTRIBUTING.md`.
- **Shipped artifacts are all pre-built** — Node won't strip types under
  `node_modules`. Bun compiles the binaries; esbuild bundles the playground and,
  via `prepack`, both npm surfaces — `build-cli.sh` → `bin/cairn.mjs` and
  `build-api.sh` → `dist/cairn.mjs`. A publish step, not a dev one; don't let it
  become one.
- **Types are checked ONLY by `npm run typecheck`** — the runtime strips them
  without checking.
- **elkjs runs in-process** (sync fake worker); no Bun/Deno APIs in `src/`.
- **elkjs is a devDependency, not a runtime one** — every artifact inlines it,
  so the published package installs **zero dependencies**. Don't move it back to
  `dependencies`: nothing in the tarball resolves it, and a declared-but-unloaded
  dep can drift from the version actually inlined. Full dep list: biome,
  typescript, @types/node, elkjs, esbuild. Inlining means cairn *distributes*
  elkjs — keep [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) accurate.

## Entry points

Environment-neutral core; thin entries inject ELK.

| Module | Role | ELK factory |
|---|---|---|
| `api.ts` | public surface | none |
| `compile.ts` | whole pipeline in one call, for embedders | none |
| `playground.ts` | browser entry → `playground/*` **and** the package's `.` export (`dist/cairn.mjs`) | browser `new ELK()` |
| `cli-npm.ts` | published CLI bundle → `bin/cairn.mjs` | `nodeElkFactory` |

Never inject a factory in `api.ts` or `compile.ts` — it would override every
consumer's, including the CLI's.

## Non-negotiable invariants

Moved to [`documentation/INVARIANTS.md`](./documentation/INVARIANTS.md#non-negotiable-invariants) —
link there, not here. Kept as a heading so `AGENTS.md#non-negotiable-invariants`
anchors used elsewhere in the repo keep resolving.

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
