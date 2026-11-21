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
| **Kind of thing** | A notation-independent model with a set of diagram types. Several tools implement it: Structurizr, LikeC4, C4-PlantUML, Mermaid's C4 diagrams. | One DSL and one renderer: a CLI, a browser playground and an embeddable `compile()`. |
| **Core abstractions** | Person, software system, container, component, plus code | Kinds typed per view: actors, functional blocks, applications, modules, queues, datastores, sites, network zones, servers, clusters, firewalls… |
| **Views** | System context, container, component, code; also system landscape, dynamic and deployment | [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical), [`application`](DSL_SPEC.md#12-application-view--diagram-application), [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) |
| **Source of truth** | In model-based tools (Structurizr, LikeC4), one model that every view is derived from | One `.cairn` file per diagram. There are no imports across files ([by design](DSL_SPEC.md#5-not-in-the-language)). |
| **Main goal** | A shared vocabulary for software structure, at the right level of abstraction for each audience | Dense views that stay readable (no overlapping labels, deterministic layout) and that fit an architecture document |

## Mapping the concepts

C4's abstractions line up with cairn's kinds fairly directly at the application
and deployment level:

| C4 | cairn | View |
|---|---|---|
| Person | `actor`, grouped in an `actor-group` | logical, application (in infrastructure, `actor` sits at the root) |
| Software system (in scope) | `system` | logical, application |
| Software system (external) | `external` | all three |
| Container (an app or service) | `application` | application |
| Container (a database) | `datastore` | application, infrastructure |
| Container (a message broker) | `queue` | application, infrastructure |
| Component | `module`, inside an `application` | application |
| Relationship: description + technology | flow: label + `(PROTOCOL, FORMAT)` tail | application |
| Relationship in a deployment diagram | flow: label + `(PROTOCOL/PORT)` | infrastructure |
| Deployment node | `site`, `network-zone`, `server`, `cluster`, `device` | infrastructure |
| Container instance | `app-instance` | infrastructure |
| Infrastructure node | `load-balancer`, `firewall`, `gateway` | infrastructure |
| Code (classes, …) | — not covered | — |
| Dynamic diagram | — not covered | — |

Some cairn kinds have no direct C4 counterpart:

- **The logical view as a whole.** It describes what the system *does*:
  functional `layer`s and `block`s, the business objects carried by flows, and
  `security` capabilities such as strong authentication or anonymisation, with no
  technology anywhere. C4's abstractions describe the static structure of
  software (systems, containers, components), not its functions. Its system
  context diagram is the closest thing, but it stops at the system boundary.
- **Typed infrastructure.** `gateway`, `auth`, `idp`, `load-balancer`, `firewall`
  and `cluster` are their own kinds, each with its own glyph and nesting rules.
  C4's deployment diagrams have two generic kinds, deployment nodes and
  infrastructure nodes, told apart by their technology or tags. LikeC4 lets you
  define your own element kinds; in cairn the kinds are fixed per view, and the
  compiler enforces where each one may sit.

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

C4 tools use a general-purpose layout engine (Graphviz or Dagre in Structurizr,
Graphviz in LikeC4 and C4-PlantUML), and Structurizr's diagram editor also
supports manual placement. That leaves you free to arrange any diagram the way
you want.

cairn's layout is specialised for dense architecture views. Every build measures
label overlaps, and CI keeps them at zero across all the examples. Every flow
stays its own arrow with its own label, and the output is deterministic, so a
small edit doesn't reshuffle the picture. When the automatic layout still gets
something wrong, the [positioning controls](DSL_SPEC.md#positioning-controls)
and the playground's drag-to-adjust write the fix back into the source.

### Validation

C4 is about abstractions and leaves rules to the tooling. Structurizr checks
syntax and references, and runs inspections: configurable checks such as an
element with no description or a relationship with no technology. LikeC4
checks the model against the element kinds you declare.

cairn types every view: each one declares which element kinds it accepts, how
they nest, and what a flow must carry. An application flow between non-actors
with no technology tail warns ([W0540](DIAGNOSTICS.md)), and an infrastructure
flow with no protocol is an error ([E0240](DIAGNOSTICS.md)). Each diagnostic is
coded and points at the source, and `cairn explain <code>` gives the reason
behind it. See [Diagnostics](DIAGNOSTICS.md).

### Deliverables beyond the diagram

Every cairn view exports a [flow matrix](DSL_SPEC.md#3-flow-matrix) (CSV,
Markdown or SVG): one row per flow, endpoints annotated with their zone or
application. This is the *matrice des flux techniques* that French
enterprise-architecture dossiers require, and it can be localised with
`style { lang: fr }`. Structurizr and LikeC4 export diagrams (PlantUML,
Mermaid, DOT, D2…) and the model itself, but no flow table: you would script
one from the model.

### Scope

C4 covers more ground: the code level, dynamic diagrams, a system landscape
spanning an entire enterprise, and, in Structurizr, documentation and
architecture decision records kept with the model. cairn covers three views and
stops there. It has no shared model, no cross-file imports and no sequence or
dynamic view.

## Which to pick

**Choose C4 (with Structurizr, LikeC4, …) when:**

- you want one model with many derived views, kept consistent by the tool;
- your audience thinks in system → container → component zoom levels;
- you need dynamic or code-level diagrams, or a landscape across many systems;
- you want documentation and decisions kept next to the model.

**Choose cairn when:**

- your document follows the logical / application / infrastructure structure
  that enterprise-architecture methods and French SAD templates use;
- your views carry many flows and labelled exchanges on one page;
- you need a flow matrix delivered with each view;
- you want the view's rules (mandatory labels, mandatory protocols, valid
  nesting) checked in CI.

They also work side by side: C4 for the software-structure model a team
maintains, and cairn for the views a formal architecture document needs.
