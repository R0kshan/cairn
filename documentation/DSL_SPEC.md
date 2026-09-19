# DSL Spec

One `.cairn` file is one diagram.

```text
diagram <logical|application|infrastructure> "Title"
```

That first line picks the view, and the view decides which element kinds the
rest of the file may use. Everything after it is optional and order-free:
elements, flows, a `style { … }` block, `business-object` declarations
(logical only) and a `legend { … }` block.

Scaffold a file with `cairn new` — `-L` logical, `-A` application,
`-I` infrastructure.

## Contents

| I want to… | Go to |
|---|---|
| write my first diagram | [Grammar shared by every view](#grammar-shared-by-every-view) |
| know which kinds and flow rules my view has | [Views at a glance](#views-at-a-glance) |
| draw what the system does, no technology | [1.1 Logical view](#11-logical-view--diagram-logical) |
| draw applications and their technical exchanges | [1.2 Application view](#12-application-view--diagram-application) |
| draw sites, zones, servers, protocols and ports | [1.3 Infrastructure view](#13-infrastructure-view--diagram-infrastructure) |
| understand why an element landed where it did | [1.4 Layout partitions](#14-layout-partitions) |
| move something the layout put in the wrong place | [Positioning controls](#positioning-controls) |
| put a technology logo on a component | [Logos](#logos) |
| set colours, fonts, arrow size, page shape | [2. Styling](#2-styling--three-levels-most-specific-wins) |
| make a wide diagram fit | [Density controls](#density-controls) |
| export the flow table for a dossier | [3. Flow matrix](#3-flow-matrix) |
| change the palette, or write my own | [Themes](#themes) |
| look up an error or warning code | [4. Diagnostics](#4-diagnostics) |

**Positioning controls, one line each:**
[`order:`](#order-n--reading-order) reading order ·
[`offset:`](#offset-dx-dy--nudge-an-element) move an element ·
[`size:`](#size-dw-dh--resize-a-container) resize a container ·
[`label-offset:`](#label-offset-dx-dy--nudge-a-flows-label) move a flow label ·
[`segment-offset:`](#segment-offset-run-delta--slide-one-run-of-a-route) slide one run of a route ·
[`ID.side`](#idside--which-side-a-flow-attaches-to) pin an attachment side ·
[queue sides](#a-queues-flows-are-sided-for-you) and
[`ID.producer` / `ID.consumer`](#idproducer--idconsumer--which-side-of-the-exchange) ·
[arrow glyph](#arrow-glyph--the-flows-line-style) line style

## 1. Structure

### Grammar shared by every view

```text
<kind> <ID> "<Label>" { …statements… }                # element
<ID> -> <ID> "<label>" (TECH) [BO_REFS] { style }     # flow
```

```cairn
# an element, and an element holding two children
datastore ORDER_DB "Order repository"

application ORDER_APP "Order management" {
  module CAPTURE "Order capture"
  module VALIDATE "Order validation"
}

# a flow, and a flow carrying everything it may carry
CAPTURE -> VALIDATE
CAPTURE -> EVENTS "Order created" (MQ, JSON) { label: below }
```

- **IDs** are flat and unique per file. Letters, digits, `_`, `-`, `/` and `.`.
  Elements and business objects share the ID pool; flows get synthetic IDs
  (`F01`, `F02`…). A duplicate is a diagnostic with a rename suggestion.
- **Element labels** are `"` quoted free text. `\n` forces a line break.
  Omit the label and the element renders as its bare ID, with **W0502**.
- **An element body** holds child elements plus `order:`, `offset:` and — on a
  container — `size:`
  ([Positioning controls](#positioning-controls)), `logo:` ([Logos](#logos))
  and `style { … }` (§2).
- **Comments** start with `#` and run to end of line.
- **Everything after the arrow is optional**, subject to the view's rules:
  `"label"`, a technical tail (`(PROTOCOL, FORMAT)` or `(PROTOCOL/PORT)`),
  `[BO_REFS]` (logical only) and an inline `{ … }` block.
- **The arrow carries the line style** — `->` solid, `-->` dashed, `..>` dotted
  — and either endpoint may pin its side: `A.right -> B.left`. Whitespace before
  the arrow is required (`A->B` does not parse: `-` is a legal ID character).
- **A `:` may sit before the label** — `A -> B : "label"`. Older spelling, still
  parsed; write `A -> B "label"` in new files.
- **Every flow is its own arrow.** Flows are never merged; `A -> B` and
  `B -> A` are drawn as two separate edges.
- **`legend { note "…" }`** appends lines to the legend band under the canvas.
  `style { legend: off }` drops the band. The band keys only what the drawing
  actually holds.

**Inline blocks take seven properties:** `fill`, `stroke`, `text`, `label`, and
on a flow also `label-offset`, `segment-offset` and `flow-label-wrap`. Anything
else inline is **E0104**. Diagram-level `style { … }` blocks take the full set
listed in §2.

### Views at a glance

| View | Element kinds | Flow rules |
|---|---|---|
| `logical` | actor-group, actor, system, layer, block, security, external | label **required** (**E0203**); no technical tail; business objects via `[REFS]` (logical only — elsewhere is **E0222**) |
| `application` | actor-group, actor, system, application, module, gateway, auth, idp, queue, datastore, external | label optional; `(protocol, format)` recommended between non-actors (**W0540**) |
| `infrastructure` | actor, device, site, network-zone, cluster, server, app-instance, queue, datastore, gateway, load-balancer, firewall, auth, idp, external | label optional; protocol **required** (**E0240**): `(HTTPS/443)` |

Nesting is checked against each view's rules (**E0210–E0218**). In the tables
below, a **Placement** cell in bold naming a code is enforced; anything else is
convention, so a `queue` inside an `application` parses and renders.

### 1.1 Logical view — `diagram logical`

What the system does: who uses it, which functional blocks it has, what data
moves between them. No technology, no deployment.

| Kind | Stands for | Container? | Placement | Drawn as |
|---|---|---|---|---|
| `actor-group` | a population of roles | yes (holds `actor`) | root | dashed box, band 0 |
| `actor` | one role or person | no | **inside an `actor-group`** (**E0211**) | person glyph |
| `system` | the system under study | yes (holds `layer`, `block`) | root | box, band 1 |
| `layer` | a functional layer | yes (holds `block`) | **inside a `system`** (**E0212**) | box with title |
| `block` | one functional block | no | **inside a `layer`, `system` or `external`** (**E0210**) | plain box |
| `security` | a security capability with business impact | no | anywhere | box + padlock glyph |
| `external` | third-party systems | yes (holds `block`) | root | dashed box, band 2 |

**`security` names the capability, not the component.** Strong authentication,
anonymisation, encryption of a held record — the controls a business feels. It
is deliberately not the `auth` kind the other two views carry: `auth` is a piece
of middleware, this view holds no technology, and anonymisation is not
authentication. Unlike `block` it may sit anywhere, and an unconnected one is
not warned — a capability can apply to a record rather than to an exchange.

**The flow label is mandatory** (**E0203**) — this view exists to name the
exchange. No technical tail.

**Business objects** name what circulates, once, and flows then carry them:

```cairn
business-object BO_MSG "Message" "broadcast to the sites"
#               ^ID     ^name     ^description (both strings optional)

COM_CTR -> OBS "Alerts and notifications" [BO_MSG]
```

They render as a chip under the flow label, plus a registry band under the
canvas.

A file with no `actor` warns (**W0501**); a `block` with no flow warns
(**W0510**).

```cairn
diagram logical "Appointment booking — logical view"

actor-group USERS "Users" {
  actor PATIENT "Patient"
}

system BOOKING "Appointment booking system" {
  layer CHANNELS "Booking channels" {
    block PORTAL "Booking\nportal"
    security MFA "Strong\nauthentication"
  }
  layer BUSINESS "Appointment management" {
    block SCHEDULER "Slot\nmanagement"
    block NOTIF "Notifications"
  }
}

external EXT "External systems" {
  block SMS "SMS gateway"
}

business-object BO_APPT "Appointment" "slot booked with a practitioner"

PATIENT   -> MFA       "Signs in"
MFA       -> PORTAL    "Verified identity"
PORTAL    -> SCHEDULER "Booking request" [BO_APPT]
SCHEDULER -> NOTIF     "Appointment confirmed" [BO_APPT]
NOTIF     -> SMS       "Send an SMS reminder"

legend {
  note "Health data is hosted on certified infrastructure"
}
```

### 1.2 Application view — `diagram application`

Which applications exist, what they run on, which technical exchanges connect
them.

| Kind | Stands for | Container? | Placement | `logo:` | Drawn as |
|---|---|---|---|---|---|
| `actor-group` | a population of roles | yes (holds `actor`) | root | no | dashed box, band 0 |
| `actor` | one role or person | no | **inside an `actor-group`** (**E0211**) | no | person glyph |
| `system` | a boundary grouping applications | yes | root, never required | no | box with title, band 1 |
| `application` | one deployable application | yes (holds `module`) | root or in a `system` | yes | box with title, band 1 |
| `module` | a component inside an application | no | **inside an `application`** (**E0213**) | yes | plain box |
| `gateway` | an API gateway or reverse proxy | no | root, or in a `system` | no | box + gate glyph |
| `auth` | an auth middleware | no | root, or in a `system` | no | box + padlock glyph |
| `idp` | an identity provider | no | root, or in a `system` | no | box + badge glyph |
| `queue` | a message queue or broker | no | root, or in a `system` | yes | horizontal cylinder |
| `datastore` | a database or registry | no | root, or in a `system` | yes | vertical cylinder |
| `external` | a third-party system | yes | root | yes | dashed box, band 2 |

The flow label is optional and usually omitted — the technical tail is the
interesting half. Omit the label and the tail becomes the arrow's label; give
both and the tail renders as a smaller grey sub-line. A flow between two
non-actor elements with no tail warns (**W0540**). Business objects are rejected
(**E0222**). An unconnected `module`, `gateway`, `auth`, `idp`, `queue` or
`datastore` warns (**W0510**).

Use `idp` for a provider inside the landscape you are drawing (a self-hosted
Keycloak, the group's SSO) and `external` for one somebody else owns. `gateway`,
`auth` and `idp` take no [`logo:`](#logos) (**E0108**) — their glyph occupies
the corner a logo would use. `firewall` is infrastructure-only.

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

gateway EDGE "Public API\ngateway"
auth SSO "SSO\nmiddleware"
idp SSO_IDP "Group SSO\nprovider"

external CARRIER "Carrier tracking"

CLERK    -> EDGE                        # actor flow: no tail needed
EDGE     -> SSO (API_REST, JSON)
SSO      -> SSO_IDP (OIDC, JWT)
SSO      -> CAPTURE (API_REST, JSON)
CAPTURE  -> VALIDATE (API_REST, JSON)
VALIDATE -> ORDER_DB (JDBC)
VALIDATE -> EVENTS (MQ, JSON)
EVENTS   -> CARRIER (SFTP, CSV)
```

### 1.3 Infrastructure view — `diagram infrastructure`

Where the software runs and how traffic reaches it. This is the view the
*matrice des flux techniques* is built from.

| Kind | Stands for | Container? | Placement | Drawn as |
|---|---|---|---|---|
| `actor` | a user of the infrastructure | no | root (**no `actor-group` here**) | person glyph, entry side |
| `device` | a client machine | no | root | box + monitor glyph, entry side |
| `site` | a site or data center | yes | root | box with title |
| `network-zone` | a network zone | yes | **inside a `site` or another zone** (**E0216**) | box with title |
| `cluster` | nodes that stand in for one another | yes (holds `server`, `app-instance`, `datastore`) | **inside a `network-zone` or `site`** (**E0217**) | dashed box with title |
| `server` | a server or VM | yes (holds `app-instance`) | **inside a `network-zone`, `site` or `cluster`** (**E0214**) | box with title |
| `app-instance` | a deployed application | no | **inside a `server`, `network-zone` or `cluster`** (**E0215**) | plain box |
| `queue` | a message queue or broker | no | in a zone or site (convention) | horizontal cylinder |
| `datastore` | a database | no | in a zone, site or cluster (convention) | vertical cylinder |
| `gateway` | gateway or reverse proxy | no | in a zone or site (convention) | box + gate glyph |
| `load-balancer` | répartiteur de charge | no | in a zone or site (convention) | box + fan glyph |
| `firewall` | firewall | no | in a zone or site (convention) | box + brick-wall glyph |
| `auth` | auth middleware | no | in a zone or site (convention) | box + padlock glyph |
| `idp` | identity provider | no | in a zone or site (convention) | box + badge glyph |
| `external` | a partner system | no | root | dashed box, exit side |

**`cluster` draws the redundancy, `server` draws the machine.** A Kubernetes
cluster of worker nodes or a primary/standby database pair is one cluster
holding its members, not one box standing for all of them — the dashed border
says the group is what is resilient, and the nodes inside say how.

**A load balancer is not a `gateway`.** A gateway terminates a protocol
conversation and forwards it; a load balancer picks one backend out of many, and
that "one of N" is the topology an infrastructure view exists to show — the same
reason `cluster` is its own kind. Use `gateway` for an API gateway or a reverse
proxy, `load-balancer` for the thing in front of a pool.

**A WAF is a `firewall`, not an `app-instance`.** It is a barrier in the traffic
path, whether it runs as an appliance in the DMZ or as software on the reverse
proxy — the brick-wall glyph is what a reader scans for.

**The protocol is mandatory** (**E0240**), the label optional. The tail is one
token, `PROTOCOL/PORT`:

```cairn
CORE -> DB_I "Queries" (TCP/5432)
RP   -> CORE (HTTPS/8443)              # label omitted: the tail becomes the label
CORE -> PARTNER "Nightly export" (SFTP/22)
```

The matrix splits that token on its **last** `/` when what follows is all
digits; a tail with no numeric port (`(LDAPS)`) leaves Port empty.

Sites and zones are placed in **declaration order** along the reading
direction, with `external` pushed to the far side. An unconnected
`app-instance`, `device`, `queue`, `datastore`, `gateway`, `load-balancer`,
`firewall`, `auth` or `idp` warns (**W0510**).

```cairn
diagram infrastructure "Order platform — infrastructure view"

actor USERS "End users"

site DC1 "Main datacenter" {
  network-zone DMZ "DMZ" {
    firewall FW "Perimeter\nfirewall"
    load-balancer LB "Load\nbalancer"
    gateway RP "Reverse\nproxy"
  }
  network-zone LAN "Internal zone" {
    auth OAUTH "OAuth2\nproxy"
    idp IDP "LDAP / IdP"
    server APP_SRV "Application server" {
      app-instance CORE "Order core"
    }
    cluster PG "PostgreSQL cluster" {
      datastore PG_PRIMARY "Primary"
      datastore PG_STANDBY "Standby"
    }
    queue BROKER "Message broker"
  }
}

external PARTNER "Partner platform"

USERS -> FW      "Web access" (HTTPS/443)
FW    -> LB      "Filtered traffic" (HTTPS/443)
LB    -> RP      "Balanced traffic" (HTTPS/443)
RP    -> CORE    "API calls" (HTTPS/8443)
CORE  -> OAUTH   "Token check" (HTTPS/8443)
OAUTH -> IDP     "Validate tokens" (LDAPS/636)
CORE  -> PG_PRIMARY "Queries" (TCP/5432)
PG_PRIMARY -> PG_STANDBY "Replication" (TCP/5432)
CORE  -> BROKER  "Publish events" (TCP/9092)
CORE  -> PARTNER "Nightly export" (SFTP/22)
```

### 1.4 Layout partitions

Each element gets a semantic band. Elements in the same band stay aligned
across the reading direction.

| View | Bands, in reading order |
|---|---|
| `logical` | actor-groups (0) · systems (1) · externals (2) |
| `application` | actor-groups (0) · systems / applications / gateways / auths / idps / queues / datastores (1) · externals (2) |
| `infrastructure` | actors / devices first · sites / zones in declaration order · externals last |

**Lanes.** Within its band, the `external` elements of every view are seated in
one lane — a column under `wide`/`slide`, a row under `tall`/`page`. Two
exceptions keep their own layer: an external that is a container, and one linked
to another external by a flow. `compact: on` skips lanes entirely.

### Positioning controls

Layout is automatic. These controls are for when it gets a diagram wrong. Each
is opt-in; a file using none of them renders exactly as it always did.

| Control | Where it goes | Moves |
|---|---|---|
| `order: <n>` | element body | where the element sits in the reading order |
| `offset: <dx>, <dy>` | element body | the element, in pixels |
| `size: <dw>, <dh>` | container body | how much room the container has, in pixels |
| `label-offset: <dx>, <dy>` | flow inline block | that flow's label |
| `segment-offset: <run>, <delta>` | flow inline block | one run of that flow's route |
| `ID.side` | either flow endpoint | which side of an element the flow meets |

A queue's flow sides need no control at all; see below.

#### `order: <n>` — reading order

Lower comes first, where *first* follows the disposition: left to right for
`wide`/`slide`, top to bottom for `tall`/`page`. Values need not be contiguous.
Not a whole number ≥ 0 is **E0106**.

```cairn
application BACKEND_L1 "Line 1 backend" { order: 1 }
application BACKEND_L2 "Line 2 backend" { order: 2 }
```

- **It never crosses a view band.** An `order:` on an actor-group orders it
  among actor-groups; it cannot push it past the applications.
- **An element with no `order:` follows the flows** — it joins the band of the
  latest ordered element flowing into it, or the first band if nothing does.
- **A flow may end up running backwards** where the declared order contradicts
  the flow direction. The order wins.
- **Inside a container it sorts across the axis instead** — top to bottom in
  `wide`/`slide`, left to right in `tall`/`page` — among siblings sharing a
  layer:

```cairn
actor-group STAFF "Payment actors" {
  actor OPERATOR "Payment operator" { order: 1 }
  actor AUDITOR  "Compliance auditor" { order: 2 }
}
```

#### `offset: <dx>, <dy>` — nudge an element

`dx` is right, `dy` is down; either may be negative. Anything but a pair of
whole numbers is **E0109**. This is what the playground writes when you drag an
element.

```cairn
block APP "Order management" { offset: 40, -20 }
```

- **It is a delta, not a seat.** The layout still runs and the element keeps its
  place in the reading order, so the nudge survives edits that re-flow the
  drawing.
- **It re-flows nothing.** A diagram with hints is the diagram without them plus
  the hints: nudging one box never moves another or re-routes a flow that does
  not touch it. What does follow are the flows on the moved element — carried,
  re-aimed and re-seated so two terminals never land in the same place.
- **A container carries its children**, and a child's own `offset:` adds to its
  container's. A child is **held inside** its container, and an offset cut short
  that way is **W0573** — the one case a hint is negotiated rather than honored.
  Nudge the container when the whole group belongs elsewhere.
- **An offset past the top-left corner slides the whole canvas** rather than
  being clamped, so the delta always stands.

Reach for `order:` first: an offset big enough to change the reading sequence
means the *band* is wrong, and `order:` survives edits an offset merely rides
along with.

**An offset is honored, never negotiated** (INVARIANTS §17), containment aside.
An element landed on another, or a label on an element, still ships as asked and
the collision is reported as **W0572**.

#### `size: <dw>, <dh>` — resize a container

`dw` is wider, `dh` is taller; either may be negative. Anything but a pair of
whole numbers is **E0110**. This is what the playground writes when you drag a
container's resize grip.

```cairn
system SYS "My system" {
  size: 120, 40
  layer FRONT "Front office" { block PORTAL "Portal" }
}
```

- **Containers only**, and a container means something *drawn* as one. A leaf
  box is sized by the label in it, so a delta there would argue with the one
  thing that decides it — **E0226**. A container kind holding nothing is the
  same case: with no children the layout gives it a plain box sized by its own
  label, so it is **E0226** too. Change how tightly every box hugs its text with
  `label-padding:` in `style` instead.
- **It is a delta, not a box.** elk still sizes the container from what it
  holds, so the hint survives adding a child rather than pinning a number the
  drawing has outgrown.
- **The top-left corner is the anchor.** Room opens to the right and down, and
  the children inside do not move. Dragging the north or west grip in the
  playground writes an `offset:` for the corner and a `size:` for the rest.
- **It re-flows nothing**, like every other hint: the neighbours stay where they
  are, and a container grown onto one is drawn as asked with the overlap
  reported as **W0572**.
- **Shrinking closes the gaps inside.** A container is sized to hug what it
  holds, so its border has no slack of its own — the room is between its
  children, and a negative `dw` takes it from there. Every empty band gives up
  the same proportion, so the group tightens evenly; the children keep their own
  size and their reading order, and never end up closer than 20px. Once the
  bands are gone the shrink stops and reports **W0575**.
- **Growing is not limited at all.** A container enlarged past the one that
  holds it makes *that* one grow, by just enough to keep holding it, and on up
  the chain. Nothing is reported — a container is whatever is big enough for
  what is in it, so this is the frame following its content, not a hint being
  negotiated.

#### `label-offset: <dx>, <dy>` — nudge a flow's label

```cairn
CAPTURE -> EVENTS "Order created" { label-offset: 12, -6 }
```

Measured from the seat the label had on its run, so it tracks the flow rather
than the canvas. The label is then exempt from the renderer's overlap settling,
and **W0572** reports any overlap that costs. **It moves the label and nothing
else** — to move the flow, use `segment-offset:`.

#### `segment-offset: <run>, <delta>` — slide one run of a route

A route is a chain of horizontal and vertical runs. This moves one of them along
its **normal** — a vertical run left or right, a horizontal run up or down — and
touches nothing else, so the route keeps exactly the turns it went in with.

```cairn
CAPTURE -> EVENTS "Order created" { segment-offset: 2, -18 }
```

`run` counts from 1 along the route from its source, a *run* being one straight
line as the reader sees it. `delta` is right for a vertical run, down for a
horizontal one, and may be negative. This is what the playground writes when you
drag a run.

**Repeat the key to move more than one run** — the only inline property that may
appear twice in a block:

```cairn
CAPTURE -> EVENTS "Order created" { segment-offset: 2, -18 segment-offset: 4, 12 }
```

- **A run carrying a terminal stops at its element side.** Its normal points
  along the side the flow attaches to, so sliding it slides the seat. The delta
  is cut short just inside the corner and reported as **W0573**. Interior runs
  are unbounded.
- **Run numbers are positional.** A route that gains or loses a turn renumbers
  everything after it, and a `segment-offset` naming a run that no longer exists
  is **W0574** rather than silently dropped. Re-slide it in the playground and
  the number is rewritten for you.

Applied after the layout and every routing pass: the router owns the route's
*shape*, you own where each run sits. A `label-offset:` on the same flow still
adds on top.

Reach for `ID.side` or an element `offset:` first — a run needing a large slide
usually wants a different attachment side.

#### `ID.side` — which side a flow attaches to

Written on either endpoint, independently. Sides are named as the diagram is
*read* — `left`, `right`, `top`, `bottom` — not relative to the flow direction,
so a diagram authored for `wide` may want different pins under `tall`.

```cairn
POSTING.bottom -> LEDGER_DB.top (JDBC)
```

- A declared ID always wins over a side reading (`.` is a legal ID character),
  and the dropped side is reported as **W0571**. When several readings are
  possible the longest declared ID is the element: `A.producer` declared is that
  element, not `A` plus a role.
- An unknown side name is **E0223**.
- A pin is a request: one the layout cannot reach is dropped rather than forced
  into an unreadable route, and reported as **W0570**.
- A pin fixes the two ends, not the path between them. Pin one end and the other
  is still re-aimed as usual.

**This is what the playground writes when you drag a flow's end.** Hover either
end and the point it meets its element shows as a circle; drag it to another
side and `APP -> DB` becomes `APP.top -> DB`. An endpoint that already names a
side has that word replaced, not appended. An endpoint naming a role
(`CAPTURE.producer`) offers no handle — the side goes on by hand there, as a
second suffix (`CAPTURE.producer.top`).

#### A queue's flows are sided for you

Everything published *into* a `queue` attaches on its **left** cap, everything
read *out of* one leaves on its **right** — in every disposition, since a queue
is drawn as a cylinder on its side. Nothing to declare:

```cairn
queue EVENTS "Order event bus"

CAPTURE -> EVENTS (MQ, JSON)    # producer — left cap
EVENTS  -> INDEXER (MQ, JSON)   # consumer — right cap
```

Two limits. **Your pin wins:** name a side yourself (`CAPTURE -> EVENTS.top`)
and that endpoint is yours. And **it is a preference, not a pin:** a producer
the layout draws to the right of its queue attaches on the near side instead,
with nothing reported, since you declared nothing. Pin it by hand if you want
the side regardless.

#### `ID.producer` / `ID.consumer` — which side of the exchange

Written in the side-pin slot, on the element *opposite* the queue. It names a
relationship, not a geometry: `producer` puts the flow on the queue's left cap,
`consumer` on its right.

```cairn
CAPTURE.producer -> QUEUE_NOTIF (AMQP)
INDEXER.consumer -> QUEUE_NOTIF (AMQP)
```

Both arrows point **at** the queue. The arrowhead stays on the queue for both:
what you wrote is what is drawn.

Roles are optional — writing the arrow the way the data runs
(`QUEUE_NOTIF -> INDEXER`) lands on the same cap. They exist for diagrams drawn
as *dependencies*, where every arrow points at the thing it talks to and
direction alone cannot say who publishes and who reads. A role may sit on either
endpoint: `QUEUE_NOTIF -> INDEXER.consumer` meets the same right cap.

The flow matrix exports what you wrote, so a consumer drawn at the queue is
tabulated `INDEXER → QUEUE_NOTIF`. If the table matters more than the picture,
draw that flow the way the data runs.

Three rules: the other end must be a queue (**E0224**); the queue end must not
also carry a side (**E0225**); an unknown suffix is **E0223**.

#### Suffixes accumulate

A side and a role answer different questions — the side is where the flow
leaves *this* element, the role which cap it meets on the queue — so one
endpoint may carry both, in either order:

```cairn
CLIENT.producer.top -> Q_MYQUEUE (AMQP)   # leaves CLIENT's top, meets the left cap
CLIENT.top.producer -> Q_MYQUEUE (AMQP)   # the same flow
```

Two suffixes of the *same* kind (`A.top.bottom`, `A.producer.consumer`) are a
contradiction: the first stands and the second is **E0227**. A declared ID still
wins over the whole reading, however many dots it has (**W0571**), and the
playground offers no drag handle on an endpoint naming a role — it writes
`ID.side` only, and appending to a role is a hand edit.

#### Arrow glyph — the flow's line style

`->` solid (default), `-->` dashed, `..>` dotted. An inline `{ stroke: dashed }`
beats the glyph, which beats the diagram-level `flow-stroke`.

```cairn
ROUTING --> SETTLE (MQ, JSON)          # dashed
ROUTING ..> SCHEME (ISO8583)           # dotted
M2 --> M4 (MQ, JSON) { stroke: solid } # inline wins: solid
```

The legend states the reading, in the view's own vocabulary, and only for a
diagram that uses more than one style:

| Glyph | Logical | Application | Infrastructure |
|---|---|---|---|
| `->` solid | direct exchange | synchronous call (request / response) | permanent link — nominal traffic |
| `-->` dashed | asynchronous or event-driven exchange | asynchronous exchange (message, event) | asynchronous or intermittent link |
| `..>` dotted | dependency — no data exchanged | dependency — no direct call | dependency — outside nominal traffic |

Nothing enforces the reading: the parser records a style and the renderer draws
it. cairn defines these readings; they are not lifted from a standard.

#### Examples

Seven files in [`examples/placement/`](../examples/placement) show these
controls: `baseline.cairn` declares none, `sides.cairn` adds `ID.side` pins,
`reading-order.cairn` sequences two backends with `order:`, `flow-label.cairn`
moves a flow label, `queue-sides.cairn` declares nothing and takes the derived
queue sides, `queue-roles.cairn` draws every flow *at* the queue with roles, and
`queue-roles-sided.cairn` adds a side to each of those roles.

### Logos

**`logo: <name>` marks the technology a component runs on.** A statement in the
element body, like `order:` — content, not cosmetics, so it lives outside the
`style` block.

```cairn
module WEB "Web client" { logo: react }
datastore ORDER_DB "Order store" { logo: postgresql }
module BILLING "Billing" { logo: "./logos/acme.svg" }
```

Application view only, and only on the kinds that stand for running software:
`application`, `module`, `queue`, `datastore`, `external`. An `actor` is a
person, a `system` is a grouping, and `gateway`, `auth` and `idp` already use
that corner for their glyph — none of them takes one (**E0108**).

A bare name comes from the built-in set — `cairn logos` lists them, and an
unknown one is **E0107** with a suggestion. A quoted value is a path **relative
to the `.cairn` file**, in `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`, up to
256 KB. A URL is refused (**E0105**); a file that is missing, oversized or of an
unsupported type is **W0580** and the diagram renders without the mark.

The mark is drawn top-right, opposite the kind glyph, in the node's own stroke
colour. File-sourced logos resolve in the CLI only — the playground has no
filesystem and renders built-ins.

## 2. Styling — three levels, most specific wins

View defaults → diagram `style` block → inline per element or flow. Values are
disambiguated by shape: `#hex` is a colour, a keyword is a line style, a number
is a width. Two values of the same type (`dashed dotted`) is a diagnostic.

```cairn
style {
  theme: light                 # light | dark | slate | sand | contrast | nord |
                               #   solarized | classic | classic-dark (see Themes below)
  accent: #4c6ef5              # retints the flows on top of the theme
  background: #ffffff          # canvas colour (defaults to the theme's)
  lang: en                     # en | fr — localizes rendered chrome only
  disposition: wide            # wide | tall | slide | page
  crossing-hops: on            # on | off — arcs where lines cross
  compact: off                 # on | off — tighter spacing between elements
  arrows: normal               # normal | large
  legend: auto                 # auto | off
  flow-text: full              # full | numbered
  flow-label: above            # on-line | above | below
  flow-color: none             # none | by-source — one hue per source element
  flow-stroke: solid #444 1.3
  fill actor-group: #eef4fb    # per-kind fill
  stroke actor-group: #7a9cc4 dashed
  text block: #222233          # per-kind label colour
  font: "Helvetica" 11         # family and size together
  font-size: 11                # size alone
  label-wrap: 14               # characters per line, element and container labels
  flow-label-wrap: 10          # characters per line, flow labels
  container-padding: 4         # px inside a container: left, right, bottom
  label-padding: 4             # px either side of a node label
}

block COM_CTR "Central communication module" {
  style { fill: #fff7e6  stroke: #b08d2a dashed 1.5  text: #5a4a10 }
}
COM_CTR -> OBS "Alerts…" { label: below  stroke: dashed #a33  text: #a33 }
```

Those 22 keys are the whole diagram-level set; an unknown one is **E0104**.

**Dispositions.** `wide` is elongated horizontal (the default) — actors left,
externals right. `tall` is elongated vertical. `slide` targets 16:9 and `page`
targets A4 portrait; for those two the orientation is a hard constraint and the
winning candidate is the one that maximises scale-to-fit on the physical target,
so the build prints `fits 16:9 slide at 91% (labels ≈ 9.5px)`. Labels below
about 7px raise **W0520**: the diagram exceeds the medium and wants splitting.

**`flow-text: numbered`** puts a number badge on each arrow and moves the full
descriptions and business-object chips to a table below the canvas —
recommended for very large diagrams.

**Colours.** [`theme`](#themes) picks a palette, `background` overrides the canvas,
`accent` retints the flows, and `flow-color: by-source` gives every source
element its own hue. `fill`, `stroke` and `text` work per diagram, per kind
(`fill block: …`) or inline; a per-flow inline `{ stroke: … }` wins over
everything. Several may share a line: `{ fill: #a stroke: #b text: #c }`.

**`lang: fr`** switches rendered chrome to French (`FLUX`, `OBJETS MÉTIER`,
`LÉGENDE`, kind names, matrix headers). DSL keywords stay English so sources
stay portable.

Styles never affect semantic validation, but a style value is still range
checked.

### Density controls

Four opt-in properties trade whitespace for compactness. They compose with
`compact: on` rather than replacing it — `compact` tightens the space *between*
elements, these four work inside a box or inside a label. Out of range is
**E0103**, reported rather than clamped.

| Property | Unit | Governs |
|---|---|---|
| `label-wrap: <n>` | characters, ≥ 1 | breaks element and container labels onto `n`-character lines |
| `flow-label-wrap: <n>` | characters, ≥ 1 | breaks flow labels; also spelt inline on one flow |
| `container-padding: <n>` | pixels, ≥ 0 | room inside a container: left, right, bottom |
| `label-padding: <n>` | pixels, ≥ 0 | room either side of a node label |

**Nothing wraps a label unless you ask.** Unset, a long name widens its box and
the only line breaks are the ones you typed with `\n`.

**Both wraps break between words, never inside one.** A single token longer than
`n` is left intact, so `PCC_DONNEES_TPS_REEL` stays on one line however small
`n` gets — to the wrap it is one word. Split a long identifier with `\n`
yourself.

**A single flow may name its own wrap**, and the inline one wins:

```cairn
A -> B "publishes every case-file status change as an event" (AMQP) {
  flow-label-wrap: 10
}
```

Reach for that before lowering the diagram's: one long label is the usual reason
to wrap at all, and wrapping the whole drawing to suit it costs every other
label its line. The two properties stay separate because they want different
numbers — a flow label reads at roughly 10–14 characters, an element label wants
more.

**`container-padding:` covers three sides, not four.** The top holds the
container's own title, so its depth tracks the label.

**`label-padding:` also drops the uniform minimum node width**, which is what
most boxes actually sit on. Boxes then stop being a uniform width: each hugs its
own label. Reach for `label-wrap` first if the diagram is wide because of one
long name.

Two things never follow `label-wrap`: an element with no label keeps falling
back to its ID (**W0502** stays), and the flow matrix flattens newlines back to
spaces, because a table cell is one line.

`examples/application-tech-stack-large-dense.cairn` and
`examples/flow-labels-long-wrapped.cairn` are the plain models with these turned
on — rendering both pairs is the quickest way to see what they buy.

### Themes

`theme:` is the one style property whose values are defined outside the DSL:
the DSL names a palette, the palette itself is built in or comes from JSON.

**Nine built-ins**, listed by `cairn themes`: `light` (the default), `dark`,
`slate`, `sand`, `contrast`, `nord`, `solarized`, plus the legacy `classic` and
`classic-dark`.

**Three ways to select one**, most specific wins:

```text
style { theme: nord }                          # in the diagram
cairn build my-system.cairn --theme nord       # CLI — overrides the diagram
compile(source, { theme: "nord" })             # embedder
```

The flag applies after parsing and works on `build`, `matrix` and `watch`. A
theme that cannot be resolved is an error, never a silent fallback.

#### A palette of your own

Custom palettes are **not DSL syntax** — a JSON file for the CLI, or an object
for `compile()`:

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

A spec **extends a built-in and overrides only what it names**, so a usable
theme is a few keys rather than a full palette. Four optional keys:

| Key | Holds | Notes |
|---|---|---|
| `extends` | a built-in to inherit from | defaults to `light`; **not** `classic` / `classic-dark`, which are aliases rather than specs |
| `dark` | `true` \| `false` | whether the palette sits on a dark ground. Selects the flow colour set, and **cannot be inferred** — a dark palette omitting it draws light flow hues |
| `pal` | canvas and chrome colours | `bg`, `text`, `sub`, `muted`, `cFill`, `cStroke`, `nFill`, `nStroke`, `edge`, `div`, `halo`, `aStroke`, `aText`, `chip`, `badge` |
| `accentColors` | per-kind fills and strokes | stroke/fill pairs, the fill suffixed `F` (`blue`/`blueF`, `amber`, `app`, `gold`, `violet`, `red`, `purple`, `green`, `node`, `auth`, `idp`, `fw`, `authn`); `siteS`/`siteF`, `leafS`/`leafF`, `aiS`/`aiF`, `serverS`/`serverF` suffix the stroke `S` |

Merging is one level deep: naming `pal.bg` leaves every other `pal` entry
inherited. `pal.chip` (`[fill, stroke, text]`) and `pal.badge` (`[fill, stroke]`)
are replaced whole and must carry exactly that many colours.

A colour is hex (3, 4, 6 or 8 digits), an `rgb()`/`rgba()` or `hsl()`/`hsla()`
call in either the comma or slash form, or a CSS keyword (`rebeccapurple`,
`transparent`, `currentColor`) — wider than the DSL itself, where a colour is
always `#hex`.

Anything else is rejected **at load time**, by name: `ThemeSpecError` (wrapped
by the CLI as `ThemeFileError` with the file path) names the offending key.

**The CLI registers the file under its basename** (`my-theme.json` →
`my-theme`). `classic`, `classic-dark`, `__proto__`, `constructor` and
`prototype` are reserved and rejected.

**An embedder passes the object instead**, used for that call and forgotten — so
a server rendering for many callers cannot leak one caller's colours into
another's diagram:

```js
import { compile, resolveThemeSpec } from "@r0kshan/cairn";

const { svg } = await compile(source, {
  theme: { extends: "dark", dark: true, pal: { bg: "#0d1117" } },
});
```

`resolveThemeSpec()` validates a palette up front and throws the same error. A
complete example ships in
[`examples/themes/midnight.json`](../examples/themes/midnight.json).

## 3. Flow matrix

> A standard French EA deliverable — the *matrice des flux techniques* —
> produced natively from the DSL.

```sh
cairn matrix my-system.cairn --format csv|md|svg
```

One row per flow. **Every view exports one**, with the columns its flows can
fill and its own container kind annotating endpoints, as `Name (Zone)`. An
endpoint outside any container is listed by name alone.

| View | Columns | Endpoint annotated with |
|---|---|---|
| `infrastructure` | No. · Source · Destination · Protocol · Port · Flow | `network-zone`, `site` |
| `application` | No. · Source · Destination · Protocol · Flow | `application`, `system` |
| `logical` | No. · Source · Destination · Flow | `layer`, `system` |

`csv`/`md` give an editable table for the dossier; `svg` a theme-aware,
paste-ready image. Headers follow `style { lang }` — under `lang: fr` the
infrastructure headers read **N° · Source · Destination · Protocole · Port ·
Nature du flux**. Output defaults to `<file>.flow.<ext>`.

Embedders get the same table as data: `compile(source, { matrix: true })`
returns `columns` plus one `row` per flow, and the `matrixCsv` / `matrixMd` /
`matrixSvg` exports format it exactly as the CLI does.

## 4. Diagnostics

Every issue carries a stable code — `E01xx` syntax, `E02xx` semantic, `W05xx`
warning. `cairn explain <CODE>` gives the rationale behind any rule
(`cairn explain E0240`). Full catalog: [`DIAGNOSTICS.md`](DIAGNOSTICS.md).

## 5. Not in the language

Imports across files, variables, and longhand style properties
(`stroke-color:` …) are deliberately absent.

Custom themes stay a CLI parameter or a `compile()` option rather than DSL
syntax ([Themes](#themes)): reading a file from the parser would put filesystem
work into a core that must also run in the playground.
