# ADR-0005: Deterministic post-layout pass for backward hierarchical edges

Status: **Accepted** · Date: 2026-07-28

## Context

Issue [#26](https://github.com/R0kshan/cairn/issues/26): on diagrams with
several containers, elk routes some backward flows (target left of source)
as huge wrap-around detours — exiting east of the outermost container and
looping around the entire drawing — instead of a short path through the
containers in between. On `logical-archi` this produced a 2275 px route for
a flow whose direct distance was under 800 px.

Root cause: under `elk.hierarchyHandling: INCLUDE_CHILDREN` (required for
[ADR-0001](./ADR-0001-LAYOUT-ENGINE.md)'s nested containers), elk's
hierarchical edge router handles any right-to-left edge that crosses a
container boundary this way. It is not a tuning problem — it is how the
router is built.

## Options considered

| Option | Verdict |
|---|---|
| **Deterministic post-layout pass** (reroute through top/bottom channels) | ✅ Selected |
| Tune elk layered options | ❌ Eliminated — tested and proven no-ops (below) |
| Raise `elk.thoroughness` | ❌ Eliminated — moves geometry but leaves the wraps, sometimes worse |
| Switch away from `INCLUDE_CHILDREN` | ❌ Rejected — loses the nested-container layout ADR-0001 depends on |
| Wait for elk to ship hierarchical libavoid-style routing | ◑ Revisit if it ships; no committed timeline |

**The elk verdict — do not re-litigate without new evidence.** Tested and
proven byte-identical no-ops on `examples/logical-fr.cairn`:
`elk.layered.feedbackEdges` (true/false), `elk.layered.cycleBreaking.strategy`
(`MODEL_ORDER`, `DEPTH_FIRST`), `elk.layered.wrapping.strategy`,
`elk.layered.crossingMinimization.strategy`. `thoroughness` at 50/70/100 moves
geometry but leaves the wraps in place. No layered option influences this
behavior — it is intrinsic to the hierarchical edge router.

## Decision

**Add a deterministic post-layout pass, `src/route-detour.ts`, that detects
elk's wrap-around detours and reroutes them through a top or bottom channel.**
Runs after `scene-layout.ts` produces the elk scene, before `edge-tidy.ts`.

Scope and behavior:

- **Candidates only** — an edge qualifies when its elk path length is
  ≥ 1.4× the direct manhattan distance *and* wastes ≥ 300px. A diagram with
  no qualifying edge is untouched: the pass returns before touching anything,
  which is what keeps unaffected examples byte-identical.
- **Applies to every disposition.** A DOWN layout (`page`/`tall`) has the same
  problem rotated 90° — backward flows wrap around top/bottom instead of
  left/right. `scene-layout.ts` transposes the scene across the diagonal
  around this pass so one implementation and one set of gated invariants
  serve both orientations. Container titles and label text do not rotate with
  the geometry (computed pre-transpose, passed in) — see
  [`internals/ROUTING.md`](../internals/ROUTING.md) for why.
- **Bottom channel preferred, top channel as fallback** — an explicit
  maintainer choice (south-first) to keep already-approved outputs stable
  over a theoretically more optimal but less predictable channel choice.
- Full mechanism — obstacle model, channel/lane planning, slot redistribution,
  placement — is documented in
  [`internals/ROUTING_IMPLEMENTATION.md`](../internals/ROUTING_IMPLEMENTATION.md),
  not repeated here; an ADR records *why*, not the implementation.

Determinism rules apply as everywhere in the render path: only
`+ - * / round ceil min max abs`, fixed iteration order (numeric flow id,
sorted group keys). `Math.hypot` is banned in this pass (reserved for
numbered-flow labels in `scene-layout.ts`).

## Consequences

### Positive
- `logical-archi`'s worst detour went from a full-diagram wrap to a routed
  channel path (1078 → 821 px, 19 → 15 crossings across the full round of
  work); corpus-wide, 20 long detours were removed and the current sweep
  ceiling for `longDetour` is a rate per swept flow-instance that may only
  fall (see [`READABILITY.md`](../READABILITY.md)).
- Independent of elk internals — if elk's router changes upstream, this pass
  degrades to a no-op on diagrams it no longer needs to touch, rather than
  breaking.
- `examples/logical-fr.svg` is maintainer-approved, byte-identical output —
  a stable regression canary for the bottom-channel path.

### Negative
- A second, hand-written routing layer next to elk's own — more surface to
  maintain than tuning options would have been, had tuning worked.
- Not exhaustive: some detour shapes remain (documented in
  [`internals/ROUTING_IMPLEMENTATION.md`](../internals/ROUTING_IMPLEMENTATION.md)'s
  "known remaining work"), e.g. externally-blocked flows that would need a
  symmetric east-side channel not yet built.

### Neutral
- `edge-tidy.ts`'s two universal rules (straighten, then separate) run after
  this pass and apply to every edge, rerouted or not — see
  [`internals/ROUTING_IMPLEMENTATION.md`](../internals/ROUTING_IMPLEMENTATION.md).
- The four non-negotiables this ADR serves are gated at zero by
  `npm run sweep`; five related metrics (staircases, tight attachments,
  near-parallel runs, long detours, coincident/attach-shared handful the
  passes cannot yet remove) are ratcheted ceilings, not gates — see
  [`AGENTS.md`](../../AGENTS.md#non-negotiable-invariants) invariant 4.

## Links

- [internals/ROUTING.md](../internals/ROUTING.md) — the concept: the problem,
  the channel idea, why one implementation serves both page orientations
- [internals/ROUTING_IMPLEMENTATION.md](../internals/ROUTING_IMPLEMENTATION.md)
  — the mechanism: channel/lane architecture, obstacle model, edge-tidy
  interaction, known remaining work
- [READABILITY.md](../READABILITY.md) — what the sweep gate measures and the
  current ceiling numbers
- [ADR-0001](./ADR-0001-LAYOUT-ENGINE.md) — why `INCLUDE_CHILDREN` is load-bearing
- [src/route-detour.ts](/src/route-detour.ts) — implementation
- [src/edge-tidy.ts](/src/edge-tidy.ts) — the universal straighten/separate pass this feeds into
- Issue [#26](https://github.com/R0kshan/cairn/issues/26)
