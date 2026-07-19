# Contributing to cairn

Any contributions and ideas for improvement are very welcome ! Feel free to create an issue so we can discuss them before opening a PR. 

## Tests

```sh
npm test               # full suite (unit + non-regression gates), Node-only
npm run snapshots         # accept intended render changes (regenerate goldens)
npm run snapshots:report  # preview what a render change would touch, and WHAT KIND
npm run test:binary       # compile the host binary with Bun and smoke-run it (needs Bun)
```

CI runs `npm test` (plus `typecheck` + `lint`) on every push and PR, a build
gate that rebuilds every example asserting `label overlaps: 0`, **and two build
smokes that `npm test` can't do**: it compiles the host Bun binary and actually
runs it (`scripts/smoke-binary.sh` — proves the compiled artifact works, which
Node tests can't), and it bundles the playground with esbuild (proves the
browser/node bundles still build). The release workflow smoke-runs the linux
binary again before publishing, so a broken compile can't ship.

## Non-regression testing

cairn's whole value is that its output is stable and readable, so the output
itself is the thing under test. The tricky part isn't catching changes — it's
telling a change you **meant** to make (you edited a theme colour) from a
**regression** (a label silently drifted). The setup below is built to make 
that distinction.

There are three layers, all run by `npm test`:

### 1. Structural digest — the whole corpus, one file

`tests/corpus.test.ts` builds **every** example once and reduces each to a
one-line fingerprint in `tests/__snapshots__/corpus.digest`. Each line splits
the render into three **independent** hashes:

| fingerprint | what it covers | when it changes |
|---|---|---|
| `geom` | every coordinate, size, path, structure | a layout shift — **the risky kind** |
| `color` | every fill / stroke / palette value | a theme/palette edit — usually intended |
| `text` | the content of every `<text>` | a label / i18n edit |

plus scalars (`n` nodes, `e` edges, `ov` overlaps, `dim` size). Because it's one
file, full-corpus coverage costs a small, readable git diff — not 70 regenerated
SVGs.

### 2. Example-SVG fidelity — the images can't rot

The SVGs committed under `examples/` (the ones the README shows) are rebuilt and
compared to the code's current output, so a published diagram can never silently
fall out of sync with the tool.

### 3. Full-fidelity canary snapshots

`tests/snapshot.test.ts` keeps a small **curated set** you can eyeball in full:
one diagram per view (EN+FR), every theme, and the three matrix formats
(`matrixCsv`/`matrixMd`/`matrixSvg`). Snapshots live in `tests/__snapshots__/`
(`.snap.svg`, `.csv`, `.md`).

## Regression, or an intended change? — the workflow

When a gate fires, **don't reflexively regenerate**. First ask what moved:

```sh
npm run snapshots:report
```

It prints the changed examples grouped by kind, e.g.:

```
9 example(s) changed, 63 unchanged:
  · colour only  — usually an intended theme edit (9): themes/dark.cairn, …
```

Read it against your change's **blast radius**:

- You edited a **theme colour** → expect `colour only`, on exactly the affected
  themes. `geom` moving too? That's a regression — investigate before accepting.
- You changed a **layout constant** → expect `⚠ GEOMETRY moved` broadly. That's
  the loud, dangerous signal you *want* to see for that kind of change.
- You touched **nothing render-related** but something moved → regression. Find
  it; do not paper over it.

Once you've confirmed the change is intended, **acknowledge it** by regenerating
and committing the goldens in the *same* change:

```sh
npm run snapshots            # refreshes the digest, the example SVGs, and the canary snapshots
git add tests/__snapshots__ examples
```

That commit is the record of what your change did to output — the reviewer sees it next to the code. 
**Never regenerate to silence a diff you don't understand**; that turns the gate into noise.

## Why the goldens are "normalized"

Render output is byte-deterministic on one machine, but a single value in the
output path comes from `Math.hypot` (numbered-flow label placement), which isn't
guaranteed identical to the last bit across OSes / Node versions. The digest and
the SVG fidelity check round every decimal to 1 dp before comparing, so sub-pixel
drift can't cause a false failure — while any change a human would call a
regression (a ≥0.1px move, a colour, text, or structural change) is still caught.
This is why the gates are safe on Linux CI even if the goldens were generated on
macOS.

## Adding an example or a canary

Drop a `.cairn` file in `examples/` and it's automatically in the structural
digest — run `npm run snapshots` to record it. To also give it a full-fidelity
snapshot, add it to the `CANARIES` / `THEMES` list in `tests/snapshot.test.ts`.
Keep the canary set small: it's the surface a human reviews in full, and a big
one just trains you to rubber-stamp.
