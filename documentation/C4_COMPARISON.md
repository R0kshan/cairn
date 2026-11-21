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
| **Main goal** | A shared vocabulary for software structure, at the right level of abstraction for each audience | Dense views that stay readable (no overlapping labels, deterministic layout) and that fit an architecture document |

## Where they differ

### One model or one file per view

In Structurizr or LikeC4, you describe the system once and derive every view
from that model, so a renamed container changes in every view at once. In
cairn, each view is its own file: you keep the logical, application and
infrastructure views of the same system consistent yourself. In exchange, each
file is complete on its own and reads top to bottom.

### Zoom levels or containment

C4 gives each level of detail its own diagram: a container's components appear
in its component diagram. cairn draws modules inside their application in the
same diagram, and zones, servers and instances inside one another in the
infrastructure view. C4 keeps each diagram focused on one level; cairn puts more
on one page, and its layout is built to keep that readable.

### Layout and readability

| | C4 tools | cairn |
|---|---|---|
| **Automatic layout** | A general-purpose engine: Graphviz or Dagre in Structurizr, Graphviz in LikeC4 and C4-PlantUML | Specialised for dense architecture views |
| **Spacing** | Fixed gaps between elements, adjusted by hand per view | Unused space is reclaimed after layout, without making the diagram harder to read |
| **Manual placement** | In Structurizr's diagram editor, free to arrange any diagram the way you want | With the [positioning controls](DSL_SPEC.md#positioning-controls), or by dragging in the playground |
| **Where manual positions live** | Outside the DSL, in a JSON version of the workspace, matched back to elements by name each time the DSL loads | In the DSL itself, as hints: `offset:`, `label-offset:`, `segment-offset:`, `ID.side` |
| **What the source alone gives you** | A DSL free of layout details; the placement comes from the workspace JSON kept alongside it | The whole diagram, placement included: the `.cairn` file renders the same way in the playground, the CLI or CI, with no separate layout file |

On top of that, every cairn build:

- measures label overlaps, and CI keeps them at zero across all the examples;
- keeps every flow as its own arrow with its own label;
- produces deterministic output, the same DSL always produces the same diagram with the exact same positionning.

### Validation

C4 is about abstractions and leaves rules to the tooling. Structurizr checks
syntax and references, and runs inspections: configurable checks such as an
element with no description or a relationship with no technology. LikeC4
checks the model against the element kinds you declare.

cairn types every view: each one declares which element kinds it accepts, how
they nest, and what a flow must carry: a logical flow needs a label
([E0203](DIAGNOSTICS.md)), and an infrastructure flow needs its protocol
([E0240](DIAGNOSTICS.md)). Each diagnostic is
coded and points at the source, and `cairn explain <code>` gives the reason
behind it. See [Diagnostics](DIAGNOSTICS.md).

### Deliverables beyond the diagram

Every cairn view exports a [flow matrix](DSL_SPEC.md#3-flow-matrix) (CSV,
Markdown or SVG): one row per flow, endpoints annotated with their zone or
application. Structurizr and LikeC4 export diagrams (PlantUML,
Mermaid, DOT, D2…) and the model itself, but no flow table: you would script
one from the model.

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
- you need a flow matrix delivered with each view;
- you want the view's rules (mandatory labels, mandatory protocols, valid
  nesting) checked in CI.

They also work side by side: C4 for the software-structure model a team
maintains, and cairn for the views a formal architecture document needs.
