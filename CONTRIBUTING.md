# Contributing to cairn

**Open an issue first** so we can agree on the approach before you invest in a PR.

## Getting started

No build step — TypeScript runs directly on **Node ≥ 22.6** via the `--experimental-strip-types` flag.

```sh
npm install
npm run cairn -- new -L my.cairn     # scaffold a diagram
npm run cairn -- build my.cairn      # render it to SVG
```

The whole dependency list is biome + typescript + @types/node + elkjs + esbuild, and they are **all devDependencies** — the published package installs nothing. `elkjs` is the only third-party module `src/` imports, but every shipped artifact inlines it (Bun for the binaries, esbuild for the CLI and playground bundles), so consumers never resolve it. Keep the list that short. esbuild earns its place by being the publish path — it builds the playground bundles and the npm CLI bundle (`scripts/build-cli.sh`), so it's pinned exactly and locked by `package-lock.json` rather than fetched at build time.

### Why no build step works for cairn

`--experimental-strip-types` tells Node to erase the type annotations and run the resulting JavaScript — no compilation, no `dist/`, no sourcemap chasing. This matters in **development only** — every shipped artifact is pre-built: the release binaries by Bun, the npm CLI by esbuild. Node refuses to strip types under `node_modules`, so nothing installed can rely on the flag. In dev it eliminates the entire compile step:

- **Instant edit-run cycle.** Change source, re-run the test or CLI command right away — no `tsc --watch`, no `dist/`
- **No unsupported TS features needed.** The flag doesn't support `enum` with initializers, `const enum`, `namespace`, or legacy decorators. cairn uses none of these.

The tradeoff: it's experimental (track [node#53725](https://github.com/nodejs/node/issues/53725)). If the flag changes or disappears, the necessary adaptations will be made by this repository's maintainer.

## What you can't break

Invariants detailed in [`INVARIANTS.md`](./INVARIANTS.md). In short:
- **Zero label overlaps. Byte-deterministic output.**
- **Every flow is a distinct arrow with a distinct label** — flows are never visually merged.
- **Labels are mandatory in logical view (E0203)** — optional in application, infrastructure and security.
- **Protocol is mandatory in infrastructure view (E0240)** — recommended (warning) in application (W0540) and for cross-zone security flows (W0561).
- **Nesting rules are enforced per view (E0210–E0218)** — layout partitions depend on correct parentage.
- **Duplicate IDs are rejected (E0202)** — flat ID space; every element must be uniquely referenceable.
- **Dangling flow references are rejected (E0220)** — an edge to nowhere breaks the diagram.
- **All user text is escaped before SVG emission (`esc()`/`escAttr()`)** — user-supplied names, labels, protocols, and style values must never appear raw in SVG output.

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

[`tests/README.md`](tests/README.md) is the full account of the test
architecture — what each layer catches, and why the readability baseline accepts
some regressions as trades.

## Background

`npm test` runs three layers against committed reference files:

| Layer | Guards |
|---|---|
| **Structural digest** (`tests/corpus.test.ts`) | Every `.cairn` example → one digest line per diagram, split by geom/color/text |
| **Example-SVG fidelity** (`tests/corpus.test.ts`) | Committed `examples/*.svg` stay in sync with the code |
| **Detailed snapshots** (`tests/snapshot.test.ts`) | A chosen set: one per view (EN+FR), every theme, matrix exports |

`npm run snapshots` regenerates all three at once. `npm run examples` only refreshes the `examples/*.svg` files (subset of snapshots).

It then chains **`npm run sweep`**, the readability gate: every `.cairn`
fixture under `examples/` (top level plus `dispositions/` and `themes/`) ×
every disposition (288 drawings), seven invariants that must be `0` and fourteen
ratcheted ceilings — expressed as a rate per swept flow-instance so the gate
stays stable as fixtures are added — that may only fall. Run it alone while
iterating — `npm run sweep -- --detail` lists each defect with its edge id.

On top of the rates, a **per-drawing baseline**
(`tests/__snapshots__/readability.baseline`) pins the accepted defect count for
every drawing × metric: no single drawing may get worse on any metric, even if
the corpus totals improve. When your change improves drawings, run
`npm run sweep -- --update-baseline` and commit the file — floors only fall.

Two flags narrow the matrix while iterating: `--only=<substring>` keeps just the
fixtures whose path contains it, and `--shard=i/n` takes every n-th fixture (for
splitting across CI jobs). Partial runs don't gate the corpus-wide rates — a
rate over part of the corpus can't judge a corpus-wide ceiling — but they do
gate the per-drawing baseline, and `--update-baseline` on a partial run updates
only the drawings actually swept.

CI also builds the Bun binary + playground bundle. Run `npm run test:binary` locally if you touch bundling or the elkjs worker. After modifying `src/`, rebuild the playground bundles per [PLAYGROUND_BUILD.md](documentation/PLAYGROUND_BUILD.md#update-playground-after-modifying-src).

`CAIRN_NO_PORT_PASS=1` is the one debug env var in the pipeline: it skips the
port-constraint re-layout pass in `scene-layout.ts` that re-routes flows
attaching on the wrong side of their target. CLI-only — the playground bundles
run in a browser, where the switch reads as absent rather than throwing (see
[PLAYGROUND_BUILD.md](documentation/PLAYGROUND_BUILD.md#no-node-globals-in-engine-code)).
Nothing in the repo sets it, so it must never change committed output.

## Opening a PR

- Keep it focused — one concern per PR.
- Link the PR to an issue.
