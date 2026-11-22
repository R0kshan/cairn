# Features

Cairn is made for the views a technical architecture document requires: a
logical view, an application view and an infrastructure view. Dense
diagrams with many flows stay readable, and each view comes with the
deliverables such a document expects.
Cairn draws these three views and nothing else: it is not meant for
flowcharts, sequence or ER diagrams.

| Feature | Description |
|---|---|
| **Readability through overlap-checked layout** | Label space is reserved during layout; overlaps are measured on every build, which reports how many are left, and Cairn's own CI keeps them at 0 across all its examples. Each flow stays a distinct arrow with its own label. Labels can also be numbered, with the full labels displayed in the legend. |
| **Configurable dispositions** | Four dispositions suit different presentation requirements: `wide` and `tall` set the reading direction, `slide` fits a 16:9 slide and `page` a portrait page. |
| **Space optimisation** | Cairn reclaims as much unused space as it can (this feature is still being improved). |
| **Typed diagrams with validation** | Each view defines its element kinds and rules; `cairn validate` reports syntax, schema, and completeness issues as source-located, coded diagnostics, with a JSON mode for CI. See [Diagnostics](DIAGNOSTICS.md). |
| **Flow matrix** | `cairn matrix` exports the flow matrix as CSV, Markdown, or SVG — from any view, with the columns that view can fill. In infrastructure it splits protocol from port and annotates endpoints that sit in a network zone; headers localise via `style { lang: fr }`. The same table is available to embedders through `compile(source, { matrix: true })`. |
| **Author-controlled positioning** | Layout is automatic, with opt-in overrides for when it gets a diagram wrong. The main ones: `order: 2` sequences a top-level element along the disposition's own reading direction (left to right in `wide`, top to bottom in `tall`) and sorts siblings inside a container, `A.right -> B.left` pins which side of an element a flow leaves and arrives on, and the arrow glyph carries the line style (`->` solid, `-->` dashed, `..>` dotted). Finer placement uses the [positioning controls](DSL_SPEC.md#positioning-controls): `offset:`, `label-offset:`, `segment-offset:`, `size:`. |
| **Playground drag-to-adjust** | When the automatic layout needs a correction, the [playground](https://cairn-psi-five.vercel.app/) lets you drag elements, flow labels, a single route segment, or a flow's endpoint onto another side. Every drag is written back into the source as the matching hint — `offset:`, `label-offset:`, `segment-offset:`, `ID.side` — so the adjustment stays versionable text and re-renders identically from the CLI. A hovered flow label also offers a wrap button, which writes that flow's own `flow-label-wrap:`. |
| **Enterprise-view extras** | Business objects on flows, an auto-generated legend, and a numbered-flow table via `flow-text: numbered`. |
| **French or English output** | `style { lang: fr }` localises band titles, legend, and matrix headers while keeping keywords in English for portable sources (other languages can be added if you find this useful). |
| **Built-in themes and customisable colours** | Whether you use the default theme or another built-in one, element colours can be overridden for all elements of a given kind in the `style` block. |

## Readability metrics

Label overlaps are only one of the
[readability metrics](https://github.com/R0kshan/cairn/blob/main/documentation/READABILITY_METRICS.md)
Cairn's own CI measures on every change, across all its examples. Each metric
is a defect a reader would notice, such as a flow drawn through a box it never
touches, two flows crossing, or a long detour, ranked by how much it costs the
reader. Some must stay at zero; the others have a ceiling that may only go
down.

The point is that readability does not regress across Cairn's examples: a new feature either makes
diagrams more readable or at least does not make them less readable, and a
change that does is caught before it ships.
