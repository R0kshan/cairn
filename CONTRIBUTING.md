# Contributing to cairn

Contributions and ideas are welcome. **Open an issue first** so we can agree on
the approach before you invest in a PR.

## Getting started

cairn has **no build step** — TypeScript runs directly on **Node ≥ 22.6** via
`node --experimental-strip-types`. So there's nothing to compile:

```sh
npm install
npm run cairn -- new -L my.cairn     # scaffold a diagram
npm run cairn -- build my.cairn      # render it to SVG
```

The only runtime dependency is `elkjs` (the layout engine); the dev toolchain is
just biome + typescript. Please keep both lists that short — a new dependency is
permanent maintenance for a solo project.

## The three checks (all must be green)

```sh
npm run typecheck     # tsc --noEmit — the runtime strips types, so this is the ONLY type check
npm run lint          # biome (lint-only; don't reformat existing code)
npm test              # unit tests + the non-regression gates
```

CI also runs a `label overlaps: 0` gate across every example, and builds the
Bun binary and playground bundle (Node-only tests can't cover those — run
`npm run test:binary` locally if you touch bundling or the elkjs worker).

## What you can't break

Invariants detailed in `CLAUDE.md`. In short:
- **Zero label overlaps.** **Byte-deterministic output.**
- **No build step, one runtime dep (elkjs).**
- **User text is untrusted** — `esc()` / `escAttr()` into SVG.
- **Diagnostics are coded, never thrown** — reuse `E0xxx`/`W0xxx` scheme.

## When a snapshot gate fails — is it my change or a regression?

`npm test` compares current output against committed reference files (the digest,
the README SVGs, and detailed snapshots). When one mismatches, the test fails.

**Don't reflexively regenerate.** Follow this procedure:

### Step 1 — preview what changed

```sh
npm run snapshots:report
```

It prints a grouped summary. Examples:

| `snapshots:report` says… | Meaning |
|---|---|
| `⚠ GEOMETRY moved (2): large.cairn, large-fr.cairn` | Coordinates, sizes, or structure changed — a layout shift |
| `· colour only (5): themes/dark.cairn, …` | Only colours changed (fill, stroke, palette) |
| `· text only (2): large-fr.cairn, …` | Only label text or i18n changed |

### Step 2 — decide: intended or regression?

| If you made… | and `snapshots:report` shows… | then… |
|---|---|---|
| A theme/colour edit | `colour only` on affected files | ✅ intended |
| A layout/spacing/ELK change | `⚠ GEOMETRY moved` on affected files | ✅ intended |
| A label/i18n change | `text only` on affected files | ✅ intended |
| A change that touches all three | a mix of `colour` + `geom` + `text` | ✅ intended |
| Something else entirely | *any* change | ❌ regression — find the bug |
| Nothing render-related | no change | ✅ you're clean |
| Nothing render-related | *any* change | ❌ regression — find the bug |

> **What about detailed snapshots?** `snapshots:report` only covers the corpus
> digest. You might also see *"<file>.snap.svg changed vs its committed
> snapshot"* from the snapshot tests (`tests/snapshot.test.ts`). Same decision:
> was your change supposed to alter that diagram's render? If yes → intended.
> If no → regression. `npm run snapshots` refreshes those too.

### Step 3 — if intended, regenerate

```sh
npm run snapshots     # refreshes the digest, README SVGs, AND detailed snapshots
git add tests/__snapshots__ examples
```

The reference output is now updated. That diff is the record of your change — reviewers
read it next to your code.

### Step 4 — verify the result

Open a few of the changed SVGs (`tests/__snapshots__/*.snap.svg` or
`examples/*.svg`) in your browser. Do they look right? A geometry shift you
didn't intend is still a regression, even with passing tests.

**Never regenerate to silence a diff you don't understand** — that turns the
gate into noise.

---

### How the three snapshot layers work (background)

`npm test` runs three checks. `npm run snapshots` updates all three at once:

| Layer | What it guards | How it reports |
|---|---|---|
| **Structural digest** — `tests/corpus.test.ts` | Every `.cairn` example → one digest line per diagram, split by `geom` / `color` / `text` | `snapshots:report` tells you *which* fingerprint moved |
| **Example-SVG fidelity** — `tests/corpus.test.ts` | Committed `examples/*.svg` (the README images) stay in sync with the code | Fails if a README image would be stale |
| **Detailed snapshots** — `tests/snapshot.test.ts` | A chosen set: one diagram per view (EN+FR), every theme, matrix exports | Fails with a literal file diff — inspect the failing file |

The `geom`/`color`/`text` split is the key idea: it answers "is this my feature
or a regression?" at a glance — geometry moves are risky, colour changes are
almost always intentional, text changes are label/i18n edits.

### Why reference output is "normalized"

`Math.hypot` (numbered-flow label placement) isn't identical to the last bit
across OSes. The digest rounds decimals to 1 dp before comparing, so sub-pixel
drift doesn't false-fail while any real change (≥0.1px, colour, text, structure)
is still caught. Safe to generate on macOS, check on Linux CI.

### Adding an example or a snapshot

Drop a `.cairn` file in `examples/` — `npm run snapshots` records it in the
structural digest automatically. To also snapshot it at full detail, add it
to the `CANARIES` / `THEMES` list in `tests/snapshot.test.ts`. Keep that set
small. Examples can be bulk-regenerated with `npm run examples`.

## Opening a PR

- The three checks are green. If you changed render/layout on purpose, the
  regenerated reference output is committed in the same PR.
- **Don't commit — leave changes staged and ask the maintainer to review.**
- Keep it focused — one concern per PR keeps the snapshot diff reviewable.
- Link the PR to an issue.
- Extending the pipeline (view / diagnostic / theme / style property) starts in
  `src/model.ts`.
- Releases: lowercase `vX.Y.Z` tag drives everything (`RELEASING.md`).
- **Fast iteration loop:** edit → `node --experimental-strip-types src/cli.ts build examples/<file>.cairn -o /tmp/test.svg` → open SVG.