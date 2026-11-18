# Modelling a view that reads well

cairn checks the syntax and the view's rules. These conventions are what make
the result useful in an architecture document (dossier d'architecture, SAD).

## One question per view

Each view answers one question for one audience. Mixing levels is the most
common reason a diagram stops being readable.

| View | Answers | Audience | Leave out |
|---|---|---|---|
| logical | *What does the system do, for whom, with which data?* | business owners, project leads | products, protocols, servers |
| application | *Which applications, and how do they talk?* | solution architects, dev leads | network zones, hosts, ports |
| infrastructure | *Where does it run, and what crosses which boundary?* | infrastructure, security, ops | functional decomposition |

Typical progression for a dossier: logical → application → infrastructure,
each with its flow matrix. The same thing keeps the same ID and name across
the three files so the matrices can be cross-referenced.

## Logical view

- **Blocks are functions, not applications.** "Slot management", not
  "BookingService". If a block's name is a product, it belongs in the
  application view.
- **Layers are functional areas** (channels, business management, referential
  data, reporting), not technical tiers (front / back / DB).
- **Flow labels are verb phrases** naming the exchange: "Booking request",
  "Sends invoice", not "data" or "call".
- **Business objects** (objets métier) are the nouns that circulate: declare
  each once with a short description and attach it to every flow carrying it.
- **`security`** names a capability the business can feel — strong
  authentication, anonymisation, encryption of a held record — and must be on a
  flow path. It is not an `auth` component.
- **External systems** are grouped in one or a few `external` containers
  holding `block`s for each partner function.

## Application view

- **`application` = one deployable unit**, `module` = a component inside it.
  Don't use modules for separate deployables.
- **`system`** is an optional boundary (the platform or domain under study);
  use one when there are applications outside it.
- **Tails carry the technology**: `(PROTOCOL, FORMAT)`. Omit the label unless
  it adds meaning the tail doesn't ("Order created" on an event).
- **Synchronous vs asynchronous** is the arrow: `->` for a request/response
  call, `-->` for messages and events, `..>` for a dependency with no direct
  call. The legend explains the convention only if more than one style is used.
- **Queues and datastores are first-class**: draw the broker and the database
  rather than a direct arrow between producer and consumer.
- **`idp` vs `external`**: an identity provider you run is an `idp`; one a
  third party owns (FranceConnect, a SaaS IdP) is an `external`.
- **Logos** are content (the technology), not decoration. Use `cairn logos`
  for valid names.

## Infrastructure view

- **Declare sites and zones in traffic order**: internet → DMZ → internal →
  data/admin zones. Layout follows declaration order.
- **Every flow names its protocol and port**: `(HTTPS/443)`, `(TCP/5432)`,
  `(LDAPS/636)`, `(SFTP/22)`. Unknown port? Ask, or use the protocol's
  standard port and tell the user you assumed it.
- **Redundancy is a `cluster`**: an HA pair or a Kubernetes node pool is a
  cluster holding its members, not one server box.
- **`load-balancer` ≠ `gateway`**: a load balancer picks one backend of N; a
  gateway / reverse proxy terminates and forwards.
- **A WAF is a `firewall`**, wherever it physically runs.
- **Show the barrier the traffic crosses**: flows entering a more internal zone
  should go through the firewall / reverse proxy that guards it, not around it.

## Density: keeping a big view readable

Check `label overlaps:` in the build output and the SVG size. In order:

1. **Split the view** if it mixes concerns or exceeds ~30–40 flows: one view
   per subsystem or per zone is usually clearer than one giant drawing.
2. `style { flow-text: numbered }` — arrows get number badges and the full
   descriptions move to a table under the canvas. Best single lever for dense
   views.
3. `style { disposition: tall }` (or `slide` / `page` for a fixed medium).
4. `style { compact: on }`, `label-wrap: 14`, `flow-label-wrap: 12`, or a
   per-flow `{ flow-label-wrap: 10 }` for the one long label.
5. `order:` on elements, then `ID.side` pins on flows.

Pixel hints (`offset:`, `segment-offset:`, `label-offset:`, `size:`) are last
and belong to the user.

## Naming

- IDs: `UPPER_SNAKE`, stable, meaningful (`ORDER_DB`, not `DB1`) — they appear
  in diagnostics and are what the user edits.
- Labels: short, the reader's vocabulary, `\n` to break a long name over two
  lines. Keep the user's language: a French dossier gets French labels and
  `style { lang: fr }`.
