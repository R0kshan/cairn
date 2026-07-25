# Contributing to cairn

**Open an issue first** so we can agree on the approach before you invest in a PR.

## Getting started

No build step — TypeScript runs directly on **Node ≥ 22.6** via `node --experimental-strip-types`.

```sh
npm install
npm run cairn -- new -L my.cairn     # scaffold a diagram
npm run cairn -- build my.cairn      # render it to SVG
```

The only runtime dependency is `elkjs`; the dev toolchain is just biome + typescript. Keep both lists that short.

## What you can't break

Invariants detailed in `CLAUDE.md`. In short:
- **Zero label overlaps. Byte-deterministic output.**
- **Every flow is a distinct arrow with a distinct label** — flows are never visually merged.
- **Labels are mandatory in logical view (E0203)** — optional in application, infrastructure and security.
- **Protocol is mandatory in infrastructure view (E0240)** — recommended (warning) in application (W0540) and for cross-zone security flows (W0561).
- **Nesting rules are enforced per view (E0210–E0218)** — layout partitions depend on correct parentage.
- **Duplicate IDs are rejected (E0202)** — flat ID space; every element must be uniquely referenceable.
- **Dangling flow references are rejected (E0220)** — an edge to nowhere breaks the diagram.

## Commands — when to run what

| When… | `npm test` | `npm run typecheck` + `npm run lint` | `npm run snapshots` | `npm run examples` |
|---|---|---|---|---|
| Checking for regressions | ✅ run **first** | ✅ run | — | — |
| Refactoring (no visible change) | ✅ must pass | ✅ must pass | ✅ run (must produce **zero** diffs) | ✅ run (must produce **zero** diffs) |
| A snapshot gate failed and the diff is intended | ✅ must pass | ✅ must pass | ✅ run to accept | — |
| You added/renamed a `.cairn` example file | ✅ must pass | ✅ must pass | ✅ run | ✅ run (commit the SVG) |
| You changed a `.cairn` source file (bug fix / feature) | ✅ must pass | ✅ must pass | ✅ run if output changed | ✅ run if output changed |
| You changed the render/layout pipeline | ✅ must pass | ✅ must pass | ✅ run | ✅ run |

### Step by step when a snapshot gate fails

1. **Preview** — `npm run snapshots:report` (groups changes by kind: geometry / colour / text)
2. **Decide** — is the change related to your edit? If yes → intended. If not → regression (find the bug).
3. **If intended** — `npm run snapshots` then commit the updated references.
4. **Verify** — open a few changed SVGs in your browser to confirm they look right.

**Never regenerate to silence a diff you don't understand** — that turns the gate into noise.

### Background

`npm test` runs three layers against committed reference files:

| Layer | Guards |
|---|---|
| **Structural digest** (`tests/corpus.test.ts`) | Every `.cairn` example → one digest line per diagram, split by geom/color/text |
| **Example-SVG fidelity** (`tests/corpus.test.ts`) | Committed `examples/*.svg` stay in sync with the code |
| **Detailed snapshots** (`tests/snapshot.test.ts`) | A chosen set: one per view (EN+FR), every theme, matrix exports |

`npm run snapshots` regenerates all three at once. `npm run examples` only refreshes the `examples/*.svg` files (subset of snapshots).

CI also runs a `label overlaps: 0` gate and builds the Bun binary + playground bundle. Run `npm run test:binary` locally if you touch bundling or the elkjs worker. After modifying `src/`, rebuild the playground bundles per [PLAYGROUND_BUILD.md](documentation/PLAYGROUND_BUILD.md#update-playground-after-modifying-src).

## Opening a PR

- Keep it focused — one concern per PR.
- Link the PR to an issue.
