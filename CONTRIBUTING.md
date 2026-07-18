# Contributing to cairn

> Before making a pull request, create an issue so we can discuss it. When the proposal is agreed upon, you'll be assigned to it an you go ahead with the pull request :) !

## Tests

```sh
npm test          # full suite (unit + non-regression snapshots)
```

CI runs the same command on every push and PR, plus a build gate that rebuilds
every example and asserts `label overlaps: 0`.

## The non-regression snapshot gate

`tests/snapshot.test.ts` freezes rendered output across three code paths, each
diffed against a committed snapshot on every run:

- **Diagrams** — a small **canary set** of example diagrams (one per view, plus
  the reroute-heavy, numbered, custom colour, and localized cases).
- **Themes** — one example per built-in theme/palette, so a shared-rendering
  change that only shows up on a non-default theme doesn't slip through.
- **Infrastructure matrix** — the `matrixCsv` / `matrixMd` / `matrixSvg`
  exporters, each a separate formatting code path, snapshotted against the same
  source diagram.

Snapshots live under `tests/__snapshots__/` (`.snap.svg`, `.csv`, `.md`).

The point is to fail **only on changes you didn't mean to make**. CI can't tell
an intended change from a regression, so intent is encoded by whether the
snapshots were updated:

- **You changed layout/render on purpose** → regenerate and commit the snapshots
  in the same PR:

  ```sh
  npm run snapshots
  git add tests/__snapshots__
  ```

  The reviewer sees the snapshot diff alongside your code change — that diff *is*
  the visible record of what your change did to output.

- **You didn't touch rendering** but a snapshot changed → that's a regression.
  Find what moved before updating the snapshot.

### Why the snapshots are "normalized"

Render output is byte-deterministic on a single machine, but one value in the
output path comes from `Math.hypot` (numbered-flow label placement), which isn't
guaranteed identical to the last bit across operating systems / Node versions.
The gate rounds every decimal to 1 dp before comparing, so that sub-pixel drift
can never cause a false failure — while any change a human would call a
regression (a ≥0.1px move, a colour, text, or structural change) is still
caught. This is why the check is safe to run on Linux CI even though the
committed snapshots may have been generated on macOS.

### Adding or changing a canary

Edit the `CANARIES` (diagrams) or `THEMES` list in `tests/snapshot.test.ts`,
then run `npm run snapshots` to record it. Keep the sets small and diverse on
purpose: a large snapshot set turns every intentional change into a noisy,
hard-to-review diff. Broad "every example still builds cleanly" coverage is
handled separately by the overlap gate in `.github/workflows/ci.yml`, which
runs over all examples.
