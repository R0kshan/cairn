# Open: three ratchets after the readability-ladder work

Transient. **Delete this file once the sweep is green** — the durable rules live
in [`INVARIANTS.md`](../../INVARIANTS.md) §3/§4 and
[`FLOW_ROUTING.md`](../FLOW_ROUTING.md); read those first.

The label defects this file was opened for are **closed**. What is left is one
decision, not one bug.

## Closed — tier 0/1 labels

| metric | was | now | ceiling |
|---|---|---|---|
| `labelAdrift` | 1 | **0** | must be 0 |
| `labelOrphan` | 7 | **0** | 0 |
| `labelPierced` | 10 | **0** | 6 |
| `labelOffLine` | — | 55 | 83 |

288 drawings, 0 per-drawing regressions, 389 improvements, 103 accepted trades.
Every other must-be-zero invariant still 0.

**The cause was not where this file said it was.** The revert guard measures the
label box and so does the sweep's `labelAdrift` — those two agree. What actually
failed was `src/label-anchor.ts`'s collision loop, in two ways, both confirmed by
tracing the drawing rather than by reading the code:

- It offered the escape to **one** label of a colliding pair (the larger) and
  reverted when that one was boxed in, leaving the other's seats untried.
  `large-fr/wide` sent F04 to the settler with F07's thirteen alternatives
  unused; the settler's only remaining move was an 86px throw landing 24px off
  F04's run. That was the whole of `labelAdrift`.
- Its escape ladder had only one rung — slide *along* the run — and then jumped
  straight to elk's placement, which is off the line *and* unattributable.
  Where two runs sit closer than a label is tall, no on-line seat can clear the
  neighbour, so that jump was forced. `medium`'s F10/F12 run 10px apart between
  nodes 181px apart carrying 111px and 71px of label: 182px of label in 181px of
  corridor. F12 got a seat 9px off its run with F06 through its words —
  `labelOrphan` + `labelPierced` across six drawings — while F10, which an
  exhaustive search shows had thousands of clean positions, kept a seat it did
  not need.

The fix adds the missing rung (`besideRun`: seats off the line but still
attributable, in two dimensions, since the seat that solves F10 is both past the
end of its run and 43px below it) and offers every escape to both labels. Each
candidate is validated with `attributableAt`, which is `scripts/sweep.ts`'s own
three predicates — box distance for adrift and orphan, text centre for the
on-line exemption of pierce.

## Decide — tier 2/3/4 ratchets

Unchanged in kind, slightly better in degree. These are the ceilings' problem,
not a bug:

| metric | HEAD | now | ceiling |
|---|---|---|---|
| `attachTight` | 22 | 19 | 3 |
| `nearParallel` | 75 | 73 | 58 |
| `fanTangle` | 71 | 69 | 65 |

All three rose while every drawing held or improved — that is what 103 accepted
trades look like in aggregate, and the ceilings were calibrated before any pass
could trade. Either recalibrate once with a documented reason (as `longDetour`
already does) or decide they are real. Do not touch the tier 0/1 ceilings.

`tests/behavior.test.ts` "flows are orthogonal and never share an attachment
point" fails on the same debt (`application.cairn BILL_ISSUE|east|47`, F07/F08
6px apart), identically at `666081f`. It goes green when `attachTight` does.

## Earned reductions not taken

`labelOrphan` and `labelPierced` are now 0 corpus-wide and `labelPierced`'s
ceiling could fall from 0.0013787 to 0. Left alone deliberately: dropping it to 0
makes it a de-facto must-be-zero, and §4a still describes corridors where no
placement wins. That is a call for the maintainer.

## Already tried — do not repeat

1. **Guard on the text centre.** Correct for §4d, wrong for `labelAdrift`, which
   the sweep measures on the box. Moves the defect.
2. **Settler loop nesting** in `svg-render.ts`: `for dx { for step }` exhausts an
   86px throw before a 24px slide, which is genuinely wrong — but alone it
   changed nothing.
3. **Widening the corridor.** `elk.spacing.edgeEdge` 9→44 and `MIN_ATTACH_GAP`
   12→36 both had zero effect while growing the drawing; `edgeEdge ≥ 22` crashes
   elkjs on `large.cairn`.
4. **Leaving an unresolvable pair to the settler** instead of reverting. The
   settler cannot always clear what it is handed: `medium` gained 5 `overlaps`
   and 5 `labelAdrift`, both must-be-zero. Something has to move in
   `label-anchor`; the revert stays unconditional as the last resort.
5. **Removing the overhang rung** on the grounds that `besideRun` regenerates the
   same seats at `away = 0`. It does — but only after the plain slide has failed,
   by which point the neighbour holds the seat. `security-fr` lost a title band to
   it in *page* and *tall*. The trap worth remembering: `npm run snapshots:report`
   said "corpus unchanged (72 examples)", because it renders each example in its
   **own** disposition only. Three quarters of the matrix is invisible to it. A
   pass is dead only if the *sweep* says so.
