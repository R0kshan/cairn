# How cairn routes flows

elk decides where the boxes go and plans a first set of routes. Everything after
that is cairn deciding how those routes should actually *read*. This document
explains the rule it uses to decide, because "make the diagram clearer" is not
one rule — it is a dozen rules that contradict each other, and the interesting
part is what happens when they do.

If you only read one thing: **cairn ranks readability problems into five tiers,
and it will happily create a low-tier problem to remove a high-tier one.** A
flow gaining an extra corner so it stops cutting through a database is a good
trade, and cairn makes it on purpose.

## The problem with "fix the diagram"

Consider a flow that runs straight through a box it has nothing to do with.
Moving it out costs something — a longer route, an extra turn, or a corner that
now passes close to another flow. Every fix is a trade.

Earlier versions of cairn had a separate rule for each defect, each with its own
idea of what counted as "better": one pass accepted a route because it was
shorter, another because it had fewer crossings, a third because it cleared a
container. They disagreed. The result was defects that *moved* rather than went
away — you fixed a crossing on the left and grew one on the right, and the
totals looked fine.

So there is now exactly one question, asked the same way everywhere: **does this
change trade a worse problem for a better one?**

## The ladder

Every defect cairn can detect sits at one of five tiers. Lower number = worse.

| Tier | What it means | Examples |
|---|---|---|
| **0** | **Information is destroyed.** The reader cannot recover what the diagram meant. | A run through a box it doesn't belong to; two flows drawn on top of each other; a route across a container's name; a label pierced by a foreign flow |
| **1** | **Attribution is broken.** You can see the lines, but not which label names which. | A label off its own run; a label nearer a neighbouring flow than its own |
| **2** | **A line is hard to follow.** You can attribute it, but tracing it takes effort. | Crossings; tangled fans leaving a node side; two runs so close they read as one |
| **3** | **Eye travel.** Perfectly clear, just further than necessary. | Extra turns; micro-jogs; a terminal setting off away from its target; long detours |
| **4** | **Polish.** | Attachment points closer together than the node side comfortably allows |

## The rule

A change is compared tier by tier, starting at 0. cairn compares the *set* of
defects, not how many there are:

- **Gained a defect at this tier?** Reject the change. No exceptions.
- **Only lost defects at this tier?** Accept it — and everything below this tier
  is fair payment.
- **Nothing changed at this tier?** Look at the next one down.

Two consequences worth stating plainly:

**Sets, not counts.** Comparing totals cannot see a defect *move*. Trading two
crossings on one pair of flows for one crossing somewhere previously clean makes
the total fall while the drawing gets worse in a place that used to be fine.
This bug was shipped twice before the comparison was changed to identity.

**Payment only ever flows downward.** Removing a crossing (tier 2) may cost
turns and jogs (tier 3). Removing a run through a component (tier 0) may cost
anything below it. But nothing at tier 2 can ever buy a tier 1 loss — a clearer
line is never worth a label you can't attribute.

## Where this happens in the pipeline

```
.cairn → lexer → parser → validator → scene-layout (elk)
       → route-detour → edge-tidy → label-anchor → compact
       → optimise-routes → svg-render → SVG
```

`optimiseRoutes` is the ladder-driven repair pass, and **it runs last on
purpose.** It enumerates candidate routes for a flow — four sides, three
attachment offsets per side, L-shaped and Z-shaped — scores each against the
whole drawing, and keeps the first the ladder accepts. Flows that share a node
are also tried in groups of up to four, because some problems don't yield one
flow at a time: two flows crossing on their way into the same database cannot be
fixed individually, since whichever moves first collides with the one that
hasn't.

Position is load-bearing and was learned the hard way. `compact` and
`label-anchor` reshape geometry, so a repair pass placed before them validates a
route that is *not* the one that gets drawn. Running the optimiser earlier cost
36 per-drawing regressions on a single fixture — including crossings the ladder
explicitly refuses to create.

The same reasoning explains one last step in the renderer. Moving a route can
cost a *neighbouring* flow its label seat: the label settler resolves the new
collision by lifting whichever label it can, and which one it picks doesn't
exist as a fact until settling has run. So the repair records what it replaced,
and after settling the drawing is checked — if it ended up with more labels off
their runs, the repair is rolled back. A tier 2 fix does not get to quietly buy
a tier 1 loss just because the cost lands on a different flow.

## How this is enforced

`npm run sweep` measures every fixture × every disposition and applies the same
ladder to the change as a whole, so the gate agrees with the router. A drawing
may get worse on a tier 3 metric if it improved on tier 0, 1 or 2 — that is a
trade, and the sweep reports it as one. A drawing that gets worse with nothing
better to show for it is a regression and fails the run.

Tier 0 has nothing above it, so nothing ever buys a tier 0 regression.

See [`INVARIANTS.md`](../INVARIANTS.md) §3 and §4 for the individual rules, and
[`tests/README.md`](../tests/README.md) for how the gates fit together.
