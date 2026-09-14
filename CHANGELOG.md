# Changelog

All notable changes to the cairn project will be documented in this file.

## Unreleased

### Added
- `security` in the logical view: a security capability the business feels — strong authentication, anonymisation, encryption of a held record. Named for the capability rather than for the `auth` middleware the other two views carry, because this view holds no technology and anonymisation is not authentication. It may sit anywhere, and an unconnected one raises no warning: a capability can apply to a record rather than to an exchange
- `examples/logical-security.cairn` — a patient-portal logical view showing the new kind alongside business objects, and the medium logical diagram the README now displays
- `cluster` in the infrastructure view: a container for the nodes that stand in for one another — a Kubernetes cluster of workers, a primary/standby database pair. It holds `server`, `app-instance` and `datastore`, must sit in a `network-zone` or `site` (**E0217**), and is drawn dashed so the group reads as the thing that is resilient
- `datastore` in the infrastructure view: a database, drawn as the vertical cylinder the application view already uses. Before, half the examples wrote `app-instance PostgreSQL` and the other half `server "Database server"`, so a *vue technique* reader could not see where the data sat without reading labels
- `load-balancer` in the infrastructure view: a répartiteur de charge, with its own fan glyph. Not a `gateway` — a gateway terminates a protocol conversation and forwards it, a load balancer picks one backend out of many, and that "one of N" is the topology the view exists to show

### Changed
- A flow label no longer sits across a container's outline where a seat nearby is clear of it. The label carries a halo, so a border grazing its box is invisible — what reads badly is the stroke crossing the text rows, which turns the border into an underline and the label into part of the box. On `small`, *Send SMS reminder* sat over the bottom of *External systems*: a 116px label on a 117px run, with no room to slide. The seat search now prefers a seat whose *words* clear every container edge, and where a cramped run leaves only one seat it may overhang the run's end — the box leaves the line, the text centre does not. Strictly local: a seat more than 24px from the one the search would otherwise pick is refused, since a border strike is worth a step along the run and not a relocation. A label whose run is boxed in has no clear seat at any distance and keeps the one it had
- An element in a trailing layout band no longer takes a column of its own when nothing is using the rows beside it. elk draws in layers, so an `external` on the egress side sits past every site however little of that column the site actually fills — on `infrastructure-large-fr` the two external platforms stood beyond a *site de secours* 180px tall in 504px of height, and the flows feeding them crossed 1038px and 1426px of drawing to reach them. A new pass slides such an element back to the first thing that shares a row with it, and lifts the single box in the way when that is all that is holding it out there; `infrastructure-large-fr` came in 174px narrower (2272 → 2098) at the same height. The result is kept only when the drawing is narrower, no taller, and no defect of any kind has appeared — otherwise the whole attempt is rolled back, so a drawing it cannot help is byte-identical
- Flows are no longer padded out by columns nothing is drawn in. elk sizes every layer gap for the widest edge label in it and starts the next layer past whichever *box* ends furthest right, so a short label in a wide gap left bare run either side of itself and a container reaching past its neighbour pushed the following layer out by its own overhang — on the infrastructure template, `Validates tokens` ran 263px for a 110px label and the nightly export crossed 1051px of mostly empty drawing. A horizontal compaction pass now reclaims those columns, the mirror of the one that already reclaimed empty horizontal bands: same monotone shift, same rule that a node, a label, a container border or title, or a vertical route segment or flow endpoint in a column pins it — a horizontal run is simply shortened. Only in the reading direction (`wide`/`slide`), and only past the gap elk itself leaves around a label, so a layer already sized to its label is untouched
- A WAF is now drawn as a `firewall` in every example, whether it is an appliance in the DMZ or software on the reverse proxy. It was modelled three different ways — `app-instance`, `server`, and never `firewall` — so the brick-wall glyph a reader scans for was missing from the one element that most needed it
- The infrastructure examples now use the new kinds instead of working around them: a database engine is a `datastore` rather than an `app-instance` on a server, an HA group is a `cluster` rather than a single `server` box, and the load balancer is a `load-balancer` rather than a `server`

## [v1.0.0-RC16](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC16) - 2026-09-13

### Added
- **Playground:** elements and flow labels can be dragged, and the position is written back to the DSL as `offset: <dx>, <dy>` and `label-offset: <dx>, <dy>` — the keys work by hand in any editor too
- **Playground:** flow ends can be re-attached by dragging the circle at either end to another side, which rewrites the endpoint as `ID.side` — no new syntax, it is the pin the DSL already had
- `segment-offset: <run>, <delta>` slides one run of a route — by hand in the DSL, or **in the playground** by dragging the run, which writes the key for you. A run moves along its normal only, so the route keeps its turns and stays orthogonal; repeat the key to move several runs of one flow
- Diagnostics for a `segment-offset` the route cannot honour — a run the route does not have, or a slide cut short at an element border. Reported by the CLI, the API and the playground alike
- `compile()` reports a handle for every flow terminal and route segment, so any editor — not just the playground — can offer these drags
- More display control through the DSL, everywhere it is rendered: `label-wrap: <n>` for element and container labels, `flow-label-wrap: <n>` for flow labels — diagram-wide or on one flow — and `container-padding: <n>` and `label-padding: <n>` to reclaim the whitespace around them

### Changed
- Removed the unnecessary `:` in flow definitions — `A -> B "label"`. The old spelling still parses
- DSL, diagnostics and invariants documentation updated for the new positioning and dragging

### Fixed

The positioning fixes below are in the renderer, not in the playground: they apply to any
diagram declaring `offset:`, `label-offset:` or `segment-offset:`, however it is rendered.

- A moved element no longer leaves a spur on the flows it carries: the redundant corner left by squaring a carried terminal is dropped
- A moved element no longer sends one of its flows the long way round — a repair more than half again as long as the route it replaces is refused
- A flow no longer comes off an element that was moved. The renderer could restore a route snapshot taken against the seat the element used to have, leaving a stub beside a box that had moved on; a one-pixel offset was enough to trigger it
- A carried flow is no longer left lying on another: carried flows are re-aimed, re-routed and de-coincided, scoped to them alone so the rest of the drawing still does not move
- Sliding a run no longer leaves it slanted. A run is now the straight line the reader sees, however many points it spends on it
- A manual nudge no longer re-flows the diagram around itself. Hints were applied while layout candidates were still being scored, so one `offset: 0, -30` moved all 28 other elements of `application-large-fr` and re-routed 20 unrelated flows. They now go on the layout that won, so a drawing with hints is the drawing without them plus the hints, and a diagram declaring none renders exactly as before
- Flow labels are no longer wrapped behind the author's back — `compact: on` and the `slide`/`page` fits broke them at 10, 16 or 14 characters. Nothing wraps a flow label now but `style { flow-label-wrap: <n> }`
- Producer and consumer directives not taking effect when nested in a container block
- An arrowhead no longer runs along a border instead of into it, and faces its counterpart after an end has been re-attached

## [v1.0.0-RC15](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC15) - 2026-09-09

### Added
- Ability to open diagram in another tab and resize the playground panels
- Automatic queue side attachment based on producer and consumer
- Solid/dashed/dotted meanings to the diagram legend

### Changed
- Update DSL_SPEC.md 
- Bump @biomejs/biome from 2.5.10 to 2.5.11 ([#99](https://github.com/R0kshan/cairn/pull/99))
- Bump @types/node from 26.3.0 to 26.4.0 ([#100](https://github.com/R0kshan/cairn/pull/100))
- Bump softprops/action-gh-release from 3.0.2 to 3.0.3 ([#103](https://github.com/R0kshan/cairn/pull/103))
- Bump github/codeql-action/analyze from 4.37.8 to 4.37.9
- Bump github/codeql-action/init from 4.37.8 to 4.37.9

### Fixed
- Brew packaging
- 'Open in new tab' failing on the Vercel playground 
- Canvas issues
  -  Add missing padding to the diagrams
  - Add wrap to legend when diagram width is smaller than legend width

## [v1.0.0-RC14](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC14) - 2026-09-06

### Added
- More distinct visual for authentication, gateway/proxy, and firewall representations in the infrastructure view 
- Tech-stack logos to the application view 
- Possibility to use custom themes 
- Gateway and auth kins in the application view 
- IDP kind in the application view
- Device kind to infrastructure view 
- Possibility to zoom, unzoom and drag the diagram in the playground 

### Fixed
- Licensing: make every distribution channel carry the notices it owes

### Changed
- Bump oxlint from 1.79.0 to 1.80.0 ([#74](https://github.com/R0kshan/cairn/pull/74))
- Bump @biomejs/biome from 2.5.8 to 2.5.10 ([#73](https://github.com/R0kshan/cairn/pull/73))
- Bump @types/node from 26.2.0 to 26.3.0 ([#75](https://github.com/R0kshan/cairn/pull/75))

## [v1.0.0-RC13](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC13) - 2026-08-30

### Added
- DSL enhancement 
  - Added author-controlled element ordering with order:.
  - Added flow endpoint side pins and solid, dashed, and dotted arrow styles.
  - Added support for systems in application diagrams and flow matrices.
  - Added diagnostics when requested attachment sides cannot be honored.

### Fixed
- Pin codeql-action init and analyze to the same version (v4.37.8) ([#69](https://github.com/R0kshan/cairn/pull/69))
- Improved pinned-flow routing and reduced excessive detours.

### Changed
- Bump esbuild from 0.28.1 to 0.28.2 ([#57](https://github.com/R0kshan/cairn/pull/57))
- Bump @types/node from 26.1.1 to 26.2.0 ([#58](https://github.com/R0kshan/cairn/pull/58))
- Bump oxlint from 1.16.0 to 1.79.0 ([#61](https://github.com/R0kshan/cairn/pull/61))
- Bump @biomejs/biome from 2.5.4 to 2.5.8 ([#64](https://github.com/R0kshan/cairn/pull/64))
- Bump actions/attest-build-provenance from 4.1.1 to 4.2.2 ([#63](https://github.com/R0kshan/cairn/pull/63))
- Documentation (expanded DSL, architecture, diagnostics, and invariants documentation)

## [v1.0.0-RC12](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC12) - 2026-08-15

### Added
- Added new diagrams examples for better DSL coverage 
- NPM publishing
- Expose the flow matrix through the public API, the playground and every view 

### Changed
- Refactor, add stricter linting and update documentation
- Update repository & AI documentation

## [v1.0.0-RC10](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC10) - 2026-08-06

### Added
- Optimise flow positioning: labels displayed on flows, correct overlap, improved routing 

## [v1.0.0-RC09](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC09) - 2026-07-29

### Added
- Optimize flow routing and positioning

## [v1.0.0-RC08](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC08) - 2026-07-28

### Added
- Version display to the CLI, the playground and update tests and documentation accordingly ([#32](https://github.com/R0kshan/cairn/pull/32))

### Changed
- Add known limitations to README.md
- Update documentation and refactored code
- Renamed jobs and variables

### Security
- Automated security fix for dependabot-missing-cooldown security vulnerability ([#25](https://github.com/R0kshan/cairn/pull/25))
- Bump actions/download-artifact from 4.1.8 to 8.0.1 ([#12](https://github.com/R0kshan/cairn/pull/12))
- Bump actions/upload-artifact from 4.6.2 to 7.0.1 ([#13](https://github.com/R0kshan/cairn/pull/13))
- Bump actions/checkout from 7.0.0 to 7.0.1 ([#22](https://github.com/R0kshan/cairn/pull/22))
- Bump github/codeql-action from 3 to 4.37.1 ([#29](https://github.com/R0kshan/cairn/pull/29))
- Bump elkjs from 0.11.1 to 0.12.0 ([#16](https://github.com/R0kshan/cairn/pull/16))

## [v1.0.0-RC07](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC07) - 2026-07-22

### Changed
- Changed license

### Fixed
- Fix DSL incoherence
  - Business objects removed from the application view DSL
  - Queues removed from logical view but added in application & infrastructure view
  - Labels are no longer mandatory on application and infrastructure views, only protocols
  - Added gateway, auth and IDP elements in infrastructure diagram
  - Changed gateway kite-shield rendering
  - Architectural flow corrections in examples
  - Removed labels from infrastructure views (kept only protocols)
  - Updated all application views to correct flow direction: all flows point toward the queue (producer writes, consumer reads/pulls)

## [v1.0.0-RC06](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC06) - 2026-07-20

### Added
- Quality gate -- linting, typecheck, security scanning, and full-corpus non-regression tests

### Fixed
- DSL incoherence
- Bun error when running cairn build command

### Changed
- Update README.md

## [v1.0.0-RC05](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC05) - 2026-07-19

### Added
- Quality gate  (linting, typecheck, security scanning, and full-corpus non-regression tests)
- Dependabot configuration and dependency review action

### Changed
- Update package.json and package-lock.json
- Update GitHub workflow

## [v1.0.0-RC04](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC04) - 2026-07-18

### Added
- Give the possibility to install the latest tag (even if it's a pre-release) via the install.sh

## [v1.0.0-RC03](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC03) - 2026-07-18

### Added
- Snapshots for non regression tests and CONTRIBUTING.md ([#4](https://github.com/R0kshan/cairn/pull/4))
- Packaging scripts

### Changed
- Updated Github release workflow, README.md

## [v1.0.0-RC02](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC02) - 2026-07-18

### Fixed
- Fix packaging for brew and scoop

## [v1.0.0-RC01](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC01) - 2026-07-18

### Added
- Initial release candidate of cairn
- Release v1.0.0
- Packaging script