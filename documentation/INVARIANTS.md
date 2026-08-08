## Non-negotiable invariants


1. **Zero label overlaps.** Every example builds with `label overlaps: 0`
   (CI-gated).
2. **Byte-deterministic output.** Same input → identical SVG across runs and
   platforms. Only `+ - * /`, `round`, `ceil`, and one normalized `Math.hypot`
   (numbered-flow labels) are allowed in the output path. Never introduce
   `Date.now()` / randomness / locale-formatted numbers.
3. **The non-regression gates encode *intent*.** CI can't tell an intended
   render change from a regression — you express intent by committing
    regenerated reference output (`npm run snapshots`) in the SAME change. Three layers in
   `npm test`: structural digest (`corpus.digest`, geom/color/text per example),
    example-SVG fidelity (committed `examples/*.svg` can't rot), detailed snapshots.
   When a gate fires, run **`npm run snapshots:report` first** — geometry moving
   is the risky kind; colour-only is usually an intended theme edit. A change
   outside your edit's blast radius is a regression. **Never regenerate to
   silence a diff you don't understand** — that's the one instinct to override.
4. **Readability is gated by `npm run sweep`**, which recursively sweeps every
   `.cairn` fixture under `examples/` (top level plus `dispositions/` and
   `themes/`) × every disposition. Six invariants must stay at **0**: label
   overlaps, segments off orthogonal, runs crossing a leaf box, dead
   horizontal bands, coincident segments, shared attachment points. The rest
   (staircases, tight attachments, near-parallel runs, long detours) are a
   **ratchet**, expressed as a rate per swept flow-instance (not a raw count)
   so adding fixtures doesn't spuriously fail the gate: current rates are
   ceilings and may only fall. Lower a rate when a change earns it; never
   raise one to go green. What each defect looks like on the page and why
   it's bucketed the way it is: [`documentation/READABILITY.md`](./documentation/READABILITY.md).
5. **Flow labels are required on the logical view** (`E0203`),
   optional on application & infrastructure. Infrastructure flows must still
   carry `protocol/port` (`(HTTPS/443)` — `E0240`) even when unlabelled.
6. **Flow routing, tidying, compaction, and readability scoring are
   DSL-agnostic.** `route-detour.ts`, `edge-tidy.ts`, `compact.ts`, and
   `scripts/sweep.ts`'s metrics operate purely on the post-layout `Scene` /
   `SceneNode` / `SceneEdge` geometry (plus generic `Model.style` /
   `Model.flows`) — never on an element's `kind` or which view produced it.
   A `server` and an `actor` look identical to these passes. Adding a view
   or element kind must never require touching them.