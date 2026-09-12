# Changelog

All notable changes to the cairn project will be documented in this file.

## Unreleased

### Added
- Possibility to drag elements in the playground, with the coordinates written back to the DSL as `offset: <dx>, <dy>` on an element and `label-offset: <dx>, <dy>` on a flow 
- Flow ends can be re-attached by hand: hover either end of a flow and the point it meets its element shows as a circle, and dragging it to another side rewrites the endpoint as `ID.side` — no new syntax, it is the pin the DSL already had
- Flows can be adjusted too: hover a run of a route and the cursor becomes a resize cursor, and sliding it writes `segment-offset: <run>, <delta>` into the flow's inline block. A run moves along its normal only — a vertical run left/right, a horizontal one up/down — so the route keeps its turns and stays orthogonal. Repeat the key to move several runs of one flow
- More display control through the DSL: `style { label-wrap: <n> }` to break element and container labels onto `n`-character lines, `flow-label-wrap: <n>` to do the same for flow labels, diagram-wide or on one flow, `container-padding: <n>` and `label-padding: <n>` to reclaim the whitespace around them

### Changed
- Removed the unnecessary `:` in flow definitions — `A -> B "label"`. The old spelling still parses

### Fixed
- Moving an element by hand no longer leaves a spur on the flows it carries. Squaring a moved terminal leaves the old corner point in line with the new elbow, and where the element moved past that corner the route ran out to the old seat and back — a line drawn on top of itself, most visible as a stray vertical above a queue that had been dragged down. The redundant point is now dropped, on carried routes only
- Moving an element by hand no longer sends one of its flows the long way round. The route repair judges defects and is blind to distance, which is right inside the pipeline but not against a route that was already a reasonable answer — nudging a queue down sent the flow into it up over the title band and back. A repair more than half again as long as what it replaced is now refused
- A flow whose element is moved by hand no longer comes off it. The renderer can undo a route repair by restoring the route the flow had before it, and for a moved element that snapshot describes the seat it used to have — restoring it left a stub hanging beside a box that had moved on. A one-pixel offset was enough to trigger it
- Sliding a run of a flow no longer leaves it slanted. A route can spend three points on one straight line, and a run was numbered per pair of points, so a slide moved half the line and left the rest behind. A run is now the straight line the reader sees, however many points it spends on it
- A flow carried by a manual nudge is no longer left lying on another flow. An element dragged to a new place takes its flows with it, and the route drawn for its old seat could land straight on top of another run — two lines drawn as one. The carried flows are now re-aimed, re-routed and de-coincided, scoped to them alone so the rest of the drawing still does not move
- A manual nudge no longer re-flows the diagram around itself. `offset:`, `label-offset:` and `segment-offset:` were being applied while layout candidates were still being scored, so a hint was measured as if the router had chosen it — one `offset: 0, -30` on `application-large-fr` moved all 28 other elements and re-routed 20 unrelated flows. The deltas are now applied to the layout that won, so a drawing with hints is the drawing without them plus the hints. A diagram declaring no hints renders exactly as before
- Flow labels are no longer wrapped behind the author's back. `compact: on` broke every flow label at 10 characters and the `slide`/`page` fits broke them at 16 or 14 while searching for a layout that fit the frame, so a label could come back stacked on a diagram that never asked for it. Nothing wraps a flow label now but `style { flow-label-wrap: <n> }`, which completes for flow labels what `label-wrap` started for element ones ([#107](https://github.com/R0kshan/cairn/issues/107))
- Producer and consumer directives not taking effect when nested in a container block
- The arrowhead no longer runs  along the border instead of into it, and the arrowhead now faces its counterpart after being dragged through the playground interface

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