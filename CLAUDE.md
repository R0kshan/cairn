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

- **No build step.** `.ts` runs directly via `node --experimental-strip-types`
  (Node ≥ 22.6). Don't add a transpile/bundle step, emit `dist/`, or rewrite
  imports to `.js` — the explicit `.ts` import extensions are intentional.
- **Type checking exists ONLY in `npm run typecheck`** — the runtime strips
  types without checking them.
- **elkjs runs in-process** (sync fake worker). **Bun compiles release binaries
  only** — never a dev/test dependency; no Bun/Deno APIs in `src/`.
- **`elkjs` is the only runtime dep.** Dev deps are exactly
  biome + typescript + @types/node.

## Pipeline (`src/`)

```
.cairn → lexer.ts → parser.ts → validator.ts → scene-layout.ts (elkjs) → route-detour.ts → edge-tidy.ts → compact.ts → svg-render.ts → SVG
```

Key passes an agent can't infer from names:
- `route-detour.ts` — deterministic post-layout pass (issue #26) rerouting
  elk's wrap-around backward hierarchical edges through top/bottom channels.
  Works for **every** disposition (DOWN layouts transpose the scene).
  [`documentation/ai/ROUTE_DETOUR_HANDOVER.md`](./documentation/ai/ROUTE_DETOUR_HANDOVER.md)
  is a deep-dive handover for this pass — read it before touching flow routing.
- `edge-tidy.ts` — endpoint hygiene for every edge: collapses micro-jogs under 6px,
  spreads attachment points 12px apart on the same node side.
- `compact.ts` — removes horizontal bands crossed only by vertical segments
  (dead space elk doesn't reclaim). Gated: dead bands must stay under 30px.

## Non-negotiable invariants

All changes must respect the invariants in [`INVARIANTS.md`](./INVARIANTS.md).
Key ones for quick reference: zero label overlaps, byte-deterministic output,
flow label rules, readability ratcheted by `npm run sweep`.

## Before finishing a change

**Fast iteration loop:** edit → `node --experimental-strip-types src/cli.ts build examples/<file>.cairn -o /tmp/test.svg` → open SVG.

Follow the pre-commit checklist in [`CONTRIBUTING.md`](./CONTRIBUTING.md#opening-a-pr).