# cairn and C4

[C4](https://c4model.com) and cairn both describe software architecture as a set
of views, and both are often written as code. If you already use C4, or are
thinking about it, this page maps one onto the other, sets out where they
differ, and says when each one fits.

**In short:** C4 is a way of *modelling* software structure at several zoom
levels, and you pick the tool that draws it. cairn is a *drawing* tool for three
views that enterprise-architecture documents expect: logical, application and
infrastructure. The two overlap at the application and deployment level, and
make different choices everywhere else.

## What each one is

| | C4 | cairn |
|---|---|---|
| **Kind** | A notation-independent model with a set of diagram types. Several tools implement it: Structurizr, LikeC4, C4-PlantUML, Mermaid's C4 diagrams. | One DSL and one renderer: a CLI, a browser playground and an embeddable `compile()`. |
| **Core abstractions** | Person, software system, container, component, plus code | Kinds typed per view: actors, functional blocks, applications, modules, queues, datastores, sites, network zones, servers, clusters, firewalls… |
| **Views** | System context, container, component, code; also system landscape, dynamic and deployment | [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical), [`application`](DSL_SPEC.md#12-application-view--diagram-application), [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) |
| **Source of truth** | In model-based tools (Structurizr, LikeC4), one model that every view is derived from | One `.cairn` file per diagram. There are no imports across files. |
| **Main goal** | A shared vocabulary for software structure, at the right level of abstraction for each audience | Dense views that stay readable (automatic layout keeps labels from overlapping, deterministic output) and that fit an architecture document |
| **Validation** | Syntax, references, and configurable completeness checks (Structurizr inspections, LikeC4 element kinds) | Rules set by each view type: a logical flow needs a label, an infrastructure flow needs a protocol, nesting is checked per view |

## Where they differ

| | C4 tools | cairn |
|---|---|---|
| **Model and files** | In Structurizr or LikeC4, the system is described once and every view is derived from it, so a renamed container changes everywhere at once | Each view is its own file, complete on its own and read top to bottom; you keep the logical, application and infrastructure views consistent yourself |
| **Levels of detail** | One diagram per zoom level: a container's components appear in its component diagram | Nested in the same diagram: modules inside their application, zones, servers and instances inside one another; more on one page, with a layout built to keep it readable |
| **Automatic layout** | A general-purpose engine: Graphviz or Dagre in Structurizr, Graphviz in LikeC4 and C4-PlantUML | Specialised for dense architecture views |
| **Spacing** | Fixed gaps between elements, adjusted by hand per view | Unused space is reclaimed after layout, without making the diagram harder to read |
| **Manual placement** | In Structurizr's diagram editor, free to arrange any diagram the way you want | With the [positioning controls](DSL_SPEC.md#positioning-controls), or by dragging in the playground |
| **Where manual positions live** | Outside the DSL, in a JSON version of the workspace, matched back to elements by name each time the DSL loads | In the DSL itself, as hints: `offset:`, `label-offset:`, `segment-offset:`, `ID.side` |
| **What the source alone gives you** | A DSL free of layout details; the placement comes from the workspace JSON kept alongside it | The whole diagram, placement included: the `.cairn` file renders the same way in the playground, the CLI or CI, with no separate layout file. Logos read from a file and custom themes are the exception: the CLI resolves them, the playground does not |
| **Deliverables beyond the diagram** | Diagram exports (PlantUML, Mermaid, DOT, D2…) and the model itself; a flow table has to be scripted from the model | A [flow matrix](DSL_SPEC.md#3-flow-matrix) for every view (CSV, Markdown or SVG): one row per flow, endpoints annotated with their zone or application |

On top of that, every cairn build:

- measures label overlaps, and CI keeps them at zero across all the examples;
- keeps every flow as its own arrow with its own label;
- produces deterministic output, the same DSL always produces the same diagram with the exact same positionning.

## Which to pick

**Choose C4 (with Structurizr, LikeC4, …) when:**

- you want one model with many derived views, kept consistent by the tool;
- your audience thinks in system → container → component zoom levels;
- you need dynamic or code-level diagrams, or a landscape across many systems;
- you want documentation and decisions kept next to the model.

**Choose cairn when:**

- your document follows the logical / application / infrastructure structure
  that enterprise-architecture methods and French SAD templates use;
- your views carry many flows and labelled exchanges on one page, with the
  option to number them and list the full labels in a legend
  (`flow-text: numbered`);
- your document is in French: `lang: fr` translates the legend, band titles
  and flow-matrix headers;
- you need a flow matrix delivered with each view.

They also work side by side: C4 for the software-structure model a team
maintains, and cairn for the views a formal architecture document needs.
