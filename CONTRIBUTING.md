# Contributing to cairn

**Open an issue first** so we can agree on the approach before you invest in a PR.

## Getting started

No build step — TypeScript runs directly on **Node ≥ 22.6** via the `--experimental-strip-types` flag.

```sh
npm install
npm run cairn -- new -L my.cairn     # scaffold a diagram
npm run cairn -- build my.cairn      # render it to SVG
```

The only runtime dependency is `elkjs`; the dev toolchain is just biome + typescript. Keep both lists that short.

`CLAUDE.md` is a symlink to `AGENTS.md` (so Claude Code auto-loads the real
content, not a pointer) — if `git config core.symlinks` was off on checkout
(mainly a Windows/older-git concern), it may check out as a plain file
containing the literal text `AGENTS.md` instead; enable `core.symlinks` and
re-checkout if so.

### Why no build step works for cairn

`--experimental-strip-types` tells Node to erase the type annotations and run the resulting JavaScript — no compilation, no `dist/`, no sourcemap chasing. This matters in **development only** — the shipped binary is compiled by Bun and runs without Node. In dev the flag eliminates the entire compile step:

- **Instant edit-run cycle.** Change source, re-run the test or CLI command right away — no `tsc --watch`, no `dist/`
- **No unsupported TS features needed.** The flag doesn't support `enum` with initializers, `const enum`, `namespace`, or legacy decorators. cairn uses none of these.

The tradeoff: it's experimental (track [node#53725](https://github.com/nodejs/node/issues/53725)). If the flag changes or disappears, the necessary adaptations will be made by this repository's maintainer.

## What you can't break

Invariants detailed in [`AGENTS.md`](./AGENTS.md#non-negotiable-invariants). In short:
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

### Background

`npm test` runs three layers against committed reference files:

| Layer | Guards |
|---|---|
| **Structural digest** (`tests/corpus.test.ts`) | Every `.cairn` example → one digest line per diagram, split by geom/color/text |
| **Example-SVG fidelity** (`tests/corpus.test.ts`) | Committed `examples/*.svg` stay in sync with the code |
| **Detailed snapshots** (`tests/snapshot.test.ts`) | A chosen set: one per view (EN+FR), every theme, matrix exports |

`npm run snapshots` regenerates all three at once. `npm run examples` only refreshes the `examples/*.svg` files (subset of snapshots).

It then chains **`npm run sweep`**, the readability gate: every `.cairn`
fixture under `examples/` (top level plus `dispositions/` and `themes/`) ×
every disposition (288 drawings), six invariants that must be `0` and five
ratcheted ceilings — expressed as a rate per swept flow-instance so the gate
stays stable as fixtures are added — that may only fall. Run it alone while
iterating — `npm run sweep -- --detail` lists each defect with its edge id.

CI also builds the Bun binary + playground bundle. Run `npm run test:binary` locally if you touch bundling or the elkjs worker. After modifying `src/`, rebuild the playground bundles per [PLAYGROUND_BUILD.md](documentation/PLAYGROUND_BUILD.md#update-playground-after-modifying-src).

## Opening a PR

- Keep it focused — one concern per PR.
- Link the PR to an issue.
