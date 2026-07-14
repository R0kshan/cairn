# Cairn, a specialized Software Architecture Diagrams as code tool

*Just as a mountain trail is marked by cairns, software architecture is understood through a series of views, each revealing a different part of the landscape.*

## In short,

Cairn is an [ELK (Eclipse Layout Kernel)](https://github.com/eclipse-elk/elk) based diagram-as-code tool specialised in these four software architecture views : `logical`, `application`, `infrastructure` and `security` with the aim to follow the requirements of the  methodology. This tool  comes with a CLI and a [browser playground](https://cairn-psi-five.vercel.app/), both providing template initializing for each type of diagram, validation, live previous, and export to SVG and PNG format. 

## Why cairn?

A large majority of the diagrams (logical, application, infrastructure view) in existing Software Architecture Documents I've worked are made with graphical diagramming softwares such as Drawio and the like. However, modifying diagrams manually in a GUI take time and migrating to diagram as code has proven complicated since most diagrams are rich and it's hard to preserve the same level of information with other solutions like C4.

Furthermore, complexe software architecture with many flows and component generated with existing diagram-as-code tools end up very large or whith overlapping flow labels making unreadable and therefore not possible to integrate in a techical architecture document that requires specifically a logical view, application, physical & infrastructure view and Cairn is made specially to answer this need by provided the following features : 

- **Readability through overlap-checked layout.** Label space is reserved during layout; overlaps are measured every build and shipped at 0, with a CI gate. Each flow stays a distinct arrow with its own label.
- **Configurable dispositions** `slide` and `page` dispositions fit the diagram to a 16:9 slide or A4 page, reporting the achieved scale and warning when a view is too dense.
- **Spacial optimization (still trying to improve this)** Cairn aims to optimize space as much as possible. 
- **Typed diagrams with validation.** Each view defines its element kinds and rules; `cairn validate` reports syntax, schema, and completeness issues as source-located, coded diagnostics, with a JSON mode for CI.
- **Security trust-boundary linting.** The `security` view models trust zones with sensitivity levels (`public`/`internal`/`restricted`/`secret`) and flags flows entering a more-trusted zone without a `security-node` (`W0560`) or missing encryption (`W0561`).
- **Infrastructure flow matrix.** `cairn matrix` exports the flow matrice as CSV, Markdown, or SVG. Columns split protocol from port, annotate each endpoint with its network zone, and localise via `style { lang: fr }`.
- **Enterprise-view extras.** Business objects on flows, an auto-generated legend, and a numbered-flow table via `flow-text: numbered`.
- **French or English output.** `style { lang: fr }` localizes band titles, legend, and matrix headers while keeping keywords English for portable sources (open to adding other languages if you find this usefull)

> Cairn is not a replacement for general diagram tools; for flowcharts, sequence, or ER diagrams, Mermaid or D2 remain the better fit. For C4-level software-structure modeling, dedicated C4 tools like Structurizr or LikeC4 ([c4model.com](https://c4model.com)) are a mature choice.

## Usage & preview

Either use the cli or the [ playground](https://cairn-psi-five.vercel.app/).

Every image below is rendered by cairn CLI from a `.cairn` source in [`examples/`](examples/) — plain SVG, zero label overlaps.

### Small

A minimal logical view (default `wide` disposition, light theme) — [`examples/small.cairn`](examples/small.cairn):

<p align="center"><img src="examples/small.svg" alt="Small logical view" width="640"></p>

### Medium

More systems, layers and flows — [`examples/medium.cairn`](examples/medium.cairn):

<p align="center"><img src="examples/medium.svg" alt="Medium logical view" width="760"></p>

### Light mode / dark mode

The same diagram under each theme — `style { theme: light }` (default) vs `style { theme: dark }`. Switching the one line re-colors background, nodes, text, arrows, chips and legend together:

<table> <tr> <td width="50%"><img src="examples/theme-light.svg" alt="Light theme" width="100%"><br><sub><code>theme: light</code> — <a href="examples/theme-light.cairn">theme-light.cairn</a></sub></td> <td width="50%"><img src="examples/theme-dark.svg" alt="Dark theme" width="100%"><br><sub><code>theme: dark</code> — <a href="examples/theme-dark.cairn">theme-dark.cairn</a></sub></td> </tr> </table>

### Custom colours

Per-element `fill`/`stroke`/`text`, per-kind overrides, and a custom canvas `background` — [`examples/colors-custom.cairn`](examples/colors-custom.cairn):

<p align="center"><img src="examples/colors-custom.svg" alt="Custom colours" width="620"></p>

### Dispositions — wide / slide / tall

One `style { disposition: … }` line sets the shape. `wide` is the default horizontal flow, `slide` fits a hard 16:9 landscape, `tall` runs top-to-bottom — same source, three fits:

<table> <tr> <td align="center"><img src="examples/dispositions/small-wide.svg" alt="Wide disposition" width="100%"><br><sub><b>wide</b> · 1524×496</sub></td> <td align="center"><img src="examples/dispositions/small-slide.svg" alt="Slide disposition" width="100%"><br><sub><b>slide</b> · 16:9 fit</sub></td> <td align="center" width="22%"><img src="examples/dispositions/small-tall.svg" alt="Tall disposition" width="100%"><br><sub><b>tall</b> · 431×1240</sub></td> </tr> </table>

(A fourth disposition, `page`, fits an A4 portrait — see [`examples/dispositions/`](examples/dispositions/) for the full view × size × disposition matrix.)

### Diagram types

Four built-in enterprise-architecture views — each with its own element kinds, validation rules, and layout conventions — from a single DSL:

<table>
<tr>
  <td width="50%"><img src="examples/logical.svg" alt="Logical view" width="100%"><br><sub><strong>Logical</strong> — actors, systems, layers, functional blocks and labelled flows — <a href="examples/logical.cairn">logical.cairn</a></sub></td>
  <td width="50%"><img src="examples/application.svg" alt="Application view" width="100%"><br><sub><strong>Application</strong> — applications, modules, datastores and <code>(protocol, format)</code> on inter-system flows — <a href="examples/application.cairn">application.cairn</a></sub></td>
</tr>
<tr>
  <td width="50%"><img src="examples/infrastructure.svg" alt="Infrastructure view" width="100%"><br><sub><strong>Infrastructure</strong> — sites, network zones, servers, app-instances; protocol required — <a href="examples/infrastructure.cairn">infrastructure.cairn</a></sub></td>
  <td width="50%"><img src="examples/security.svg" alt="Security view" width="100%"><br><sub><strong>Security</strong> — trust zones (with sensitivity levels), security nodes, assets; boundary-crossing lint — <a href="examples/security.cairn">security.cairn</a></sub></td>
</tr>
</table>

## Install

```bash
# While in early access / local development:
git clone [https://github.com/R0kshan/cairn](https://github.com/R0kshan/cairn)
cd cairn
npm install
npm run cairn -- --help

# Coming soon: Homebrew, Scoop, and npm i -g cairn-cli
```

## Commands

Once installed, the command is `cairn`. From a clone, run `npm run cairn -- <command>`.

### Scaffold a typed starter file

```sh
cairn new -L my-system.cairn        # -L logical · -A application · -I infrastructure · -S security
```

The chosen view is written into the file header (`diagram logical …`); every other command reads it from there.

### Check a diagram (syntax, schema, completeness)

```sh
cairn validate my-system.cairn      # --format json for CI/agents · --strict to fail on warnings
```

Problems are reported as source-located, coded diagnostics with a suggested fix:

```text
error[E0210]: functional block outside any system (`ORPHAN`)
 --> my-system.cairn:8:7
  |
8 | block ORPHAN "Floating block"
  |       ^^^^^^
help: move this `block` inside a `layer`, `system` or `external`
```

### Render to SVG

```sh
cairn build my-system.cairn -o my-system.svg     # -o optional; defaults to the same name, .svg
```

On validation errors nothing is written and the exit code is 1; warnings are printed but do not block.

### Export the flow matrix (matrice des flux techniques)

```sh
cairn matrix my-infra.cairn --format csv    # csv (default) | md | svg · -o to set the path
```

### Rebuild on every save

```sh
cairn watch my-system.cairn
```

Rebuilds the SVG on save. On a compile error the SVG becomes an error panel (codes, lines, help), so an open preview never shows a stale diagram. Watch observes only the file it was launched on — run one per file. Pair it with an editor that auto-refreshes an open SVG.

### Explain a diagnostic

```sh
cairn explain E0240
```

```text
E0240 — The infrastructure view requires every flow to carry its protocol (and port if
relevant): the flow matrix is the primary output of this view. Add `(HTTPS/443)` after the label.
```

Exit codes across commands: `0` clean or warnings-only · `1` errors (or warnings with `--strict`) · `2` usage/file problems. Full code list: [`DIAGNOSTICS.md`](documentation/DIAGNOSTICS.md).

## Examples & dispositions

A diagram chooses its shape with one line in a `style` block:

```
diagram logical "Online appointment booking — logical view"
style { disposition: slide }     # wide | tall | slide | page
…
```

The four dispositions trade orientation for fit:

- **wide** (default) — elongated horizontal; actors on the left, external systems on the right.
- **tall** — elongated vertical; actors on top, externals at the bottom.
- **slide** — hard 16:9 landscape, scaled to fill a 1280×720 slide.
- **page** — hard A4 portrait, scaled to fill a Word/ODT page.

For `slide` and `page`, cairn evaluates oriented candidates (both directions, wrapped labels, tight spacing) and keeps the one with the largest readable text, reporting the fit it achieved:

```sh
cairn build examples/small.cairn
cairn build examples/dispositions/small-tall.cairn
cairn build examples/dispositions/small-slide.cairn
cairn build examples/dispositions/small-page.cairn
```

When a view is too large for one slide, cairn reports it rather than shrinking the text below a readable size:

```sh
cairn build examples/dispositions/large-slide.cairn
```

## Colors & themes

Every element's colors are customizable — `fill`, `stroke`, and `text` (label color) — inline per element, per kind, or per diagram, plus the canvas `background`. A `theme` switch picks the palette: `light` (default) or a built-in `dark` range tuned to match.

```
diagram logical "…"
style {
  theme: dark              # light (default) | dark
  background: #0d1117      # optional canvas override
}

system CORE "Core system" {
  block API "API gateway" { style { fill: #e8f5e9  stroke: #2e7d32  text: #1b5e20 } }
}
```

Both themes ship coherent per-kind defaults, so `style { theme: dark }` on its own re-colors the whole diagram — background, nodes, text, arrows, chips, legend and bands — with no label overlaps:

```sh
cairn build examples/theme-dark.cairn       # dark palette
cairn build examples/colors-custom.cairn    # per-element colors + custom background
```



## More

- [`DIAGNOSTICS.md`](documentation/DIAGNOSTICS.md) — every diagnostic code and its meaning.
- [`DSL_SPEC.md`](documentation/DSL_SPEC.md) — the DSL syntax.
- [`DESIGN_BRIEF.md`](documentation/DESIGN_BRIEF.md) — design rationale and architecture overview.
- [`research/`](documentation/research/) — layout engine evaluation, comparison results, alternatives analysis.