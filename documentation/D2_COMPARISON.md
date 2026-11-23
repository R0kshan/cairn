# cairn and D2

[D2](https://d2lang.com) and cairn are both diagram-as-code languages that
compile text to SVG, and both care about layout. If you already use D2, or are
choosing between the two, this page sets out where they differ and when each
one fits. It also tells the story of TALA, D2's architecture layout engine,
which was not free when cairn was started.

**In short:** D2 is a general-purpose diagramming language: architecture
diagrams, but also sequence diagrams, SQL tables, UML classes, grids, and
multi-board compositions, with a choice of three layout engines. cairn draws
three typed views that enterprise-architecture documents expect (logical,
application and infrastructure) and checks each one against that view's rules.

## What each one is

| | D2 | cairn |
|---|---|---|
| **Kind of thing** | A general-purpose diagram language with many shapes and special diagram types | A language for three typed architecture views |
| **Diagram types** | Architecture and flow diagrams, sequence diagrams, SQL tables, UML classes, grids; layers, scenarios and steps to compose several boards | [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical), [`application`](DSL_SPEC.md#12-application-view--diagram-application), [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) |
| **Layout engines** | dagre (default), ELK, and TALA, bundled since D2 v0.9.0 | ELK, with cairn's own passes on top |
| **Outputs** | SVG, PNG, PDF, PPTX, GIF, ASCII | SVG, plus a flow matrix in CSV, Markdown or SVG |
| **Styling** | Themes, dark mode, sketch mode, icons, Markdown and LaTeX labels | Themes, colour overrides per kind, logos, French or English chrome |
| **License** | MPL-2.0, D2 and TALA alike | Apache-2.0 |

## TALA, then and now

TALA (Terrastruct's AutoLayout Algorithm) is a layout engine that Terrastruct,
the company behind D2, built specifically for software architecture diagrams.
Until September 2026 it was proprietary:

- **Before September 2026,** TALA was closed-source and shipped as a separate
  install, kept apart from the open-source D2. Commercial use required a paid
  license. Without one, TALA was free to evaluate but rendered diagrams with a
  watermark. D2's own documentation listed "Not free" among TALA's cons.
- **On September 5, 2026,** D2 became a non-profit project, fiscally sponsored
  by Hack Club. Until then, the open-source language had been funded by two
  closed-source products, the D2 Studio IDE and TALA. The company was shutting
  down.
- **On September 7, 2026,** TALA was released as open source under D2's own
  license, MPL-2.0, and bundled into D2 v0.9.0. It is now selected like any
  other engine, with `--layout=tala`.

So today, TALA is free and open source.

## Why cairn was created

cairn started from architecture documents whose logical, application and
infrastructure views were drawn by hand in tools like draw.io. Moving them to
diagram as code had proven complicated, for two reasons. Other notations, such
as C4, made it hard to keep the level of information those views carry. And
with many flows and components, the diagrams the existing tools generated ended
up very large, or with overlapping flow labels, too hard to read to go into an
architecture document.

cairn's layout engine was chosen in July 2026, and TALA was evaluated then,
alongside dagre, Graphviz, Mermaid, PlantUML and a custom engine. TALA was
ruled out for four reasons:

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
space for labels during layout, with cairn's own passes on top. The full evaluation is in
[research/ALTERNATIVES.md](https://github.com/R0kshan/cairn/blob/main/documentation/research/ALTERNATIVES.md).

The first two reasons no longer apply: TALA is now open source and free. On
the third, TALA is reproducible when its seeds are fixed: given the same
seeds and the same input, it produces the same diagram. What remains is a
difference in design, described below.

## Where they differ

### Scope

D2 covers far more kinds of diagram, including several boards in one file and
animated exports. cairn draws three architecture views and nothing else: no
flowcharts, sequence or ER diagrams. In exchange, each cairn view knows what it
is describing, which is what the next two sections build on.

### Typed views and validation

D2 shapes are general: a box becomes a database or a person through its
`shape` and style. `d2 validate` checks a file for errors.

Each cairn view declares the element kinds it accepts, how they nest, and what
a flow must carry. A `server` must sit in a network zone, a site or a cluster,
a logical flow needs a label, and an infrastructure flow needs its protocol.
Breaking a rule gives a coded diagnostic that points at the source
([Diagnostics](DIAGNOSTICS.md)), with a JSON mode for CI.

### Layout

| | D2 with TALA | cairn |
|---|---|---|
| **Approach** | A general orthogonal layout engine, not limited to hierarchies or trees. It runs several layout attempts with different seeds and keeps the best | ELK's layered layout, with each view placing elements in fixed bands: in the logical view, actors, then the system, then externals; in infrastructure, sites and zones in declaration order |
| **Strengths it documents** | Prefers symmetry; first-class containers; `direction` per container; `near` relative to another shape; SQL-table connections that point at the exact row; label positioning that avoids obstructions | Label space reserved during layout; label overlaps measured on every build, and kept at zero across cairn's examples in CI; every flow its own arrow with its own label |
| **Same input** | The same diagram, for the same seeds | The same diagram, byte for byte |
| **Small edits** | Can cascade into an entirely different layout, as D2's documentation notes | The band order stays the same, so the overall arrangement follows the view's structure |
| **Dense views** | Orthogonal routing, including for connections between grid cells | Dispositions for wide, tall, a 16:9 slide or a portrait page, and numbered flows with a table under the canvas |

D2 also offers dagre and ELK, which are layered engines like the one cairn
builds on.

### Manual placement

Both keep manual placement in the source. With TALA, `top` and `left` lock a
shape's position in the `.d2` file, and positioned shapes can mix with ones
left to the engine. In cairn, the [positioning controls](DSL_SPEC.md#positioning-controls)
(`offset:`, `label-offset:`, `segment-offset:`, `ID.side`) are written by hand
or by dragging in the playground, which writes each move into the `.cairn`
file. Either way, the file alone carries the placement.

### Deliverables beyond the diagram

D2 exports to SVG, PNG, PDF, PowerPoint slides, animated GIFs and ASCII.

cairn produces what an architecture document needs next to the view: a
[flow matrix](DSL_SPEC.md#3-flow-matrix) per view in CSV, Markdown or SVG (the
*matrice des flux techniques* that French architecture dossiers require),
business objects on logical flows, an automatic legend, and French or English
headers through `style { lang: fr }`.

## Which to pick

**Choose D2 when:**

- you need many kinds of diagram (flows, sequences, data models, classes) in
  one language;
- you want several boards, scenarios or animated steps in one file;
- you want TALA's orthogonal, symmetric layout and its per-shape positioning;
- you need PNG, PDF, PowerPoint or GIF output directly from the CLI.

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
