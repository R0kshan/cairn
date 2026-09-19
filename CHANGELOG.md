# Changelog

All notable changes to the cairn project will be documented in this file.

## [Unreleased]

### Added
- Flow endpoint suffixes accumulate: `CLIENT.producer.top -> Q (AMQP)` reads both — the role names the queue cap, the side where the flow leaves the element — in either order. Two of the same kind (`A.top.bottom`) is the new **E0227** — see `examples/placement/queue-roles-sided.cairn`
- **Playground:** a hovered flow label offers a wrap button, which writes that flow's own `flow-label-wrap: <n>` — half the label's width, so most labels come out on two lines; the key works by hand in any editor too
- `size: <dw>, <dh>` resizes a container — by hand in the DSL, or **in the playground** by dragging any of its eight grips, which writes the key for you — and a **Reset flows** button drops the `segment-offset:` and `label-offset:` hints so the router places the flows again against the containers as they now are

### Fixed
- Dragging an element no longer leaves the flow it carries bent: a run that was straight before the nudge is straightened again between the sides the two boxes now face each other with, instead of reaching a short riser into the underside of the box that moved

## [v1.0.0-RC17](https://github.com/R0kshan/cairn/releases/tag/v1.0.0-RC17) - 2026-09-16

### Added
- `security` in the logical view — authentication, anonymisation or encryption as a business capability; it may sit anywhere, unconnected included
- `examples/logical-security.cairn`, a patient-portal logical view showing the new kind alongside business objects
- `cluster` in the infrastructure view — a dashed container for nodes that stand in for one another, held in a `network-zone` or `site` (**E0217**)
- `datastore` in the infrastructure view — a database, drawn as the vertical cylinder the application view already uses
- `load-balancer` in the infrastructure view — a répartiteur de charge with its own fan glyph, distinct from `gateway`

### Changed
- Fewer crossings and detours: a flow with no workable shape takes a corridor clear of the drawing, flows leaving one side nest instead of crossing, a flow pointing backwards is straightened onto the facing sides, and a riser is no longer refused for a label that fits across it
- Flows keep clear of the frames they pass: none runs along a border it is not attached to, one leaving a site or system goes outside the frame rather than down the inside of it, a route turns outside the border it crosses, and a container edge gives an inbound arrowhead up to 3px
- Flow labels stay readable: a label slides along its run to the seat that crosses fewest outlines, none sits across a container outline when a seat within 24px is clear, and no repaired corridor runs under a neighbouring label
- Less empty page: drawings are seated against the left margin, columns nothing is drawn in are reclaimed in the reading direction, a trailing element slides back beside the rows it shares, and the trailing-column reclaim may now buy a large win with a bottom-tier defect
- `compact` is asserted on the boxes rather than on the canvas, which the router's corridors size
- Route repairs are checked against the rest of the drawing: a sibling-seat swap may not land a flow on a third one, and a revert is charged for the crossings it brings back
- The examples use the view's own vocabulary: `datastore`, `cluster` and `load-balancer` instead of workarounds, and a WAF drawn as a `firewall` whether appliance or software

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