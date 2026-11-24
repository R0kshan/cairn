# cairn and TALA

[TALA](https://d2lang.com/tour/tala/) is the layout engine that Terrastruct
built for software architecture diagrams written in [D2](https://d2lang.com).
cairn and TALA both set out to make architecture diagrams readable when they are
generated from text. This page explains why cairn was made at a time when TALA
was not free, and how the two differ today.

**In short:** TALA is a general-purpose layout engine for D2 diagrams. It
searches for an orthogonal, symmetric layout of whatever you describe. cairn
is built for one job: the three views an architecture document needs
(logical, application and infrastructure), kept easy to maintain as the
architecture changes. Each view knows what it describes, checks it, and
produces what the document needs next to the diagram.

## TALA, then and now

- **Until September 2026,** TALA was proprietary. It was closed-source and
  shipped as a separate install, kept apart from the open-source D2. Commercial
  use required a paid license; without one, TALA was free to evaluate but
  rendered diagrams with a watermark. D2's own documentation listed "Not free"
  among TALA's cons.
- **On September 5, 2026,** D2 became a non-profit project, fiscally sponsored
  by Hack Club. Until then, the open-source language had been funded by two
  closed-source products, the D2 Studio IDE and TALA. The company was shutting
  down.
- **On September 7, 2026,** TALA was released as open source under D2's own
  license, MPL-2.0, and bundled into D2 v0.9.0. It is now selected like any
  other D2 layout engine, with `--layout=tala`.

## Why cairn was made

cairn started from architecture documents whose logical, application and
infrastructure views were drawn by hand in tools like draw.io. Moving them to
diagram as code had proven complicated, for two reasons. Other notations, such
as C4, made it hard to keep the level of information those views carry. And
with many flows and components, the diagrams the existing tools generated ended
up very large, or with overlapping flow labels, too hard to read to go into an
architecture document.

The layout engine was central to the second problem, and cairn's was chosen in
July 2026. TALA was evaluated then, alongside dagre, Graphviz, Mermaid, PlantUML and
a custom engine, and was ruled out for four reasons:

1. **Closed source:** it could not be modified, and cairn's main promise runs
   through the layout engine.
2. **Paid license:** commercial use required one.
3. **Randomness by design:** D2's documentation describes TALA as having
   randomness, where a small change to a label can cascade into an entirely
   different layout. cairn requires the same output for the same input.
4. **No extension path:** if it did not produce the layout cairn needs
   (semantic bands, zero overlaps, deterministic output), there was no way to
   change it.

cairn chose ELK instead: its partitions provide the bands, and it reserves
space for labels during layout, with cairn's own passes on top. The full
evaluation is in
[research/ALTERNATIVES.md](https://github.com/R0kshan/cairn/blob/main/documentation/research/ALTERNATIVES.md).

The first two reasons no longer apply: TALA is now open source and free. On the
third, TALA is reproducible when its seeds are fixed: given the same seeds and
the same input, it produces the same diagram. What remains are differences of
design, set out below.

## What each one is

| | TALA | cairn |
|---|---|---|
| **Kind of thing** | A layout engine, one of three in D2 alongside dagre and ELK | A language and its renderer, built on ELK |
| **Input** | Any D2 diagram: boxes, containers and connections whose meaning comes from their labels, shapes and styles | One of three typed views: [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical), [`application`](DSL_SPEC.md#12-application-view--diagram-application), [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) |
| **Main goal** | A readable, orthogonal and symmetric layout for software architecture diagrams | Architecture documents that stay easy to maintain: three typed views, readable when dense, each with its flow matrix |
| **Outputs** | Through D2: SVG, PNG, PDF, PPTX, GIF, ASCII | SVG, plus a flow matrix in CSV, Markdown or SVG |
| **License** | MPL-2.0, like D2 | Apache-2.0 |

## Where they differ

### Three architecture views, not a general diagram

TALA lays out whatever D2 describes, and D2 shapes are general: a box becomes a
database or a person through its `shape` and style. You choose the notation,
and TALA works for any architecture diagram.

cairn starts from the three views of an architecture document, the
*architecture logique*, *applicative* and *physique* of French dossiers. Each
one answers its own question, accepts its own element kinds, and checks what
its flows carry:

| View | Answers | Describes with | Checks |
|---|---|---|---|
| [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical) | What the system does, for whom, with which data | Actors, functional layers and blocks, security capabilities, business objects on flows; no technology | Every flow has a label; blocks sit in a layer, a system or an external |
| [`application`](DSL_SPEC.md#12-application-view--diagram-application) | Which applications exist and how they exchange | Applications and their modules, gateways, identity providers, queues, datastores, externals; protocol and format on flows | Modules sit in their application; business objects stay in the logical view |
| [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) | Where it runs and what crosses which boundary | Sites, network zones, servers, clusters, deployed instances, load balancers, firewalls; protocol and port on flows | Every flow has its protocol; servers sit in a zone, site or cluster |

The layout uses those kinds too: each view places elements in its own bands,
so actors, the system and externals, or the sites and network zones, always
read in the same order. Breaking a rule gives a coded diagnostic that points at the source
([Diagnostics](DIAGNOSTICS.md)).

### Built to maintain architecture documents

An architecture document lives as long as the system it describes. cairn is
designed so that keeping its views up to date stays cheap:

- **The source is reviewable text.** A view is a `.cairn` file you version and
  review like code. The same input always gives the same SVG, byte for byte,
  so rebuilding an unchanged view changes nothing, and a diff shows only real
  changes.
- **Mistakes are caught at each edit.** `cairn validate --strict` checks every
  view against its rules, in an editor, a pre-commit hook or CI. With
  `--format json`, each problem comes with a code, a position, a hint and,
  when the fix is certain, an edit that can be applied as given; `cairn explain
  <code>` gives the reason behind it. That also suits AI agents writing views
  with the [cairn skill](AI_AGENTS.md).
- **What goes next to the diagram comes from the same file.** The
  [flow matrix](DSL_SPEC.md#3-flow-matrix) (the *matrice des flux techniques*
  French dossiers require) is generated from the view in CSV, Markdown or SVG,
  so it can't drift from the diagram. So are the legend and the business
  objects, and `style { lang: fr }` gives French or English headers.
- **The view fits the page it goes on.** `style { disposition: slide }` or
  `{ disposition: page }` sizes a view for a 16:9 slide or an A4 page, and the
  build reports the scale it reaches and the resulting label size. When labels
  would fall below about 7 px, W0520 says the view carries more than the page
  can show and should be split.
- **Adjustments survive edits.** Manual placement is a delta from where the
  layout put an element, so it keeps working when the rest of the view
  changes (see below), and cairn keeps checking the adjusted view.

### How the layout is found

| | TALA | cairn |
|---|---|---|
| **Approach** | A general orthogonal layout engine, not limited to hierarchies or trees. It runs several layout attempts with different seeds and keeps the best | ELK's layered layout, with the view's bands: in the logical view, actors, then the system, then externals; in infrastructure, sites and zones in declaration order |
| **What decides placement** | The engine, from the graph you describe, guided by hints such as `direction` and `near` | The view, from the kind of each element, then the engine within each band |
| **Strengths it documents** | Prefers symmetry; first-class containers; `direction` per container; `near` relative to another shape; SQL-table connections that point at the exact row; label positioning that avoids obstructions | Label space reserved during layout; label overlaps measured on every build; every flow its own arrow with its own label |
| **Same input** | The same diagram, for the same seeds | The same diagram, byte for byte |
| **Small edits** | Can cascade into an entirely different layout, as D2's documentation notes | The band order stays the same, so the overall arrangement follows the view's structure |
| **Dense views** | Orthogonal routing, including for connections between grid cells | Numbered flows with a table under the canvas, and dispositions for wide, tall, slide or page |

cairn's own CI keeps label overlaps at zero across all its examples, and scores
every example on further readability metrics (crossings, labels pierced by a
line, container titles struck, lines through unrelated containers…). It fails
when any drawing gets worse than its recorded baseline; the metrics are
described in [READABILITY_METRICS.md](https://github.com/R0kshan/cairn/blob/main/documentation/READABILITY_METRICS.md).

### Manual placement

Both keep manual placement in the source, so the file alone carries it. They
make different choices about what a placement means:

| | TALA | cairn |
|---|---|---|
| **What a placement is** | An absolute position: `top` and `left` lock a shape at exact coordinates, and locked shapes mix with ones left to the engine | A delta from where the layout put the element: the layout still runs, and the element keeps its place in the reading order, so the nudge survives edits that re-flow the view |
| **What you can place** | Shapes, locked with `top` and `left`, or placed relative to another shape with `near` | Elements (`offset:`), flow labels (`label-offset:`), one straight run of a route (`segment-offset:`), the side a flow attaches to (`ID.side`), and container sizes (`size:`) |
| **How you place it** | Writing `top` and `left` in the `.d2` file | Writing the [positioning controls](DSL_SPEC.md#positioning-controls) by hand, or dragging in the playground, which writes each move into the `.cairn` file |

An absolute lock gives exact control over a shape; a delta keeps working when
the rest of the view changes. cairn also keeps checking a hand-adjusted view:
a hint that creates an overlap is honoured but warns (W0572), a side pin the
layout could not honour warns (W0570), and an offset that would push an element
out of its container is cut short so the nesting stays true (W0573).

## Which to pick

**Choose D2 with TALA when:**

- you want an orthogonal, symmetric layout for any kind of architecture diagram;
- you want to choose your own notation, shapes and styles;
- you want per-shape positioning mixed with automatic layout;
- you want D2's other diagram types, compositions and export formats too.

**Choose cairn when:**

- your document needs logical, application and infrastructure views, as French
  SAD templates and enterprise-architecture methods expect;
- you maintain that document over time, and want its views reviewed, checked
  and rebuilt like code;
- you need a flow matrix that stays in step with each view;
- your views carry many flows and labelled exchanges on one page.

## Sources

- [TALA is open-source](https://d2lang.com/blog/tala-is-open-source/), D2 blog, September 7, 2026
- [D2's non-profit announcement](https://d2lang.com/blog/d2-non-profit/), D2 blog, September 5, 2026
- [TALA](https://d2lang.com/tour/tala/) and [Layout engines](https://d2lang.com/tour/layouts/), D2 documentation
- [TALA repository](https://github.com/terrastruct/TALA), for the licensing terms before open-sourcing
- [Layout engine evaluation](https://github.com/R0kshan/cairn/blob/main/documentation/research/ALTERNATIVES.md), cairn, July 2026
