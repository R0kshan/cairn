# [Cairn](https://github.com/R0kshan/cairn) and C4

This page presents the key differences between [C4](https://c4model.com) and [Cairn](https://github.com/R0kshan/cairn) so you can decide which tool best fits your needs.

> The C4 claims on this page come from the public documentation of the C4 tools. If one is inaccurate, corrections are welcome: open an [issue](https://github.com/R0kshan/cairn/issues) or a pull request.

**In short:** 
- C4 is a way of *modelling* software structure at several zoom levels, and you pick the tool that draws it. 
- [Cairn](https://github.com/R0kshan/cairn) is a diagram language for the three views that enterprise-architecture documents expect: logical, application and infrastructure, with rules checked per view and a flow matrix delivered with each one.

The two overlap at the application and deployment level, and make different choices everywhere else.

## What each one is

| | C4 | [Cairn](https://github.com/R0kshan/cairn) |
|---|---|---|
| **Kind** | A notation-independent model with a set of diagram types. Several tools implement it: Structurizr, LikeC4, C4-PlantUML, Mermaid's C4 diagrams. | One DSL and one renderer: a CLI, a browser playground and an embeddable `compile()`. |
| **Core abstractions** | Person, software system, container, component | Kinds typed per view: actors, functional blocks, applications, modules, queues, datastores, sites, network zones, servers, clusters, firewalls… |
| **Views** | System context, container, component, code; also system landscape, dynamic and deployment | [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical), [`application`](DSL_SPEC.md#12-application-view--diagram-application), [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) |
| **Source of truth** | In model-based tools (Structurizr, LikeC4), one model that every view is derived from | One `.cairn` file per diagram. There are no imports across files. |
| **Main goal** | A shared vocabulary for software structure, at the right level of abstraction for each audience | Dense views that stay readable (automatic layout keeps labels from overlapping, deterministic output) and that fit an architecture document |
| **Validation** | Syntax, references, and configurable completeness checks (Structurizr inspections, LikeC4 element kinds) | Rules set by each view type: a logical flow needs a label, an infrastructure flow needs a protocol, nesting is checked per view |

## Where they differ

| | C4 tools | [Cairn](https://github.com/R0kshan/cairn) |
|---|---|---|
| **Model and files** | In Structurizr or LikeC4, the system is described once and every view is derived from it, so a renamed container changes everywhere at once | Each view is its own file, complete on its own and read top to bottom; you keep the logical, application and infrastructure views consistent yourself |
| **Levels of detail** | One diagram per zoom level: a container's components appear in its component diagram | Nested in the same diagram: modules inside their application, zones, servers and instances inside one another; more on one page, with a layout built to keep it readable |
| **Automatic layout** | A general-purpose engine: Graphviz or Dagre in Structurizr, Graphviz in LikeC4 and C4-PlantUML | A general-purpose engine too, [ELK](https://github.com/kieler/elkjs), followed by Cairn's own passes for dense architecture views: label overlaps removed, unused space reclaimed |
| **Spacing** | Fixed gaps between elements, adjusted by hand per view | Unused space is reclaimed after layout, without making the diagram harder to read |
| **Manual placement** | In Structurizr, any diagram can be arranged freely in its diagram editor. The positions are saved outside the DSL, in a JSON version of the workspace kept alongside it, and matched back to elements by name each time the DSL loads, so the DSL itself stays free of layout details | In the DSL itself, with the [positioning controls](DSL_SPEC.md#positioning-controls) (`offset:`, `label-offset:`, `segment-offset:`, `ID.side`), or by dragging in the playground, which writes every drag back as one of those controls. The `.cairn` file alone is the whole diagram, placement included: a diagram adjusted by hand renders the same way every time, in the playground, the CLI or CI, with no separate layout file. Logos read from a file and custom themes are the exception: the CLI resolves them, the playground does not |
| **Deliverables beyond the diagram** | Diagram exports (PlantUML, Mermaid, DOT, D2…) and the model itself; a flow table has to be scripted from the model | A [flow matrix](DSL_SPEC.md#3-flow-matrix) for every view (CSV, Markdown or SVG): one row per flow, endpoints annotated with their zone or application |

On top of that, every [Cairn](https://github.com/R0kshan/cairn) build:

- reports the number of label overlaps left (Cairn's own CI keeps it at zero across all its examples);
- keeps every flow as its own arrow with its own label;
- produces deterministic output: the same DSL always produces the same diagram, with exactly the same positioning.

Label overlaps are one of several [readability metrics](FEATURES.md#readability-metrics) that Cairn's own CI enforces. Every change to Cairn is measured against them, so a new feature either makes diagrams more readable or at least does not make them less readable.

## When to use Cairn

Cairn fits best when:

- your document follows the logical / application / infrastructure structure that enterprise-architecture methods and French Software Architecture Document templates use;
- your views carry many flows and labelled exchanges on one page, with the option to number them and list the full labels in a legend (`flow-text: numbered`);
- your document is in French: `lang: fr` translates the legend, band titles and flow-matrix headers;
- you need a flow matrix delivered with each view;
- you build diagrams in CI and review them in pull requests: the output is deterministic, so a diff shows only what changed, and the `.cairn` file alone carries the whole diagram, placement included.

The [features page](FEATURES.md) lists everything Cairn offers.

Cairn and C4 can also work side by side: C4 for the software-structure model a team maintains, and [Cairn](https://github.com/R0kshan/cairn) for the views a formal architecture document needs.
