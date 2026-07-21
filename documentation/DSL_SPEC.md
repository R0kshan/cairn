# DSL Spec — v0.1

Design goals: D2-like terseness, typed elements (the view knows what an `actor` is), diagnostics-friendly (every token carries a source span), Git-friendly (meaningful diffs), styling fully overridable.

### DSL design decisions (D1–D4)

| Dec | Principle | Rationale |
|---|---|---|
| **D1** | Flat unique IDs | IDs are unique per file — no namespace nesting. Elements and business objects share one ID pool; duplicates produce a diagnostic with a rename suggestion. Flows get synthetic IDs (`F01`, `F02`…) during parsing and are excluded from ID-conflict checks. Keeps references simple (`A -> B`, not `parent.child.grandchild`). |
| **D2** | All-English keywords | Element kinds, style properties, and diagram keywords stay English even with `lang: fr`. Source files remain portable, diff-clean, and independent of the output language. |
| **D3** | Terse shorthand styles | The parser disambiguates values by shape (`#hex` = color, keyword = line style, number = width). Several properties may share one line (`{ fill: #a stroke: #b }`). Conflicting same-type values produce a diagnostic. |
| **D4** | Label placement lives in style | Flow-label position (`on-line`, `above`, `below`) is a `style` property, not a flow syntax flag. Applies per-flow via inline style or globally via the `style` block. Cleaner syntax and consistent with the three-level style resolution model. |

## 1. Structure

Keywords are English; labels are free text. Built-in diagram types: `logical`, `application`, `infrastructure`, `security`.

| View | Element kinds | Flow specifics |
|---|---|---|
| `logical` | actor-group, actor, system, layer, block, external | label required; business objects via `[REFS]` (**logical-view only** — a `business-object` in any other view is **E0222**) |
| `application` | actor-group, actor, application, module, queue (horizontal cylinder), datastore (cylinder), external | label **optional**; technical tail `(protocol, format)` **recommended on system-to-system flows (W0540**, actor flows exempt — C4 container-diagram practice); no business objects |
| `infrastructure` | site, network-zone, server, app-instance, queue (horizontal cylinder), gateway (shield hexagon), auth (lock badge), idp, external | label **optional**; protocol still required (**E0240**): `(HTTPS/443)`; zones band left→right in declaration order |
| `security` | trust-zone `(level)`, security-node, asset, actor-group, actor, external | label required; each `trust-zone` carries a sensitivity level `(public\|internal\|restricted\|secret)` (**E0250**); a flow entering a more-trusted zone without a `security-node` warns (**W0560**); cross-zone flows should state encryption (**W0561**); zones band exposed→protected in declaration order |

### Element nesting

Each view defines which element kinds are valid and how they can nest. Violations produce errors **E0210–E0218**.

| View | Allowed nesting (child → parent) |
|---|---|
| `logical` | `block` → `layer` / `system` / `external`; `actor` → `actor-group`; `layer` → `system` |
| `application` | `module` → `application`; `datastore` → root; `actor` → `actor-group` |
| `infrastructure` | `server` → `network-zone` / `site`; `app-instance` → `server` / `network-zone`; `network-zone` → `site` / `network-zone`; `gateway` / `auth` / `idp` → `network-zone` / `site` (convention, not enforced) |
| `security` | `asset` → `trust-zone`; `security-node` → `trust-zone`; `actor` → `actor-group` |

### Layout partitions

The layout engine assigns each element a semantic horizontal band (ELK partition). Elements within the same partition stay vertically aligned.

| View | Partitions (left → right) |
|---|---|
| `logical` | actor-groups (0) | systems (1) | externals (2) |
| `application` | actors (0) | applications / datastores (1) | externals (2) |
| `infrastructure` | sites / zones in declaration order (0) | externals (1) |
| `security` | zones in declaration order (exposed → protected) |

Flow syntax, full form: `A -> B : "label" (PROTOCOL, FORMAT) [BO_REFS] { inline style }` — every segment after the arrow is optional (subject to view rules). The `[BO_REFS]` segment is **logical-view only**. The technical tail renders as a smaller gray sub-line under the label; in `flow-text: numbered` mode it joins the flow table entry.

```
diagram logical "Display system — logical view"

# ---- elements ----
actor-group ZONE_CTRL "Role group - Central zone" {
  actor OBS  "Control agent\nMain zone"
  actor GE   "Functional and technical manager"
  actor TECH "Resource technicians, Main zone"
}

actor-group ZONE_STATION "Role group - Remote site" {
  actor OPE "Field operator\nRemote site"
}

system CENTRAL "Main infrastructure" {
  layer CTRL "Central control layer" {
    block COM_CTR   "Central communication module"
    block GST_DATA  "Data processing module"
    block CFG_SYS   "System configuration module"
    block SUIV_FLUX "Real-time activity tracking block"
  }
  layer SITE "Remote site layer" {
    block COORD    "Satellite coordination module"
    block COM_SITE "Local communication module"
    block COM_SAT2 "Satellite communication module"
    block AFF_DPT  "Remote display channels"
  }
}

external EXT "External resources" {
  block DISP     "External display infrastructure"
  block NET01    "Third-party broadcast network"
  block NET02    "Data export service"
  block COLLECT  "External data-collection infrastructure"
}

# ---- business objects ----
# Declared once; carried by flows via [REFS]. Rendered as a chip under the
# flow label + a registry band below the canvas (ArchiMate: association of a
# business object with a flow relationship = "what circulates").
business-object BO_MSG "Message" "information message broadcast to the sites"

# ---- flows ----
OBS  -> CTRL     : "Overall control"
GE   -> CFG_SYS  : "Configure the system"
COM_CTR -> OBS   : "Alerts, notifications and\nfeeds from various sources" [BO_MSG]

SUIV_FLUX -> COORD : "Broadcast of information and messages\nabout upcoming flows"
COORD -> SUIV_FLUX : "Forward the messages entered\nby staff present on site"
# ^ INVARIANT: every flow is a distinct arrow with its own label — flows are
#   NEVER merged. A<->B pairs get parallel-edge separation; labels must not overlap.

COLLECT -> SUIV_FLUX : "Forward external collection\ndata and events"

# ---- legend (optional) ----
# Auto-generated from the kinds/styles actually used, appended BELOW the
# canvas (zero impact on layout, excluded from the slide/page fit metric).
# `legend: off` in the style block disables it. Free entries:
legend {
  note "Named-data flows are subject to GDPR"
}
```

General form: `<kind> <ID> "<Label>" (<attr>)? { …children… }` for elements, `<ID> -> <ID> : "<label>"` for flows. The optional `(<attr>)` after the label carries a kind-specific attribute — currently the `trust-zone` sensitivity level in the `security` view, e.g. `trust-zone DMZ "DMZ" (public)`. `#` comments. `\n` for manual line breaks (auto-wrap is the default). IDs are flat and unique per file (duplicate → diagnostic with rename suggestion). Element kinds (`actor`, `block`, `layer`…) are declared by the active view — a C4 or AWS view brings its own kinds through the same grammar.

**Inline style restriction:** Per-element and per-flow `{ style { … } }` blocks only support four properties: `fill`, `stroke`, `text`, `label`. Diagram-level `style { … }` blocks support the full 13-property set (themes, disposition, flow-text, etc.). An unknown property inside an inline block produces diagnostic **E0104**.

## 2. Styling — three levels, most specific wins

View defaults → diagram-level `style` block → inline per-element/per-flow. Terse shorthand: the parser disambiguates values by shape (`#hex` = color, keyword = line style, number = width). Conflicting same-type values (e.g. `dashed dotted`) → diagnostic.

```
style {
  theme: light                 # light | dark — selects the default color palette
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
  legend: auto                 # auto | off — auto legend band below the canvas
  flow-text: full              # full | numbered
  #   full     : labels (and BO chips) ride on the arrows
  #   numbered : arrows carry a number badge only; full descriptions + chips
  #              move to a flow table below the canvas
  #              (recommended for very large diagrams)
  flow-label: above            # on-line | above | below
  flow-stroke: solid #444 1.3
  fill actor-group: #eef4fb    # per-kind fill
  stroke actor-group: #7a9cc4 dashed
  text block: #222233          # per-kind label/text color
  font: "Helvetica" 11
}

block COM_CTR "Central communication module" {
  style { fill: #fff7e6  stroke: #b08d2a dashed 1.5  text: #5a4a10 }
}
COM_CTR -> OBS : "Alerts…" { label: below  stroke: dashed #a33  text: #a33 }
```

Colors: `theme` picks a palette — `light` (default) or the built-in `dark` range — and `background` overrides the canvas color. Each element's colors are customizable at every level: `fill`, `stroke` and `text` (label color) work inline per element, per kind (`fill block: …`), or per diagram; flow color/width/style via `flow-stroke` and inline `{ stroke: … }`. Several properties may share one line: `{ fill: #a stroke: #b text: #c }`.

Rules: styles never affect validation (semantics and cosmetics stay separate); views ship coherent defaults for both themes so a zero-`style` diagram renders correctly in light or dark.

Output language: `lang: fr` switches rendered chrome to French (`FLUX`, `OBJETS MÉTIER`, `LÉGENDE`, French legend/kind names, and the flow-matrix headers). Only the rendered artifact changes — DSL keywords remain English (decision D2) so sources stay portable and diff-clean. Default `en` is byte-identical to prior output.

## 2.1 Matrice des flux techniques

> This is a standard French EA deliverable — the *matrice des flux techniques* — natively produced from a diagram-as-code DSL, which no other tool does.

`cairn matrix <file> --format csv|md|svg` tabulates the flows of a diagram (built for the `infrastructure` view). English columns: **No. · Source (zone) · Destination (zone) · Protocol · Port · Flow**; with `lang: fr` the headers switch to **N° · Source · Destination · Protocole · Port · Nature du flux**. The protocol/port pair is split from the infra tail `(HTTPS/443)`; each endpoint is annotated with its enclosing `network-zone`/`site`. `csv`/`md` produce an editable table for the architecture dossier; `svg` a theme-aware, paste-ready table image. Headers follow `style { lang }`. Output defaults to `<file>.flow.<ext>`.

## 3. Diagnostics

Every issue cairn reports carries a stable code (`E01xx` syntax, `E02xx` semantic, `W05xx` warning). Run `cairn explain <CODE>` for the rationale behind any rule (e.g. `cairn explain E0240`). See [`DIAGNOSTICS.md`](DIAGNOSTICS.md) for the full code catalog.

## 4. Deferred (not v0.1)

Imports/includes across files, variables/themes, ports/anchors on element sides, icons, longhand style properties (`stroke-color:` …) as an additive alternative.
