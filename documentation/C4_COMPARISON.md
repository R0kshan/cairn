# cairn and C4

[C4](https://c4model.com) and cairn both describe software architecture as a set
of views, and both are often written as code. This raises a fair question: if you
already use C4, or are thinking about it, where does cairn fit? This page maps one
onto the other, lists where they differ, and says when to pick each.

**In short:** C4 is a way of *modelling* software structure at four zoom levels,
and you pick the tool that draws it. cairn is a *drawing* tool for three views
that enterprise-architecture documents expect: logical, application and
infrastructure. It cares most about keeping dense diagrams readable and about
producing the flow matrix that comes with them. The two overlap at the
application and deployment level and differ everywhere else.

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
| Relationship: description + technology | flow: label + `(protocol, format)` tail | application |
| Deployment node | `site`, `network-zone`, `server`, `cluster` | infrastructure |
| Container instance | `app-instance` | infrastructure |
| Infrastructure node | `load-balancer`, `firewall`, `gateway`, `device` | infrastructure |
| Code (classes, …) | — not covered | — |
| Dynamic diagram | — not covered | — |

Some cairn kinds have no direct C4 counterpart:

- **The logical view as a whole.** It describes what the system *does*:
  functional `layer`s and `block`s, the business objects carried by flows, and
  `security` capabilities such as strong authentication or anonymisation, with no
  technology anywhere. C4 deliberately doesn't do functional decomposition. Its
  system context diagram is the closest thing, but it stops at the system
  boundary.
- **Typed infrastructure.** `gateway`, `auth`, `idp`, `load-balancer`, `firewall`
  and `cluster` are their own kinds, each with its own glyph and nesting rules.
  C4 represents all of them with one generic element, told apart by a tag or a
  technology string.

## Side by side

Here is the same order platform: in Structurizr DSL as a C4 container view, and
in cairn as an application view.

```text
workspace {
  model {
    clerk = person "Order clerk"
    orders = softwareSystem "Order platform" {
      app = container "Order management" "" "Spring Boot" {
        capture  = component "Order capture"
        validate = component "Order validation"
      }
      events = container "Order event bus" "" "Kafka" { tags "Queue" }
      db     = container "Order repository" "" "PostgreSQL" { tags "Database" }
    }
    carrier = softwareSystem "Carrier tracking" { tags "External" }

    clerk    -> capture  "Captures orders"
    capture  -> validate "Validates" "REST/JSON"
    validate -> db       "Reads/writes" "JDBC"
    validate -> events   "Publishes" "MQ/JSON"
    events   -> carrier  "Forwards" "SFTP/CSV"
  }
  views {
    container orders { include * autolayout lr }
    component app    { include * autolayout lr }
  }
}
```

```cairn
diagram application "Order platform — application view"

actor-group SALES "Sales actors" {
  actor CLERK "Order clerk"
}

system ORDERS "Order platform" {
  application ORDER_APP "Order management" { logo: spring
    module CAPTURE "Order\ncapture"
    module VALIDATE "Order\nvalidation"
  }
  queue EVENTS "Order event\nbus" { logo: apachekafka }
  datastore ORDER_DB "Order\nrepository" { logo: postgresql }
}

external CARRIER "Carrier tracking"

CLERK    -> CAPTURE "Captures orders"
CAPTURE  -> VALIDATE (API_REST, JSON)
VALIDATE -> ORDER_DB (JDBC)
VALIDATE -> EVENTS (MQ, JSON)
EVENTS   -> CARRIER (SFTP, CSV)
```

What the comparison shows:

- **One model, several views, versus one view per file.** Structurizr derives
  both the container view and the component view from a single model. In cairn,
  the application view shows applications and their modules in one drawing. The
  logical and infrastructure views of the same system are separate files that
  you keep consistent yourself.
- **Containment is the zoom.** C4 hides a container's components until you open
  the component view. cairn draws modules inside their application in the same
  diagram, so the diagram has to stay dense and readable at once, and the layout
  is built for that.
- **The technology is checked.** Both carry it on relationships, but cairn
  validates it per view: an application flow between non-actors with no tail
  warns ([W0540](DIAGNOSTICS.md)), and an infrastructure flow with no protocol is
  an error ([E0240](DIAGNOSTICS.md)).

## Where they differ

### Layout and readability

C4 tools usually leave layout to a general-purpose engine (Graphviz or dagre,
depending on the tool), or to manual placement. With many flows, this is where
diagrams become hard to read: labels overlap, and parallel arrows merge.
cairn is built around this problem. Label space is reserved during layout,
overlaps are measured on every build and kept at zero in CI, every flow stays its
own arrow with its own label, and the output is deterministic, so a small edit
doesn't reshuffle the picture. When the automatic layout still gets something
wrong, the [positioning controls](DSL_SPEC.md#positioning-controls) and the
playground's drag-to-adjust write the fix back into the source.

### Validation

C4 is about abstractions and leaves rules to the tooling, which mostly checks
syntax and references. cairn types every view: each one declares which element
kinds it accepts, how they nest, and what a flow must carry. Breaking a rule
produces a source-located, coded diagnostic, and `cairn explain <code>` gives the
reason behind it. See [Diagnostics](DIAGNOSTICS.md).

### Deliverables beyond the diagram

Every cairn view exports a [flow matrix](DSL_SPEC.md#3-flow-matrix) (CSV,
Markdown or SVG): one row per flow, endpoints annotated with their zone or
application. This is the *matrice des flux techniques* that French
enterprise-architecture dossiers require, and it can be localised with
`style { lang: fr }`. C4 tools have nothing equivalent built in.

### Scope

C4 covers more ground: the code level, dynamic diagrams, a system landscape
spanning an entire enterprise, and model-wide queries and documentation in
Structurizr. cairn covers three views and stops there. It has no shared model, no
cross-file imports and no sequence or dynamic view.

## Which to pick

**Choose C4 (with Structurizr, LikeC4, …) when:**

- you want one model with many derived views, kept consistent by the tool;
- your audience thinks in system → container → component zoom levels;
- you need dynamic or code-level diagrams, or a landscape across many systems;
- your diagrams are moderately dense and the default layout reads well.

**Choose cairn when:**

- your document follows the logical / application / infrastructure structure
  that enterprise-architecture methods and French SAD templates use;
- your diagrams have many flows and labelled exchanges, and readability is
  what breaks first;
- you need a flow matrix delivered with each view;
- you want the view's rules (mandatory labels, mandatory protocols, valid
  nesting) checked in CI.

They also work side by side: C4 for the software-structure model a team
maintains, and cairn for the dense views a formal architecture document needs.
