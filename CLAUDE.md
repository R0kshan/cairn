# Entry point for AI Agent

Facts an agent needs that it **cannot infer from the code or from generic
competence**. Everything here is repo-specific; general good practice is assumed,
not restated. If a section ever reads like advice you'd give on any project,
delete it.

**Required reading (in order):** [`INVARIANTS.md`](./INVARIANTS.md) (what you
can't break) → [`CONTRIBUTING.md`](./CONTRIBUTING.md) (workflow, commands,
snapshots) → [`documentation/ai/WORKING_METHOD.md`](./documentation/ai/WORKING_METHOD.md).

## What cairn is

A diagram-as-code CLI for four typed enterprise-architecture views (`logical`,
`application`, `infrastructure`, `security`) rendered to SVG, with an
infrastructure *matrice des flux techniques* matrix export. Overlap-free labels,
typed validation, deterministic output.

## Runtime model — read first

- **No build step for dev or test.** `.ts` runs directly via
  `node --experimental-strip-types` (Node ≥ 22.6). Don't add a transpile step,
  emit `dist/`, or rewrite imports to `.js` — the explicit `.ts` import
  extensions are intentional.
- **Shipped artifacts are all pre-built**, because Node refuses to strip types
  under `node_modules`: Bun compiles the release binaries, esbuild bundles the
  npm CLI (`scripts/build-cli.sh` → `bin/cairn.mjs`, run by `prepack`) and the
  playground. This is not a dev build step and must not become one.
- **Type checking exists ONLY in `npm run typecheck`** — the runtime strips
  types without checking them.
- **elkjs runs in-process** (sync fake worker). **Bun compiles release binaries
  only** — never a dev/test dependency; no Bun/Deno APIs in `src/`.
- **`elkjs` is the only third-party module `src/` imports** — but it is a
  *devDependency*, not a runtime one, because every shipped artifact inlines it
  (Bun for the binaries, esbuild for the CLI and playground bundles). The
  published package therefore installs **zero dependencies**. Don't "fix" this
  by moving elkjs back to `dependencies`: nothing in the tarball resolves it,
  and a declared-but-unloaded dep resolves to a different version than the one
  actually inlined. Package deps are exactly biome + typescript + @types/node +
  elkjs + esbuild (esbuild is the publish path, so it's pinned exactly rather
  than fetched by `npx`).

## Pipeline (`src/`)

```text
.cairn → lexer.ts → parser.ts → validator.ts → scene-layout.ts (elkjs) → route-detour.ts → edge-tidy.ts → label-anchor.ts → compact.ts → svg-render.ts → SVG
```

**Entry points.** One environment-neutral core, thin entries that inject ELK:

| Module | Role | ELK factory |
|---|---|---|
| `api.ts` | public surface — **re-exports only**. A diff here means the public contract changed | none |
| `compile.ts` | `parse → validate → layout → render` in one call, for embedders | none |
| `playground.ts` | browser entry, built into `playground/*` | browser `new ELK()` |
| `cli-npm.ts` | entry for the published CLI bundle | `nodeElkFactory` |

`api.ts` and `compile.ts` must stay neutral: injecting a factory there would
override every consumer's, including the CLI's. See issue #38 — the `exports`
map and `.d.ts` that make `api.ts` importable are not in this repo yet.

Key passes an agent can't infer from names:
- `route-detour.ts` — deterministic post-layout pass (issue #26) rerouting
  elk's wrap-around backward hierarchical edges through top/bottom channels.
  Works for **every** disposition (DOWN layouts transpose the scene).
  [`documentation/ai/ROUTE_DETOUR_HANDOVER.md`](./documentation/ai/ROUTE_DETOUR_HANDOVER.md)
  is a deep-dive handover for this pass — read it before touching flow routing.
- `edge-tidy.ts` — endpoint hygiene for every edge: collapses micro-jogs under 6px,
  spreads attachment points 12px apart on the same node side.
- `label-anchor.ts` — runs **twice** (before `compact`, and again after
  `optimiseRoutes`), so on the second pass a label's "original" position is
  wherever the first pass seated it, not elk's. elk places each edge label against the route elk planned;
  the two passes above then move that route and leave the label behind, sometimes
  nearer a *different* flow. This re-centres each label on its own run. Its
  position in the pipeline is load-bearing in both directions: after `edge-tidy`
  (anchoring to a run that then moves is worthless) and before `compact` (a label
  pins the band it sits in). See [`INVARIANTS.md`](./INVARIANTS.md) §4a.
- `compact.ts` — removes horizontal bands crossed only by vertical segments
  (dead space elk doesn't reclaim). Gated: dead bands must stay under 30px.
- `readability.ts` + `optimiseRoutes` (in `edge-tidy.ts`) — one defect model and
  one acceptance rule shared by every router: five tiers, reject any gain at a
  tier, accept a loss and let lower tiers pay for it. Compares defect *identity
  sets*, never counts — comparing totals cannot see a defect move, which shipped
  twice. `optimiseRoutes` runs **after** `label-anchor` and `compact` and
  nothing may move edge geometry after it.
  [`documentation/FLOW_ROUTING.md`](./documentation/FLOW_ROUTING.md) is the
  explanation; `npm run sweep` gates with the same ladder, so router and gate
  agree on what "better" means.

## Non-negotiable invariants

All changes must respect the invariants in [`INVARIANTS.md`](./INVARIANTS.md).
Key ones for quick reference: zero label overlaps, byte-deterministic output,
flow label rules, readability ratcheted by `npm run sweep`.

## Before finishing a change

**Fast iteration loop:** edit → `node --experimental-strip-types src/cli.ts build examples/<file>.cairn -o /tmp/test.svg` → open SVG.

Follow the pre-commit checklist in [`CONTRIBUTING.md`](./CONTRIBUTING.md#opening-a-pr).