# Changelog

All notable changes to the cairn project will be documented in this file.

## Unreleased

### Added
- Possibility to drag elements in the playground, with the coordinates written back to the DSL as `offset: <dx>, <dy>` on an element and `label-offset: <dx>, <dy>` on a flow 
- More display control through the DSL: `style { label-wrap: <n> }` to break labels onto `n`-character lines, `container-padding: <n>` and `label-padding: <n>` to reclaim the whitespace around them 

### Changed
- Removed the unnecessary `:` in flow definitions — `A -> B "label"`. The old spelling still parses

### Fixed
- Producer and consumer directives not taking effect when nested in a container block
- The arrowhead no longer runs  along the border instead of into it, and the route wrapped around rather than taking the side now facing its counterpart after being dragged through the playground interface

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