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

CI runs all three on every push and PR, plus a gate that rebuilds every example
asserting `label overlaps: 0`, and — because `npm test` is Node-only — **two
build smokes it can't do itself**: it compiles the host Bun binary and actually
runs it (`scripts/smoke-binary.sh`, also `npm run test:binary` locally), and it
bundles the playground with esbuild. The release workflow smoke-runs the linux
binary again before publishing, so a broken compile can't ship.

## What you can't break

cairn's value is dense diagrams that stay readable, so a few properties are
non-negotiable (see `CLAUDE.md` for the full list and rationale):

- **Zero label overlaps** — every example builds with `label overlaps: 0`.
- **Byte-deterministic output** — same input → identical SVG, everywhere. No
  `Date.now()`, randomness, locale-formatted numbers, or trig in the render path.
- **No build step, one runtime dep.** Don't add either.
- **User text is untrusted** — escape it into SVG: `esc()` for text content,
  `escAttr()` for attribute values. Ship every security fix with its exploit as a
  regression test.

Diagnostics are coded, never thrown: user errors are `Diagnostic`s (`E0xxx` /
`W0xxx`) with a source span and a `help` string. Reuse the scheme.

## Non-regression testing

The output *is* the thing under test. The hard part isn't catching a change —
it's telling a change you **meant** to make (you edited a theme colour) from a
**regression** (a label silently drifted). Three layers, all run by `npm test`:

### 1. Structural digest — the whole corpus, one file

`tests/corpus.test.ts` builds **every** example once and reduces each to a
one-line fingerprint in `tests/__snapshots__/corpus.digest`, splitting the render
into three **independent** hashes:

| fingerprint | what it covers | when it changes |
|---|---|---|
| `geom` | every coordinate, size, path, structure | a layout shift — **the risky kind** |
| `color` | every fill / stroke / palette value | a theme/palette edit — usually intended |
| `text` | the content of every `<text>` | a label / i18n edit |

plus scalars (`n` nodes, `e` edges, `ov` overlaps, `dim` size). One file, so
full-corpus coverage costs a small readable git diff — not 70 regenerated SVGs.

### 2. Example-SVG fidelity — the images can't rot

The SVGs committed under `examples/` (the ones the README shows) are rebuilt and
compared to current output, so a published diagram can't silently fall out of
sync with the code.

### 3. Full-fidelity canary snapshots

`tests/snapshot.test.ts` keeps a small **curated set** you can eyeball in full:
one diagram per view (EN+FR), every theme, and the three matrix formats. These
live in `tests/__snapshots__/` (`.snap.svg`, `.csv`, `.md`).

## Regression, or an intended change? — the workflow

When a gate fires, **don't reflexively regenerate.** First ask what moved:

```sh
npm run snapshots:report
```

It prints the changed examples grouped by kind, e.g.:

```
9 example(s) changed, 63 unchanged:
  · colour only  — usually an intended theme edit (9): themes/dark.cairn, …
```

Read it against your change's **blast radius**:

- Edited a **theme colour** → expect `colour only`, on exactly the affected
  themes. `geom` moved too? Regression — investigate before accepting.
- Changed a **layout constant** → expect `⚠ GEOMETRY moved` broadly. That's the
  loud signal you *want* for that kind of change.
- Touched **nothing render-related** but something moved → regression. Find it.

Only once you've confirmed the change is intended, acknowledge it by regenerating
and committing the goldens **in the same change**:

```sh
npm run snapshots        # refreshes the digest, the example SVGs, and the canary snapshots
git add tests/__snapshots__ examples
```

That diff is the record of what your change did to output — reviewers read it
next to the code. **Never regenerate to silence a diff you don't understand**;
that turns the gate into noise.

### Why the goldens are "normalized"

Output is byte-deterministic on one machine, but a single value comes from
`Math.hypot` (numbered-flow label placement), which isn't identical to the last
bit across OSes / Node versions. The digest and the fidelity check round every
decimal to 1 dp before comparing, so sub-pixel drift can't cause a false failure
while any real change (≥0.1px move, colour, text, structure) is still caught —
which is why the gates are safe on Linux CI even if the goldens came from macOS.

### Adding an example or a canary

Drop a `.cairn` file in `examples/` and it's automatically in the structural
digest — run `npm run snapshots` to record it. To also give it a full-fidelity
snapshot, add it to the `CANARIES` / `THEMES` list in `tests/snapshot.test.ts`.
Keep the canary set small: it's the surface a human reviews in full, and a big
one just trains you to rubber-stamp.

## Opening a PR

- The checks are green, and if you changed render/layout on purpose the
  regenerated goldens are committed in the same PR.
- Keep it focused — one concern per PR keeps the snapshot diff reviewable.
- Link the PR to an issue
- Extending the pipeline (a view / diagnostic / theme / style property) starts in
  `src/model.ts`;
