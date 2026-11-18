---
name: cairn
description: Write, fix or render cairn architecture diagrams (.cairn files) — logical, application and infrastructure views, flow matrix export. Use when the user asks for a cairn diagram, a .cairn file, or an architecture view/flow matrix built with cairn.
---

# Writing cairn diagrams

cairn is a diagram-as-code CLI. One `.cairn` file is one diagram; its first line picks the view. Never guess syntax: the CLI scaffolds, validates and explains.

## Loop

1. `cairn new -L|-A|-I diagram.cairn` — logical, application or infrastructure. The template is a valid, commented example of that view: read it, then edit it.
2. `cairn validate diagram.cairn --format json` — every diagnostic has a code, a line and usually a `help` fix.
3. `cairn explain <CODE>` for any rule you don't understand. Repeat 2–3 until 0 errors. Fix warnings too unless the user doesn't care.
4. `cairn build diagram.cairn` (SVG). `cairn matrix diagram.cairn --format csv|md|svg` for the flow table.

If a requirement has no syntax below and no template example, check the spec before inventing one. If the spec says it doesn't exist, tell the user instead of approximating it.

## Grammar

```text
<kind> <ID> "<Label>" { children, order:, logo:, style { … } }   # element; one ID pool per file, business objects included
<ID> -> <ID> "<label>" (TECH) [BO_REFS] { label: below }          # flow; space before the arrow
```

- Arrow = line style: `->` solid, `-->` dashed, `..>` dotted. Pin a side: `A.right -> B.left`.
- `\n` in a label breaks the line. `#` starts a comment.
- `legend { note "…" }` adds a line to the legend.

## Views

| View | Kinds | Flow rule |
|---|---|---|
| `logical` | actor-group > actor; system > layer > block; security; external > block | label **required**; no `(TECH)`; `business-object ID "Name" "desc"` then `[ID]` on flows (logical only) |
| `application` | actor-group > actor; system; application > module; gateway, auth, idp, queue, datastore, external | label optional; `(PROTOCOL, FORMAT)` between non-actors, e.g. `(API_REST, JSON)` |
| `infrastructure` | actor, device (root, no actor-group); site > network-zone > cluster/server > app-instance; queue, datastore, gateway, load-balancer, firewall, auth, idp, external | `(PROTOCOL/PORT)` **required**, e.g. `(HTTPS/443)` |

`logo: postgresql` (`cairn logos` lists names) works **only in the application view**, on application, module, queue, datastore and external.

## Diagram-level `style { … }` keys worth knowing

One block at the root of the file, keys separated by spaces or newlines: `style { lang: fr  flow-text: numbered }`.

`lang: fr` (French chrome; keywords stay English) · `flow-text: numbered` (number badges, labels moved to a table) · `theme: dark` (`cairn themes`) · `disposition: wide|tall|slide|page` · `flow-label: on-line|above|below` · `compact: on` · `legend: off` · `fill <kind>: #hex`.

## Full reference

https://github.com/R0kshan/cairn/blob/main/documentation/DSL_SPEC.md (positioning hints, every style key, themes) and https://github.com/R0kshan/cairn/blob/main/documentation/DIAGNOSTICS.md (every code).
