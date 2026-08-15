# Testing cairn

```sh
npm test          # sweep + all test files — what CI runs
npm run sweep     # readability gate alone (fast to iterate on)
npm run typecheck # the runtime strips types without checking them
npm run lint
```

`npm test` runs the readability sweep **first**, then the test files. The sweep
is the slowest and the most likely to catch a real problem, so it fails fast.

## Why there are four layers and not one

A diagram renderer fails in ways a unit test cannot see. The output is valid SVG,
the flows connect the right boxes, every assertion passes — and the picture is
unreadable, because a label drifted onto a neighbouring flow or a route now cuts
through a database. Each layer below exists because the ones above it were blind
to a class of bug that actually shipped.

| Layer | File | Catches |
|---|---|---|
| Behaviour | `behavior.test.ts` | Parser, validator, diagnostics, CLI, matrix export — things with a right answer |
| Public API | `api.test.ts` | `compile()` and the matrix formatters as an embedder calls them — the one-call surface no other layer touches |
| Structural digest | `corpus.test.ts` → `__snapshots__/corpus.digest` | Any change to any example's geometry, colour or text |
| SVG fidelity | `corpus.test.ts` → `examples/*.svg` | Committed example SVGs drifting from the code |
| Detailed snapshots | `snapshot.test.ts` → `__snapshots__/*.snap.svg` | Full SVG for one fixture per view, every theme, and the matrix export for every view × every format (csv/md/svg) |
| Readability | `scripts/sweep.ts` → `__snapshots__/readability.baseline` | The picture being *worse*, which every layer above passes |

### The digest is split three ways

`corpus.digest` records one line per diagram, split into geometry / colour /
text. A theme change should move colour and nothing else; a routing change
should move geometry and nothing else. When a diff touches a category it had no
business touching, that is the finding — not noise.

`npm run snapshots:report` groups a pending diff the same way before you accept
anything.

## The readability gate

`npm run sweep` renders every `.cairn` fixture under `examples/` (top level plus
`dispositions/` and `themes/`) in all four dispositions — 288 drawings — and
counts defects. It gates in three independent ways.

**1. Invariants that must be zero.** Label overlaps, non-orthogonal segments,
runs through a leaf box, dead bands, coincident segments, shared attachment
points, labels adrift from their flow. No trade buys these; a single occurrence
fails the run.

**2. Ratcheted rates.** Everything else — jogs, near-parallel runs, crossings,
struck titles, off-line labels, tight attachments — has a ceiling expressed as a
**rate per swept flow-instance**, not a raw count, so adding fixtures doesn't
spuriously fail the gate. Rates may only fall. Lower one when a change earns it;
never raise one to go green.

**3. Per-drawing baseline.** `__snapshots__/readability.baseline` records the
accepted count for every drawing × metric. The rates have a blind spot this repo
has been bitten by: a change can improve sixty drawings, quietly make one worse,
and every total still falls. The baseline catches that.

### The baseline understands trades

The routing optimiser is built to trade — spending an extra turn to remove a
crossing is the point, not a defect (see
[`documentation/FLOW_ROUTING.md`](../documentation/FLOW_ROUTING.md)). A gate that
failed any drawing getting worse on any metric would therefore fail every
correct trade, and the only way to pass it would be to stop the router doing its
job.

So the baseline applies the same five-tier ladder the router does. A drawing may
get worse at tier N **only if it improved at a tier that matters more**. Those
show in the output as:

```text
26 ladder trade(s) accepted — a lower-priority defect paid for a higher-priority fix:
  ~ application-large/wide: jog<=6 0 -> 1 (paid for a tier 2 gain)
```

A drawing that gets worse with nothing better to show for it is a regression and
fails. Tier 0 has nothing above it, so nothing ever buys a tier 0 regression.

### Working with the sweep

```sh
npm run sweep -- --only=infrastructure-large   # one fixture family
npm run sweep -- --shard=1/3                   # every 3rd fixture (CI parallelism)
npm run sweep -- --detail                      # each defect with its edge id
npm run sweep -- --update-baseline             # lock in improvements
```

`--only` and `--shard` report the corpus-wide rates without gating them — a rate
measured over part of the corpus cannot judge a corpus-wide ceiling. The
per-drawing baseline still gates, since each drawing is judged against its own
line, and `--update-baseline` on a partial run only touches drawings actually
swept.

## When a gate fails

1. **Preview** — `npm run snapshots:report`, or `npm run sweep -- --detail`.
2. **Decide** — is this change related to your edit? If not, it's a regression:
   find the bug. Don't skip this step because the totals improved.
3. **If intended** — `npm run snapshots` (or `--update-baseline`), then commit
   the updated references.
4. **Verify** — open a few changed SVGs. The gates measure the picture; they
   don't look at it.

**Never regenerate to silence a diff you don't understand.** That converts a
gate into noise, and every gate here exists because something got through.

## Adding a fixture

Drop the `.cairn` file under `examples/`, then `npm run examples` and
`npm run snapshots` and commit the generated SVGs. The sweep discovers fixtures
recursively — a new file is swept in all four dispositions automatically, and
appears as `drawing(s) not in the baseline` until you run `--update-baseline`.

## What isn't covered here

`npm run test:binary` smoke-tests the Bun-compiled release binary; run it if you
touch bundling or the elkjs worker. Playground bundles are rebuilt separately —
see [`PLAYGROUND_BUILD.md`](../documentation/PLAYGROUND_BUILD.md).

`playground.test.ts` is a narrow exception: it loads the committed browser
bundle and compiles a large fixture with `process` deleted from `globalThis`,
catching the one failure mode that's browser-specific — a Node global
(`process`, `Buffer`, `require`, …) leaking into engine code and throwing where
no real browser provides it. It doesn't otherwise exercise the playground UI.
