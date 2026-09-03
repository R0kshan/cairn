# Contributing to cairn

**Open an issue first** so we can agree on the approach before you invest in a PR.

## Getting started

No build step — TypeScript runs directly on **Node ≥ 22.6** via the `--experimental-strip-types` flag.

```sh
npm install
npm run cairn -- new -L my.cairn     # scaffold a diagram
npm run cairn -- build my.cairn      # render it to SVG
```

The whole dependency list is biome + typescript + @types/node + elkjs + esbuild, and they are **all devDependencies** — the published package installs nothing. `elkjs` is the only third-party module `src/` imports, but every shipped artifact inlines it (Bun for the binaries, esbuild for the CLI and playground bundles), so consumers never resolve it. Keep the list that short. esbuild earns its place by being the publish path — it builds the playground bundles, the npm CLI (`scripts/build-cli.sh`) and the importable engine bundle (`scripts/build-api.sh`), so it's pinned exactly and locked by `package-lock.json` rather than fetched at build time.

Inlining elkjs means cairn *distributes* it, so [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) carries its EPL-2.0 notice and points at the corresponding source. It ships in the npm tarball and lives in the repo for every other channel. If you add, remove, or bump anything that ends up inside a shipped artifact, update that file in the same commit.

`CLAUDE.md` is a symlink to `AGENTS.md` (so Claude Code auto-loads the real
content, not a pointer) — if `git config core.symlinks` was off on checkout
(mainly a Windows/older-git concern), it may check out as a plain file
containing the literal text `AGENTS.md` instead; enable `core.symlinks` and
re-checkout if so.

### Why no build step works for cairn

`--experimental-strip-types` tells Node to erase the type annotations and run the resulting JavaScript — no compilation, no `dist/`, no sourcemap chasing. This matters in **development only** — every shipped artifact is pre-built: the release binaries by Bun, the npm CLI by esbuild. Node refuses to strip types under `node_modules`, so nothing installed can rely on the flag. In dev it eliminates the entire compile step:

- **Instant edit-run cycle.** Change source, re-run the test or CLI command right away — no `tsc --watch`, no `dist/`
- **No unsupported TS features needed.** The flag doesn't support `enum` with initializers, `const enum`, `namespace`, or legacy decorators. cairn uses none of these.

The tradeoff: it's experimental (track [node#53725](https://github.com/nodejs/node/issues/53725)). If the flag changes or disappears, the necessary adaptations will be made by this repository's maintainer.

## What you can't break

Invariants detailed in [`AGENTS.md`](./AGENTS.md#non-negotiable-invariants). In short:
- **Zero label overlaps. Byte-deterministic output.**
- **Every flow is a distinct arrow with a distinct label** — flows are never visually merged.
- **Labels are mandatory in logical view (E0203)** — optional in application and infrastructure.
- **Protocol is mandatory in infrastructure view (E0240)** — recommended (warning) in application (W0540).
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

The table above covers the render pipeline. Three things it doesn't:

| You changed… | Also run |
|---|---|
| `package.json`'s `files` / `exports` / `bin` / `prepack`, or a publish-path build script (`scripts/build-cli.sh`, `scripts/build-api.sh`) | `npm run test:npm` |
| bundling or the elkjs worker | `npm run test:binary` |
| anything under `src/` | rebuild the playground bundles — [PLAYGROUND_BUILD.md](documentation/PLAYGROUND_BUILD.md#update-playground-after-modifying-src) |

**`npm test` cannot see packaging** — it runs from the repo, not the tarball.
`npm run test:npm` packs, installs into a throwaway consumer and exercises both
published surfaces from there: the installed `cairn` command and
`import { compile } from "@r0kshan/cairn"`. It is the only gate that catches a
`files`/`exports` mismatch, which publishes cleanly and breaks only at a
consumer's `import` — and an npm version can never be republished. CI runs all
three on every PR.

### When a gate fails

1. **Preview** — `npm run snapshots:report` (groups changes by geometry / colour / text), or `npm run sweep -- --detail` (each defect with its edge id).
2. **Decide** — related to your edit? Then intended. If not, it's a regression: find the bug.
3. **If intended** — `npm run snapshots`, or `npm run sweep -- --update-baseline` for the readability floor, then commit the updated references.
4. **Verify** — open a few changed SVGs in your browser.

**Never regenerate to silence a diff you don't understand** — that turns the gate into noise.

[`tests/README.md`](tests/README.md) is the full account, and the only one worth
keeping current: what each of the four layers catches, how the readability
baseline accepts trades rather than demanding monotone improvement, and the
sweep's `--only` / `--shard` / `--detail` / `--update-baseline` flags.

`CAIRN_NO_PORT_PASS=1` is the one debug env var in the pipeline: it skips the
port-constraint re-layout pass in `scene-layout.ts` that re-routes flows
attaching on the wrong side of their target. CLI-only — the playground bundles
run in a browser, where the switch reads as absent rather than throwing (see
[PLAYGROUND_BUILD.md](documentation/PLAYGROUND_BUILD.md#no-node-globals-in-engine-code)).
Nothing in the repo sets it, so it must never change committed output.

## Opening a PR

- Keep it focused — one concern per PR.
- Link the PR to an issue.
