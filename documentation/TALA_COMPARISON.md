# cairn and TALA

[TALA](https://d2lang.com/tour/tala/) is the layout engine that Terrastruct
built for software architecture diagrams written in [D2](https://d2lang.com).
cairn and TALA both set out to make architecture diagrams readable when they are
generated from text. This page explains why cairn was made at a time when TALA
was not free, and how the two differ today.

**In short:** TALA is a general-purpose layout engine for D2 diagrams. It
searches for an orthogonal, symmetric layout of whatever you describe. cairn
is a language and a layout for three typed views that enterprise-architecture
documents expect (logical, application and infrastructure), where each view
decides where its elements go and what they must carry.

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
| **Main goal** | A readable, orthogonal and symmetric layout for software architecture diagrams | Dense architecture views that stay readable and fit an architecture document |
| **Outputs** | Through D2: SVG, PNG, PDF, PPTX, GIF, ASCII | SVG, plus a flow matrix in CSV, Markdown or SVG |
| **License** | MPL-2.0, like D2 | Apache-2.0 |

## Where they differ

### How the layout is found

| | TALA | cairn |
|---|---|---|
| **Approach** | A general orthogonal layout engine, not limited to hierarchies or trees. It runs several layout attempts with different seeds and keeps the best | ELK's layered layout. Each view places elements in fixed bands: in the logical view, actors, then the system, then externals; in infrastructure, sites and zones in declaration order |
| **What decides placement** | The engine, from the graph you describe, guided by hints such as `direction` and `near` | The view, from the kind of each element, then the engine within each band |
| **Strengths it documents** | Prefers symmetry; first-class containers; `direction` per container; `near` relative to another shape; SQL-table connections that point at the exact row; label positioning that avoids obstructions | Label space reserved during layout; label overlaps measured on every build, and kept at zero across cairn's examples in CI; every flow its own arrow with its own label |
| **Same input** | The same diagram, for the same seeds | The same diagram, byte for byte |
| **Small edits** | Can cascade into an entirely different layout, as D2's documentation notes | The band order stays the same, so the overall arrangement follows the view's structure |
| **Dense views** | Orthogonal routing, including for connections between grid cells | Dispositions for wide, tall, a 16:9 slide or a portrait page, and numbered flows with a table under the canvas |

### What the layout knows about the diagram

TALA lays out what D2 describes, and D2 shapes are general: a box becomes a
database or a person through its `shape` and style, and `d2 validate` checks a
file for errors. That makes TALA usable for any architecture diagram, in any
notation you choose.

cairn's layout starts from typed views. Each view declares the element kinds it
accepts, how they nest, and what a flow must carry: a `server` must sit in a
network zone, a site or a cluster, a logical flow needs a label, and an
infrastructure flow needs its protocol. The layout uses those kinds to place
elements in their band, and breaking a rule gives a coded diagnostic that
points at the source ([Diagnostics](DIAGNOSTICS.md)), with a JSON mode for CI.

### Manual placement

Both keep manual placement in the source. With TALA, `top` and `left` lock a
shape's position in the `.d2` file, and positioned shapes can mix with ones
left to the engine. In cairn, the
[positioning controls](DSL_SPEC.md#positioning-controls) (`offset:`,
`label-offset:`, `segment-offset:`, `ID.side`) are written by hand or by
dragging in the playground, which writes each move into the `.cairn` file.
Either way, the file alone carries the placement.

### Deliverables beyond the diagram

Through D2, a TALA layout can be exported to SVG, PNG, PDF, PowerPoint slides,
animated GIFs and ASCII, and used across D2's layers, scenarios and steps.

cairn produces what an architecture document needs next to the view: a
[flow matrix](DSL_SPEC.md#3-flow-matrix) per view in CSV, Markdown or SVG (the
*matrice des flux techniques* that French architecture dossiers require),
business objects on logical flows, an automatic legend, and French or English
headers through `style { lang: fr }`.

## Which to pick

**Choose D2 with TALA when:**

- you want an orthogonal, symmetric layout for any kind of architecture diagram;
- you want to choose your own notation, shapes and styles;
- you want per-shape positioning mixed with automatic layout;
- you want D2's other diagram types, compositions and export formats too.

**Choose cairn when:**

- your document needs logical, application and infrastructure views, as French
  SAD templates and enterprise-architecture methods expect;
- your views carry many flows and labelled exchanges on one page;
- you need a flow matrix delivered with each view;
- you want the view's rules (valid nesting, mandatory labels and protocols)
  checked in CI.

## Sources

- [TALA is open-source](https://d2lang.com/blog/tala-is-open-source/), D2 blog, September 7, 2026
- [D2's non-profit announcement](https://d2lang.com/blog/d2-non-profit/), D2 blog, September 5, 2026
- [TALA](https://d2lang.com/tour/tala/) and [Layout engines](https://d2lang.com/tour/layouts/), D2 documentation
- [TALA repository](https://github.com/terrastruct/TALA), for the licensing terms before open-sourcing
- [Layout engine evaluation](https://github.com/R0kshan/cairn/blob/main/documentation/research/ALTERNATIVES.md), cairn, July 2026
