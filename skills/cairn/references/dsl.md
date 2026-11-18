# cairn DSL — reference for writing a view

Condensed from the full spec, `documentation/DSL_SPEC.md`
(<https://github.com/R0kshan/cairn/blob/main/documentation/DSL_SPEC.md>). When this page and the spec
disagree, the spec — and `cairn validate` — win.

## Grammar shared by every view

```text
diagram <logical|application|infrastructure> "Title"   # first line, once

<kind> <ID> "<Label>" { …children and statements… }    # element
<ID> -> <ID> "<label>" (TECH) [BO_REFS] { inline }     # flow
```

- **IDs** are flat and unique per file (elements and business objects share
  the pool): letters, digits, `_`, `-`, `/`, `.`. Use `UPPER_SNAKE`.
- **Labels** are `"quoted"`; `\n` breaks a line. Every element gets one.
- **Comments** start with `#`.
- **Arrows**: `->` solid, `-->` dashed, `..>` dotted. Whitespace before the
  arrow is required.
- **Everything after the arrow is optional**, within the view's rules: a
  `"label"`, a technical tail, `[BO_REFS]` (logical only), an inline `{ … }`.
- **Element body** may hold child elements and the statements `order: n`,
  `offset: dx, dy`, `size: dw, dh` (containers), `logo: name` (application
  view) and `style { fill: #hex stroke: #hex text: #hex }`.
- **Order is free** after the first line. Convention: style, elements, business
  objects, flows, legend.
- `legend { note "…" }` adds a line to the legend band.

## Kinds per view

| View | Kinds |
|---|---|
| `logical` | actor-group, actor, system, layer, block, external, security |
| `application` | actor-group, actor, system, application, module, gateway, auth, idp, queue, datastore, external |
| `infrastructure` | actor, device, site, network-zone, cluster, server, app-instance, queue, datastore, gateway, load-balancer, firewall, auth, idp, external |

Any other kind is E0201 (with a did-you-mean).

## Logical view — `diagram logical`

What the system does. No technology, no deployment.

| Kind | Stands for | Must sit in |
|---|---|---|
| `actor-group` | a population of roles (container) | root |
| `actor` | one role or person | an `actor-group` (E0211) |
| `system` | the system under study (container) | root |
| `layer` | a functional layer (container) | a `system` (E0212) |
| `block` | one functional block | a `layer`, `system` or `external` (E0210) |
| `security` | a security capability the business feels (strong authentication, anonymisation…) | anywhere |
| `external` | third-party systems (container) | root |

Flows: **label required** (E0203), **no tail**. Business objects are declared
once and carried by flows:

```text
business-object BO_APPT "Appointment" "slot booked with a practitioner"
PORTAL -> SCHEDULER "Booking request" [BO_APPT]
```

A business object no flow carries warns (W0530); a file with no `actor` warns
(W0501).

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
```

## Application view — `diagram application`

Which applications exist and the technical exchanges between them.

| Kind | Stands for | Must sit in | `logo:` |
|---|---|---|---|
| `actor-group` | a population of roles (container) | root | no |
| `actor` | one role or person | an `actor-group` (E0211) | no |
| `system` | a boundary grouping applications (container, optional) | root | no |
| `application` | one deployable application (container of `module`) | root or a `system` | yes |
| `module` | a component of an application | an `application` (E0213) | yes |
| `gateway` | API gateway / reverse proxy | root or a `system` | no |
| `auth` | auth middleware | root or a `system` | no |
| `idp` | identity provider you run (self-hosted SSO) | root or a `system` | no |
| `queue` | message queue / broker | root or a `system` | yes |
| `datastore` | database / registry | root or a `system` | yes |
| `external` | third-party system (incl. an IdP someone else owns) | root | yes |

Flows: label optional and usually omitted. The **tail** `(PROTOCOL, FORMAT)` is
the interesting half — without a label it becomes the arrow's label. A flow
between two non-actors with no tail warns (W0540); actor flows are exempt.
Business objects are rejected (E0222). Typical tails: `(API_REST, JSON)`,
`(SOAP, XML)`, `(GRPC, PROTOBUF)`, `(JDBC)`, `(MQ, JSON)`, `(AMQP)`,
`(SFTP, CSV)`, `(OIDC, JWT)`.

A queue's flows attach automatically: published-into on its left cap,
read-from on its right. Write arrows the way the data runs.

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

CLERK    -> EDGE
EDGE     -> SSO (API_REST, JSON)
SSO      -> SSO_IDP (OIDC, JWT)
SSO      -> CAPTURE (API_REST, JSON)
CAPTURE  -> VALIDATE (API_REST, JSON)
VALIDATE -> ORDER_DB (JDBC)
VALIDATE -> EVENTS (MQ, JSON)
EVENTS   -> CARRIER (SFTP, CSV)
```

## Infrastructure view — `diagram infrastructure`

Where the software runs and how traffic reaches it. The view the matrice des
flux techniques is built from.

| Kind | Stands for | Must sit in |
|---|---|---|
| `actor` | a user | root (no `actor-group` in this view) |
| `device` | a client machine | root |
| `site` | site / data center (container) | root |
| `network-zone` | network zone — DMZ, LAN, admin… (container) | a `site` or another zone (E0216) |
| `cluster` | nodes that stand in for one another (container of `server`, `app-instance`, `datastore`) | a `network-zone` or `site` (E0217) |
| `server` | server / VM (container of `app-instance`) | a zone, site or cluster (E0214) |
| `app-instance` | a deployed application | a server, zone or cluster (E0215) |
| `queue`, `datastore` | broker, database | a zone, site (or cluster for datastore) |
| `gateway` | API gateway / reverse proxy | a zone or site |
| `load-balancer` | picks one backend out of a pool | a zone or site |
| `firewall` | firewall, WAF | a zone or site |
| `auth`, `idp` | auth middleware, identity provider | a zone or site |
| `external` | a partner system | root |

Flows: **protocol required** (E0240), one token `(PROTOCOL/PORT)`; label
optional. `(LDAPS)` with no port is allowed (Port stays empty in the matrix).
Sites and zones are laid out in **declaration order**, so declare them in the
order traffic crosses them (internet-facing first).

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

## Diagram-level style (the keys you will actually use)

```text
style {
  lang: fr                # en | fr — rendered chrome and matrix headers only
  disposition: wide       # wide (default) | tall | slide (16:9) | page (A4)
  flow-text: numbered     # full (default) | numbered — numbered badges + table
  compact: on             # tighter spacing between elements
  theme: light            # cairn themes lists them
  label-wrap: 14          # chars per line for element labels
  flow-label-wrap: 12     # chars per line for flow labels
}
```

An unknown key is E0104. Inline blocks on an element or flow take only `fill`,
`stroke`, `text`, `label` (on-line | above | below), and on flows
`label-offset`, `segment-offset`, `flow-label-wrap`.

## Positioning controls (only when the layout is wrong)

Try them in this order:

| Control | Where | Effect |
|---|---|---|
| `order: n` | element body | reading order within its band (lower first) |
| `A.right -> B.left` | flow endpoint | pin the side a flow attaches to (`left`, `right`, `top`, `bottom`) |
| `{ label: below }` | flow inline | put that flow's label below the line |
| `offset: dx, dy` | element body | nudge an element by pixels |
| `label-offset: dx, dy` | flow inline | nudge one flow label |
| `segment-offset: run, delta` | flow inline | slide one straight run of a route |
| `size: dw, dh` | container body | grow / shrink a container |

`offset`, `label-offset`, `segment-offset` and `size` are pixel hints — what
the playground writes when the user drags things. Leave them to the user.
