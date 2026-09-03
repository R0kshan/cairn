# DSL Spec

Tracks `main` — this describes the current grammar, not a frozen release; it
has no version number independent of the codebase itself. Design goals:
D2-like terseness, typed elements (the view knows what an `actor` is),
diagnostics-friendly (every token carries a source span), Git-friendly
(meaningful diffs), styling fully overridable.

## 1. Structure

A file is one diagram. The first statement declares which view it is, and the
view decides every element kind the rest of the file may use:

```text
diagram <logical|application|infrastructure> "Title"
```

Everything else is optional and order-free: elements, flows, an optional
`style { … }` block, `business-object` declarations (logical only) and a
`legend { … }` block.

### Grammar shared by every view

```text
<kind> <ID> "<Label>" (<attr>)? { …statements… }      # element
<ID> -> <ID> : "<label>" (TECH) [BO_REFS] { style }   # flow
```

- **IDs** are flat and unique per file — no namespace nesting. Legal
  characters are letters, digits, `_`, `-`, `/` and `.`. A duplicate is a
  diagnostic with a rename suggestion. Elements and business objects share the
  ID pool; flows get synthetic IDs (`F01`, `F02`…).
- **Element labels** are free text, `"` quoted. `\n` forces a line break;
  wrapping is automatic otherwise. Every element takes one, in every view — omit
  it and the element renders as its bare ID, with a **W0502** warning. *Flow*
  labels are a separate matter, required in some views and optional in others
  (per view, below).
- **`(<attr>)` after the label** carries a kind-specific attribute. The
  production is part of the grammar; none of the kinds in the views below takes
  one.
- **An element body** holds child elements plus the statements `order:`,
  `logo:` and `style { … }` (see [Positioning controls](#positioning-controls)
  and §2).
- **Comments** start with `#` and run to end of line.
- **Flow segments after the arrow are all optional**, subject to the view's
  rules: `: "label"`, the technical tail `(PROTOCOL, FORMAT)` or `(PROTOCOL/PORT)`,
  `[BO_REFS]` (logical only), and an inline `{ style }`. The arrow itself carries
  the line style — `->` solid, `-->` dashed, `..>` dotted — and either endpoint
  may pin its attachment side (`A.right -> B.left`).
- **Every flow is its own arrow with its own label.** Flows are never merged;
  an `A -> B` / `B -> A` pair is drawn as two separated edges.
- **`legend { note "…" }`** appends free lines to the auto-generated legend band
  below the canvas. `style { legend: off }` drops the band entirely.

**Inline style restriction:** per-element and per-flow `{ style { … } }` blocks
support four properties — `fill`, `stroke`, `text`, `label`. Diagram-level
`style { … }` blocks support the full 18-property set (§2). An unknown property
inside an inline block is **E0104**.

### Views at a glance

| View | Element kinds | Flow rules |
|---|---|---|
| `logical` | actor-group, actor, system, layer, block, external | label **required** (**E0203**); no technical tail; business objects via `[REFS]` (**logical-view only** — a `business-object` elsewhere is **E0222**) |
| `application` | actor-group, actor, system, application, module, gateway, auth, idp, queue, datastore, external | label **optional**; `(protocol, format)` **recommended on system-to-system flows** (**W0540**; actor flows exempt — C4 container-diagram practice) |
| `infrastructure` | actor, site, network-zone, server, app-instance, queue, gateway, firewall, auth, idp, external | label optional; protocol **required** (**E0240**): `(HTTPS/443)` |

Nesting is checked against the rules each view declares (**E0210–E0218**); a
combination no rule names is accepted. In the per-view tables below, a
**Placement** cell in bold and naming a diagnostic code is enforced by the
validator — anything else is convention the validator does not check, so a
`queue` declared inside an `application` parses and renders.

### 1.1 Logical view — `diagram logical`

What the system does, in functional terms: who uses it, which functional blocks
it is made of, and what data circulates between them. No technology, no
deployment.

| Kind | Stands for | Container? | Placement | Drawn as |
|---|---|---|---|---|
| `actor-group` | a population of roles | yes (holds `actor`) | root | dashed box, band 0 |
| `actor` | one role or person | no | **inside an `actor-group`** (**E0211**) | person glyph |
| `system` | the system under study | yes (holds `layer`, `block`) | root | box, band 1 |
| `layer` | a functional layer inside the system | yes (holds `block`) | **inside a `system`** (**E0212**) | box with title |
| `block` | one functional block | no | **inside a `layer`, `system` or `external`** (**E0210**) | plain box |
| `external` | third-party systems as a group | yes (holds `block`) | root | dashed box, band 2 |

Flows: `A -> B : "what is exchanged"`. **The label is mandatory** (**E0203**) —
the logical view exists to name the exchange. No protocol tail; a
`(HTTPS/443)`-style tail is meaningless here and the flow matrix for this view
has no protocol column.

Business objects — logical view only — declare *what circulates*, once, and are
then carried by flows:

```cairn
business-object BO_MSG "Message" "information message broadcast to the sites"
#               ^ID     ^name     ^description (both strings optional)

COM_CTR -> OBS : "Alerts and notifications" [BO_MSG]
```

They render as a chip under the flow label plus a registry band under the canvas
(ArchiMate: a business object associated with a flow relationship).

Completeness: a file with no `actor` warns (**W0501**); a `block` with no flow
warns (**W0510**).

```cairn
diagram logical "Appointment booking — logical view"

actor-group USERS "Users" {
  actor PATIENT "Patient"
}
actor-group STAFF "Staff" {
  actor SECRETARY "Medical secretary"
}

system BOOKING "Appointment booking system" {
  layer CHANNELS "Booking channels" {
    block PORTAL "Booking\nportal"
  }
  layer BUSINESS "Appointment management" {
    block SCHEDULER "Slot\nmanagement"
    block NOTIF "Notifications"
  }
}

external EXT "External systems" {
  block SMS "SMS gateway"
}

business-object BO_APPT "Appointment" "slot booked by a patient with a practitioner"
business-object BO_SLOT "Slot" "time window open for booking"

PATIENT   -> PORTAL    : "Search a slot\nand book" [BO_SLOT]
PORTAL    -> SCHEDULER : "Booking request" [BO_APPT]
SCHEDULER -> NOTIF     : "Appointment confirmed" [BO_APPT]
NOTIF     -> SMS       : "Send an SMS reminder"
SECRETARY -> SCHEDULER : "Open / block\nslots" [BO_SLOT]
SCHEDULER -> PATIENT   : "Appointment\nconfirmation" [BO_APPT]

legend {
  note "Health data is hosted on certified health-data infrastructure"
}
```

### 1.2 Application view — `diagram application`

Which applications exist, what they are built with, and which technical
exchanges connect them — the C4 container level.

| Kind | Stands for | Container? | Placement | `logo:` | Drawn as |
|---|---|---|---|---|---|
| `actor-group` | a population of roles | yes (holds `actor`) | root | no | dashed box, band 0 |
| `actor` | one role or person | no | **inside an `actor-group`** (**E0211**) | no | person glyph |
| `system` | a C4 system boundary grouping applications | yes | root, **never required** | no | box with title, band 1 |
| `application` | one deployable application | yes (holds `module`) | root or inside a `system` | yes | box with title, band 1 |
| `module` | a component inside an application | no | **inside an `application`** (**E0213**) | yes | plain box |
| `gateway` | an API gateway or reverse proxy | no | root, or inside a `system` | no | box + gate glyph |
| `auth` | an auth middleware | no | root, or inside a `system` | no | box + padlock glyph |
| `idp` | an identity provider | no | root, or inside a `system` | no | box + badge glyph |
| `queue` | a message queue or broker | no | root, or inside a `system` | yes | horizontal cylinder |
| `datastore` | a database or registry | no | root, or inside a `system` | yes | vertical cylinder |
| `external` | a third-party system | yes | root | yes | dashed box, band 2 |

`system` is the one kind here that carries no meaning of its own: it draws a C4
boundary around the applications, queues and datastores that belong to one
system, and the flow matrix then annotates an endpoint with its nearest
container — a module reads `Name (App)`, a queue sitting directly in the system
reads `Name (System)`.

Flows: the label is optional and usually omitted, because the interesting half
is the technical tail `(PROTOCOL, FORMAT)` — `(API_REST, JSON)`, `(MQ, JSON)`,
`(JDBC)`. Omit the label and the tail becomes the arrow's primary label; give
both and the tail renders as a smaller grey sub-line. A flow between two
non-actor elements with no tail warns (**W0540**); flows from an `actor` are
exempt. The matrix keeps the protocol and drops the format. Business objects are
rejected here (**E0222**). An unconnected `module`, `gateway`, `auth`, `idp`,
`queue` or `datastore` warns (**W0510**).

`gateway`, `auth` and `idp` are three of the kinds the infrastructure view has,
drawn identically — same colours, same corner placement, each with its own
glyph: a gate, a padlock, a badge. An API gateway, an auth middleware and an
identity provider are containers at the C4 level in their own right, and the
glyph is what tells them apart from a plain `application`, and from each other,
at a glance. Use `idp` for a provider that belongs to the landscape being described —
a self-hosted Keycloak, the group's SSO — and `external` for one owned by
someone else, the way any third party is drawn. `firewall` stays out of this
view on purpose: it is a network device with no application meaning. None of the
three glyph kinds takes a `logo:` (**E0108**) — the glyph occupies the corner a
logo would use.

`logo:` marks the technology a component runs on — see
[Positioning controls](#positioning-controls) for the full rules.

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

application CRM "Customer CRM" { logo: dotnet
  module CUSTOMER "Customer\nrecords"
}

gateway EDGE "Public API\ngateway"
auth SSO "SSO\nmiddleware"
idp SSO_IDP "Group SSO\nprovider"

external CARRIER "Carrier tracking\n(third party)"

CLERK    -> EDGE                           # actor flow: no tail needed
EDGE     -> SSO (API_REST, JSON)
SSO      -> SSO_IDP (OIDC, JWT)
SSO      -> CAPTURE (API_REST, JSON)
CAPTURE  -> VALIDATE (API_REST, JSON)
VALIDATE -> ORDER_DB (JDBC)
VALIDATE -> EVENTS (MQ, JSON)
CUSTOMER -> VALIDATE (API_REST, JSON)
EVENTS   -> CARRIER (SFTP, CSV)
```

### 1.3 Infrastructure view — `diagram infrastructure`

Where the software runs and how the traffic gets there: sites, network zones,
servers, deployed instances, the boxes in the path (gateway, firewall, auth,
IdP), and every flow's protocol and port. This is the view the *matrice des flux
techniques* is built from.

| Kind | Stands for | Container? | Placement | Drawn as |
|---|---|---|---|---|
| `actor` | a user or consumer of the infrastructure | no | root (**no `actor-group` in this view**) | person glyph, entry side |
| `site` | a site or data center | yes | root | box with title |
| `network-zone` | a network zone | yes | **inside a `site`, or nested in another zone** (**E0216**) | box with title, banded in declaration order |
| `server` | a server or VM | yes (holds `app-instance`) | **inside a `network-zone` or `site`** (**E0214**) | box with title |
| `app-instance` | a deployed application | no | **inside a `server` or `network-zone`** (**E0215**) | plain box |
| `queue` | a message queue or broker | no | inside a zone or site by convention | horizontal cylinder |
| `gateway` | gateway or reverse proxy | no | inside a zone or site (convention, not enforced) | box + gate glyph |
| `firewall` | firewall | no | inside a zone or site (convention, not enforced) | box + brick-wall glyph |
| `auth` | auth middleware | no | inside a zone or site (convention, not enforced) | box + padlock glyph |
| `idp` | identity provider | no | inside a zone or site (convention, not enforced) | box + badge glyph |
| `external` | a partner system | no | root | dashed box, exit side |

Flows: **the protocol is mandatory** (**E0240**), the label is optional. The tail
is one token, `PROTOCOL/PORT`:

```cairn
CORE -> DB_I : "Queries" (TCP/5432)
RP   -> CORE (HTTPS/8443)              # label omitted: the tail becomes the label
CORE -> PARTNER : "Nightly export" (SFTP/22)
```

The matrix splits that token on its **last** `/` when what follows is all
digits, filling the Protocol and Port columns separately; a tail with no numeric
port (`(LDAPS)`) fills Protocol and leaves Port empty.

Layout: this view has no fixed bands for the containers — sites and zones are
placed in **declaration order** along the reading direction, so the file's order
is the diagram's order, with `external` pushed to the far side. An unconnected
`app-instance`, `queue`, `gateway`, `firewall`, `auth` or `idp` warns
(**W0510**).

```cairn
diagram infrastructure "Order platform — infrastructure view"

actor USERS "End users"

site DC1 "Main datacenter" {
  network-zone DMZ "DMZ" {
    firewall FW "Perimeter\nfirewall"
    gateway RP "Reverse\nproxy"
  }
  network-zone LAN "Internal zone" {
    auth OAUTH "OAuth2\nproxy"
    idp IDP "LDAP / IdP"
    server APP_SRV "Application server" {
      app-instance CORE "Order core"
    }
    server DB_SRV "Database server" {
      app-instance ORDER_DB "PostgreSQL"
    }
    queue BROKER "Message broker"
  }
}

external PARTNER "Partner platform"

USERS -> FW       : "Web access" (HTTPS/443)
FW    -> RP       : "Filtered traffic" (HTTPS/443)
RP    -> CORE     : "API calls" (HTTPS/8443)
CORE  -> OAUTH    : "Token check" (HTTPS/8443)
OAUTH -> IDP      : "Validate tokens" (LDAPS/636)
CORE  -> ORDER_DB : "Queries" (TCP/5432)
CORE  -> BROKER   : "Publish events" (TCP/9092)
CORE  -> PARTNER  : "Nightly export" (SFTP/22)
```

### 1.4 Layout partitions

The layout engine assigns each element a semantic band (ELK partition).
Elements in the same partition stay aligned across the reading direction.

| View | Partitions (in reading order) |
|---|---|
| `logical` | actor-groups (0) · systems (1) · externals (2) |
| `application` | actor-groups (0) · systems / applications / queues / datastores (1) · externals (2) |
| `infrastructure` | sites / zones in declaration order · externals last |

Scaffold any of them with `cairn new` — `-L` logical, `-A` application,
`-I` infrastructure — which writes a commented starter file for that view.

### Positioning controls

Layout is automatic. These three controls exist for the cases where it gets a
diagram wrong; each is opt-in, and a file that uses none of them renders exactly
as it did before they existed.

**`order: <n>` — where an element sits in the reading order.** A statement in the
element's body, not a style property (placement is layout, not cosmetics). Lower
comes first, and *first* is defined by the active disposition: left to right for
`wide`/`slide`, top to bottom for `tall`/`page`. Values need not be contiguous,
and a value that is not a whole number ≥ 0 is **E0106**.

```cairn
application BACKEND_L1 "Line 1 backend" {
  order: 1
  module MSG_L1 "Messaging handler"
}
application BACKEND_L2 "Line 2 backend" {
  order: 2
  module MSG_L2 "Messaging handler"
}
```

At the diagram root the hint becomes a band of the element's own layout
partition, which is why it reads along the length: two elements the flows give
the same depth — the two backends above, both publishing to the same queue —
would otherwise be drawn side by side across the axis. Three rules bound it.

- **It never crosses a view partition** (§9). An `order:` on an actor-group
  orders it among the other actor-groups; it cannot push it past the
  applications.
- **An element without an `order:` follows the flows.** It joins the band of the
  latest ordered element that flows into it, so a hint never drags a consumer
  ahead of its own source; when nothing flows into it, it sits in the first band.
- **A flow may end up running backwards.** Where the declared order contradicts
  the flow direction, the order wins and the flow is drawn as a backward edge.

**Inside a container `order:` sorts across the axis instead** — top to bottom in
`wide`/`slide`, left to right in `tall`/`page`. A child's layer is fixed by the
flows there and every layer constraint elk offers was measured to be a no-op
under its `INCLUDE_CHILDREN` hierarchy handling, so the hint orders the siblings
that share a layer and nothing more:

```cairn
actor-group STAFF "Payment actors" {
  actor OPERATOR "Payment operator" { order: 1 }
  actor AUDITOR  "Compliance auditor" { order: 2 }
}
```

**`logo: <name>` — the technology a component is built on.** A statement inside
an element body, like `order:`. Content rather than cosmetics, so it lives
outside the `style` block. Application view only, and only on the kinds that
stand for running software: `application`, `module`, `queue`, `datastore`,
`external`. An `actor` is a person and a `system` is a grouping, so neither takes
one (**E0108**).

```cairn
module WEB "Web client" { logo: react }
datastore ORDER_DB "Order store" { logo: postgresql }
module BILLING "Billing" { logo: "./logos/acme.svg" }
```

A bare name comes from the built-in set — `cairn logos` lists all of them, and an
unknown one is **E0107** with a `did you mean` suggestion. A quoted value is a
path to a file **relative to the `.cairn` file**, in `.svg`, `.png`, `.jpg`,
`.jpeg` or `.webp`, of up to 256 KB.

The mark is drawn in the element's top-right corner, opposite the kind glyph, in
the node's own stroke colour — a built-in logo never introduces a colour the
theme did not choose. The layout reserves room for it, so a long label is
centred in what is left rather than running underneath.

**A URL is refused (E0105).** A logo file is read at build time and inlined as a
`data:` URI, so the SVG stays one self-contained file: it renders offline, it
cannot change under the author afterwards, and opening it does not tell a third
party who is reading. A file that is missing, oversized or of an unsupported type
is **W0580** — a warning, not an error, and the diagram renders without the mark.

Because the core never touches a filesystem, file-sourced logos resolve in the
CLI. The playground, which has no filesystem, renders built-ins only.

**`ID.side` — which side of an element a flow attaches to.** Written on either
endpoint, independently: `A.right -> B`, `A -> B.top`, or both. Sides are named
as the diagram is *read* — `left`, `right`, `top`, `bottom` — not relative to the
flow's direction, so a diagram authored for `wide` may want different pins after
switching to `tall`.

```cairn
POSTING.bottom -> LEDGER_DB.top (JDBC)
```

Because `.` is a legal id character, `API.right` is ambiguous with an element
*named* `API.right`. A declared id always wins, and the dropped side reading is
reported as **W0571**. An unknown side name is **E0223**. A pin is a request,
not a guarantee: one the layout cannot reach is dropped rather than forced into
an unreadable route, and reported as **W0570**. A pin fixes the two ends, not the
path between them: the passes that would move a terminal stand down for *that*
terminal — pin one end and the other is still re-aimed, unwoven and measured as
usual — while the route itself is still tidied along shapes that leave the
pinned ends where the author put them.

**Arrow glyph — the flow's line style.** `->` solid (the default), `-->` dashed,
`..>` dotted. Whitespace before the arrow is required, as it always has been
(`A->B` does not parse: `-` is a legal id character). Precedence follows the
style model: an inline `{ stroke: dashed }` beats the glyph, which beats the
diagram-level `flow-stroke`.

```cairn
ROUTING --> SETTLE (MQ, JSON)          # dashed
ROUTING ..> SCHEME (ISO8583)           # dotted
M2 --> M4 (MQ, JSON) { stroke: solid } # inline wins: solid
```

Three files in [`examples/placement/`](../examples/placement) show the two
controls: `baseline.cairn` declares neither, `sides.cairn` is the same shape with
`ID.side` pins on its flows, and `reading-order.cairn` sequences two backends
along the length with `order:`.

## 2. Styling — three levels, most specific wins

View defaults → diagram-level `style` block → inline per-element/per-flow. Terse shorthand: the parser disambiguates values by shape (`#hex` = color, keyword = line style, number = width). Conflicting same-type values (e.g. `dashed dotted`) → diagnostic.

```cairn
style {
  theme: light                 # light | dark | slate | sand | contrast | nord |
  #                              solarized | classic | classic-dark — selects the
  #                              default color palette. A custom palette is a JSON
  #                              file passed to `--theme` (§4), never a DSL name.
  accent: #4c6ef5              # #hex — retints the flows on top of the theme
  lang: en                     # en | fr — localizes rendered labels (band titles,
  #                              legend, matrix headers); keywords stay English (D2)
  background: #ffffff          # canvas background color (defaults to the theme's)
  disposition: wide            # wide | tall | slide | page
  #   wide  : elongated horizontal (default) — actors left, externals right
  #   tall  : elongated vertical — actors top, externals bottom
  #   slide : balanced, targets a 16:9 ratio (PowerPoint)
  #   page  : balanced, targets an A4 portrait ratio (Word/ODT)
  # slide/page: orientation is a hard constraint (slide is always landscape,
  # page always portrait). Among correctly-oriented candidates (both directions,
  # narrow-wrapped labels, tight spacing, min-layer layering), the winner is the
  # one that MAXIMIZES scale-to-fit on the physical target (1280×720 slide /
  # A4 page) — i.e. the biggest readable text, not an abstract ratio. The build
  # prints the fit: `fits 16:9 slide at 91% (labels ≈ 9.5px)`. If labels would
  # land below ~7px, W0520 warns that the diagram exceeds the medium's capacity
  # and suggests splitting the view — no layout can fix too much content.
  crossing-hops: on            # on | off — arcs where lines cross (spike-validated)
  compact: off                 # on | off — denser layout: tighter inter-layer
  #                              spacing and narrower-wrapped flow labels
  arrows: normal               # normal | large — arrowhead size
  legend: auto                 # auto | off — auto legend band below the canvas
  flow-text: full              # full | numbered
  #   full     : labels (and BO chips) ride on the arrows
  #   numbered : arrows carry a number badge only; full descriptions + chips
  #              move to a flow table below the canvas
  #              (recommended for very large diagrams)
  flow-label: above            # on-line | above | below
  flow-color: none             # none | by-source — one hue per source element
  flow-stroke: solid #444 1.3
  fill actor-group: #eef4fb    # per-kind fill
  stroke actor-group: #7a9cc4 dashed
  text block: #222233          # per-kind label/text color
  font: "Helvetica" 11         # family and size in one value
  font-size: 11                # size alone, leaving the family as it is
}

block COM_CTR "Central communication module" {
  style { fill: #fff7e6  stroke: #b08d2a dashed 1.5  text: #5a4a10 }
}
COM_CTR -> OBS : "Alerts…" { label: below  stroke: dashed #a33  text: #a33 }
```

Colors: `theme` picks one of the nine built-in palettes (`light` is the default) and `background` overrides the canvas color; `accent` retints the flows on top of whichever palette is in force, and `flow-color: by-source` gives every source element its own hue instead. A per-flow inline `{ stroke: … }` still wins over both. Each element's colors are customizable at every level: `fill`, `stroke` and `text` (label color) work inline per element, per kind (`fill block: …`), or per diagram; flow color/width/style via `flow-stroke` and inline `{ stroke: … }`. Several properties may share one line: `{ fill: #a stroke: #b text: #c }`.

Rules: styles never affect validation (semantics and cosmetics stay separate); views ship coherent defaults for both themes so a zero-`style` diagram renders correctly in light or dark.

Output language: `lang: fr` switches rendered chrome to French (`FLUX`, `OBJETS MÉTIER`, `LÉGENDE`, French legend/kind names, and the flow-matrix headers). Only the rendered artifact changes — DSL keywords remain English (decision D2) so sources stay portable and diff-clean. Default `en` is byte-identical to prior output.

## 2.1 Flow matrix

> This is a standard French EA deliverable — the *matrice des flux techniques* — natively produced from a diagram-as-code DSL

`cairn matrix <file> --format csv|md|svg` tabulates the flows of a diagram, one row per flow. **Every view exports one**, with the columns its flows can actually fill and its own container kind annotating the endpoints that sit in one, as `Name (Zone)` — an endpoint declared outside any of them (an `external`, a root-level actor) is listed by name alone:

| View | Columns (English) | Endpoint annotated with |
|---|---|---|
| `infrastructure` | No. · Source · Destination · Protocol · Port · Flow | `network-zone`, `site` |
| `application` | No. · Source · Destination · Protocol · Flow | `application`, `system` |
| `logical` | No. · Source · Destination · Flow | `layer`, `system` |

Infrastructure is the reference shape — the deliverable the format was designed around. There the protocol/port pair is split from the infra tail `(HTTPS/443)`, and with `lang: fr` its headers read **N° · Source · Destination · Protocole · Port · Nature du flux**. Application takes the protocol half of the C4 tail `(API_REST, JSON)` and no port; logical flows carry no technical tail at all, so its table is who exchanges what with whom.

`csv`/`md` produce an editable table for the architecture dossier; `svg` a theme-aware, paste-ready table image. Headers follow `style { lang }`. Output defaults to `<file>.flow.<ext>`.

Which columns a view emits is view data, declared in `views.ts` — adding a view brings its own matrix shape with it, the exporter branches on nothing. The same table is available to embedders: `compile(source, { matrix: true })` returns it as data (`columns` + one `row` per flow), and the `matrixCsv` / `matrixMd` / `matrixSvg` exports format it exactly as the CLI does.

## 2.2 Themes

`theme:` is the one style property whose value space is defined outside the DSL:
the DSL names a palette, the palette itself is built-in or comes from JSON.

**Nine built-ins**, listed by `cairn themes`: `light` (the default), `dark`,
`slate`, `sand`, `contrast`, `nord`, `solarized`, plus the two legacy variants
`classic` and `classic-dark`.

**Three ways to select one**, most specific wins:

```text
style { theme: nord }                          # in the diagram
cairn build my-system.cairn --theme nord       # CLI — overrides the diagram
compile(source, { theme: "nord" })             # embedder
```

The flag is applied after parsing (the parser validates `theme:` against a
closed set, so a custom name written in the DSL is rejected) and works on
`build`, `matrix` and `watch`. A theme that cannot be resolved is an error, never
a silent fallback to the default palette.

### A palette of your own

Custom palettes are **not DSL syntax** — reading a file from the parser would put
filesystem work back into a core that must also run in the playground. They are a
JSON file for the CLI, or an object for `compile()`:

```sh
cairn build my-system.cairn --theme ./my-theme.json
```

```json
{
  "extends": "dark",
  "dark": true,
  "pal": { "bg": "#0d1117", "nStroke": "#58a6ff" },
  "accentColors": { "blue": "#58a6ff", "blueF": "#0d2136" }
}
```

A spec **extends a built-in and overrides only what it names**, so a usable theme
is a few keys rather than the fifty-odd colours a full palette holds. Five keys
exist, all optional:

| Key | Holds | Notes |
|---|---|---|
| `extends` | a built-in to inherit from | defaults to `light`; accepts `light`, `dark`, `slate`, `sand`, `contrast`, `nord`, `solarized` — **not** `classic` / `classic-dark`, which are aliases rather than specs |
| `dark` | `true` \| `false` | whether the palette sits on a dark ground. Selects the flow colour set, and **cannot be inferred** from the colours: a dark palette that omits it draws light flow hues |
| `pal` | canvas and chrome colours | `bg`, `text`, `sub`, `muted`, `cFill`, `cStroke`, `nFill`, `nStroke`, `edge`, `div`, `halo`, `aStroke`, `aText`, `chip`, `badge` |
| `accentColors` | per-kind fills and strokes | 34 keys in stroke/fill pairs, the fill suffixed `F`: `blue`/`blueF`, `amber`, `app`, `gold`, `violet`, `red`, `purple`, `green`, `node`, `auth`, `idp`, `fw`, `authn` follow that shape; `siteS`/`siteF`, `leafS`/`leafF`, `aiS`/`aiF` and `serverS`/`serverF` suffix the stroke `S` |
| `lv` | sensitivity-level palettes | keys `public`, `internal`, `restricted`, `secret`, each a `[fill, stroke]` pair |

Merging is one level deep, which is as deep as a palette goes — naming
`pal.bg` leaves every other `pal` entry inherited. Most entries are a single
colour; the exceptions are `pal.chip` (`[fill, stroke, text]`), `pal.badge`
(`[fill, stroke]`) and every `lv` entry (`[fill, stroke]`), which are replaced
whole and must carry exactly that many colours.

A colour is a hex value (3, 4, 6 or 8 digits), an `rgb()`/`rgba()` or
`hsl()`/`hsla()` call in either the legacy comma form or the modern
slash-separated form, or a CSS colour keyword (`rebeccapurple`, `transparent`,
`currentColor`). This is wider than the DSL itself, where a colour is always
`#hex`.

Anything else is rejected **by name, at load time** — `ThemeSpecError` (the CLI
wraps it as `ThemeFileError` with the file path in front) naming the offending
key: an unknown `extends`, a non-boolean `dark`, an unknown section, a value
that is not a colour, or a tuple of the wrong length. Nothing reaches the SVG,
where an unparseable colour is silently ignored — a bad fill turns the shape
black, a bad stroke erases its outline.

**The CLI registers the file under its basename** (`my-theme.json` → `my-theme`),
which is the name the renderer then resolves. `classic`, `classic-dark`,
`__proto__`, `constructor` and `prototype` are reserved and rejected: a file
named `classic.json` would otherwise register without error and never be used.

**An embedder passes the same object instead of a file**, and it is used for that
call and forgotten — nothing is registered globally, so a server rendering for
many callers cannot leak one caller's colours into another's diagram, and two
callers cannot collide on a name:

```js
import { compile, resolveThemeSpec } from "@r0kshan/cairn";

const { svg } = await compile(source, {
  theme: { extends: "dark", dark: true, pal: { bg: "#0d1117" } },
});
```

`resolveThemeSpec()` is exported for validating a palette up front; it and
`compile()` throw the same `ThemeSpecError`. A complete example ships in
[`examples/themes/midnight.json`](../examples/themes/midnight.json).

## 3. Diagnostics

Every issue cairn reports carries a stable code (`E01xx` syntax, `E02xx` semantic, `W05xx` warning). Run `cairn explain <CODE>` for the rationale behind any rule (e.g. `cairn explain E0240`). See [`DIAGNOSTICS.md`](DIAGNOSTICS.md) for the full code catalog.

## 4. Deferred (not v0.1)

Imports/includes across files, variables, longhand style properties (`stroke-color:` …) as an additive alternative.

Themes are no longer deferred — see [§2.2](#22-themes). A custom palette stays a CLI parameter (or a `compile()` option) rather than DSL syntax, because reading a file from the parser would put filesystem work back into a core that must run in the playground.
