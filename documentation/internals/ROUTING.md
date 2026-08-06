# How flow routing works

Cairn's layout engine (elk) sometimes draws a flow the long way around an
entire diagram instead of threading it through the middle. This document
explains the problem and the fix conceptually — no function names, no
constants, no code. If you're about to edit `src/route-detour.ts` or
`src/edge-tidy.ts`, read [`ROUTING_IMPLEMENTATION.md`](./ROUTING_IMPLEMENTATION.md)
instead; it picks up where this leaves off.

## The problem

A flow that goes "backward" — its target sits to the left of its source —
and also crosses a container boundary gets routed by elk as a wrap-around: it
exits past the *outside* of the whole drawing and loops all the way back,
even when a much shorter path exists straight through the space between
containers.

```
Without correction — elk's raw route:

┌─────────────────────────────────────────────┐
│  ┌────────┐        ┌────────┐                │
│  │   A    │        │   C    │                │
│  └───┬────┘        └────────┘                │
│      │                                       │
│      └──── exits the whole diagram ──────┐   │
└──────────────────────────────────────────┼───┘
                                            │
                        (loops all the way around)
                                            │
                                            ▼
                                       ┌────────┐
                                       │   D    │
                                       └────────┘
```

This isn't a rare edge case — it's how elk's router is built for this class
of edge, and it happens on any diagram with more than a couple of containers.
It was tracked as [issue #26](https://github.com/R0kshan/cairn/issues/26) and
the decision to fix it with a dedicated pass, rather than by tuning elk, is
recorded in [ADR-0005](../decisions/ADR-0005-FLOW-ROUTING.md).

## The fix: route through a channel

Instead of accepting elk's wrap, a pass after layout ("the reroute") looks
for these oversized detours and redraws them through a **channel** — a lane
running along the top or bottom of the affected containers:

```
With the reroute:

┌─────────────────────────────────────────────┐
│  ┌────────┐        ┌────────┐                │
│  │   A    │        │   C    │                │
│  └───┬────┘        └────────┘                │
│      │                                       │
│      └──────── channel ─────────────┐        │
└───────────────────────────────────┬─┘        │
                                     ▼          │
                                ┌────────┐      │
                                │   D    │      │
                                └────────┘      │
└─────────────────────────────────────────────┘
```

The bottom channel is tried first; a top channel is used only when something
blocks the bottom exit. When several flows need a channel, they're stacked
into separate lanes so their paths don't cross each other unnecessarily —
lanes closest to the content go to flows that need the shortest detour.

## One implementation, both page orientations

Cairn renders diagrams in two families of layout: left-to-right (`wide`,
`slide`) and top-to-bottom (`page`, `tall`). A top-to-bottom layout has the
exact same wrap-around problem, just rotated 90° — instead of wrapping left
and right, backward flows wrap around the top and bottom.

Rather than write and maintain two versions of the same logic, the layout
step rotates the whole diagram 90° before handing it to the reroute pass, and
rotates it back afterward. The reroute pass itself only ever has to solve the
left-to-right case. Two things are deliberately excluded from that rotation
— container titles and label text stay right-side-up throughout, since text
never rotates with the page.

## What "correct" means here

A rerouted flow has to satisfy the same readability rules every flow does —
see [`AGENTS.md`](../../AGENTS.md#non-negotiable-invariants) for the
CI-gated ones. A few are specific to routing and worth stating plainly:

- **Every flow stays individually traceable.** Two flows never draw as one
  line, and two flows never land on the exact same point on a node's edge.
- **A flow never cuts through a container it has nothing to do with.**
- **A flow never crosses through a container's title text.**
- **No line runs directly along a container's border**, which would read as
  part of the border rather than a flow.
- **A flow that starts and ends inside the same container stays inside it** —
  routing it outside would make it look like it left the system it belongs
  to.

What today's gate can and can't catch is described in
[`READABILITY.md`](../READABILITY.md); the specific numeric thresholds behind
each rule above are in `ROUTING_IMPLEMENTATION.md`, not here.
