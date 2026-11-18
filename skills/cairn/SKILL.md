---
name: cairn
description: Write, validate and render enterprise-architecture diagrams with the cairn DSL (.cairn files) — logical, application and infrastructure views, plus the flow matrix (matrice des flux techniques). Use when the user asks for an architecture logique, applicative or physique / infrastructure diagram, a flow matrix, or wants to create, fix or extend a .cairn file.
license: Apache-2.0
metadata:
  cairn-version: "1.0.0-RC18"
---

# cairn

cairn turns a small text DSL into typed architecture views rendered as SVG,
with no overlapping labels and a deterministic layout. One `.cairn` file is one
diagram, and its first line picks the view:

```text
diagram <logical|application|infrastructure> "Title"
```

The view decides which element kinds the file may use and what a flow must
carry. Breaking a rule produces a coded diagnostic, so **the compiler is your
reviewer**: write, validate, fix, build — never hand back a file you have not
run through `cairn validate --strict`.

## 1. Get a working `cairn`

Use the first that works:

1. `cairn version` — an installed binary (Homebrew, Scoop, curl installer).
2. `npx -y @r0kshan/cairn@unstable version` — zero-dependency npm package.
   Prereleases publish to the `unstable` dist-tag, so plain `@r0kshan/cairn`
   may resolve to an older release that lacks kinds this skill uses.

The installed version must be **at least the `cairn-version` in this file's
front matter**. If it is older, say so and use the npx form. Below, `cairn`
means whichever command worked.

## 2. Pick the view

| The user wants… | View | French dossier name |
|---|---|---|
| what the system **does**: actors, functional blocks, business objects, no technology | `logical` | Architecture logique (fonctionnelle) |
| which **applications** exist and the **technical exchanges** between them | `application` | Architecture applicative |
| **where it runs**: sites, network zones, servers, clusters, protocols and ports | `infrastructure` | Architecture physique / d'infrastructure |
| the table of flows for a dossier | any view, then `cairn matrix` | Matrice des flux (techniques) |

One request often needs several views of the same system. Write **one file per
view**, keep the same IDs and names for the same thing across them (the
application `ORDER_APP` is the infrastructure `app-instance ORDER_APP`), and
build each one. There are no imports across files.

If the request does not say which view, or mixes levels ("show our
microservices and the firewalls"), ask once — or, if you can't ask, pick the
view that matches most of what was described and say which one you chose.

## 3. Write the file

Read [references/dsl.md](references/dsl.md) before writing your first file in
a session: it has the grammar, every kind per view, and the nesting rules. Then
apply [references/modeling.md](references/modeling.md) — the conventions that
make a view read well in an architecture document.

The rules that cause most errors:

- **Whitespace around the arrow**: `A -> B`, never `A->B` (`-` is a legal ID
  character).
- **Logical**: every flow has a label (E0203), no technical tail; business
  objects ride as `[BO_ID]`. `actor` lives in an `actor-group`, `block` in a
  `layer`, `system` or `external`, `layer` in a `system`.
- **Application**: give every flow between two non-actors a tail —
  `(API_REST, JSON)`, `(JDBC)`, `(MQ, JSON)` — or it warns (W0540). `module`
  lives in an `application`. No business objects (E0222).
- **Infrastructure**: every flow carries `(PROTOCOL/PORT)` — `(HTTPS/443)`,
  `(TCP/5432)`, `(LDAPS/636)` — even with no label (E0240). `actor` sits at the
  root (no `actor-group`); `network-zone` sits in a `site` or another zone,
  `server` and `cluster` in a zone or site, `app-instance` in a `server`, zone
  or cluster.
- **Every leaf must be reached by a flow** (W0510), and every element needs a
  quoted label (W0502). Break long labels with `\n`.
- **`logo:`** exists in the application view only, on `application`,
  `module`, `queue`, `datastore`, `external`. Check names with `cairn logos`;
  don't guess.

To start from a valid skeleton instead of a blank file:
`cairn new -L|-A|-I <file.cairn>` (logical, application, infrastructure).

## 4. Validate and fix — loop until clean

```sh
cairn validate my-view.cairn --strict --format json
```

Exit code `0` means clean. Otherwise each diagnostic has a `code`, a `span`
(line, column), a `help` line and often a machine-applicable `fix`. Fix every
**error and every warning** — warnings in cairn are modelling problems, not
noise. For any code you don't recognise, run `cairn explain <CODE>`; the common
ones and their fixes are in [references/diagnostics.md](references/diagnostics.md).

Only keep a warning if it is genuinely intended (e.g. W0540 on a deliberately
functional-only application view) and say so to the user.

## 5. Build and check readability

```sh
cairn build my-view.cairn -o my-view.svg
```

The build prints `label overlaps: N`. **Aim for 0.** If it isn't 0, or the
diagram is very wide, see the density section of
[references/modeling.md](references/modeling.md) — usually `flow-text:
numbered`, a `disposition`, or splitting the view — before reaching for manual
positioning.

For a slide or an A4 page set `style { disposition: slide }` or
`style { disposition: page }`; the build then reports the scale it fits at, and
W0520 means the view is too dense for that medium and should be split.

## 6. The flow matrix

```sh
cairn matrix my-view.cairn --format csv   # or md, svg; -o to choose the path
```

One row per flow, endpoints annotated with their zone (infrastructure),
application or system (application), layer or system (logical). Default output
is `<file>.flow.<ext>`. Add `style { lang: fr }` to the diagram for French
headers and chrome (`N° · Source · Destination · Protocole · Port · Nature du
flux`); DSL keywords stay English either way.

## 7. Hand back

Give the user the `.cairn` source (it is the deliverable — the SVG is
regenerated from it), the SVG, and the matrix if asked. Mention any warning you
deliberately kept and any assumption you made about the system (a zone, a
protocol, a port) so they can correct it.

## Don't

- Don't invent syntax: no imports, variables, `stroke-color:`-style longhand,
  or kinds outside the view's list — they are errors, not extensions.
- Don't put technology in a logical view or business objects outside it.
- Don't merge flows: `A -> B` and `B -> A` are two arrows, by design.
- Don't reach for `offset:` / `segment-offset:` to fix a layout before trying
  `order:`, `ID.side` pins, a disposition or `flow-text: numbered` — and never
  add them to a file the user will keep editing unless they asked for that
  placement.
