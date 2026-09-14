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
- A flow label crossing container outlines now slides along its own run to where it crosses fewest. On `infrastructure-large-page`, F08's label sat exactly where the *Data zone* corner, its PostgreSQL cluster and the data-centre border all meet, with clear line 100px above it on the same run. Two things kept it there: the preference was a yes/no test, so it could not tell one outline from three and gave up when no seat was fully clear — and here none can be, since the run is 8px from the data-centre border and the label ten times that wide. It now counts. It also only ran on diagrams carrying an author hint, because "the last anchor" rode on the flag that applies those hints; the last anchor is now its own thing and runs on every drawing. And it happens *after* collision resolution rather than before, since that pass re-seats from a border-blind list and was putting the label straight back. A label moves only along the run it already names, and only where no node, neighbouring label or invariant pays for it
- A flow on its way out of a site or system no longer descends the inside of its frame. On `infrastructure-large-page`, `PAYHUB_I -> PSP_EXT` turned right out of the payment hub, stopped 4px short of the *Main data center* border and ran 421px down the inside of it before leaving through the bottom — two lines a hair apart for a third of the page, with the flow's label wedged in the same gap. Four pixels is outside `sideHug` (3px) and outside what the hug fixer reaches for, so nothing owned it. Such a run is now put on the outside of the frame, where the page margin is empty: the diagram is no wider and the flow reads as leaving. Narrow by measurement — the flow must have one end inside the frame and one beyond it, the frame must be an outermost one (outside a nested zone is another container's interior, which cost eight drawings their clean sides), and the move is kept only if no defect of any kind grows, since at 4px there is no `sideHug` on the books to pay a turn or a jog with
- A flow arriving from outside a container no longer has its arrowhead drawn against the frame. The head is about 7px long and elk's container padding is 9, so a crossing arrow had 2px to spare — on `infrastructure-large-wide` the WAF's inbound arrow all but sat on the DMZ border. Widening elk's own padding is the wrong lever: it moves every child and re-routes the whole drawing, and at one extra pixel it put `sideHug` through its ceiling (22 → 32) across 63 drawings. The *border* moves outward instead, by up to 3px and only on a side an arrowhead is actually cramped against, so every node and every route stays exactly where the router put it. A frame never moves onto a run lying outside it, past the container that holds it, or into another box, and a side with nothing to spare stays put. 80 of the 85 redrawn diagrams keep identical dimensions; the other five grow 3-4px where a widened frame reached the canvas edge
- A route leaving a container no longer turns just inside the border it is about to cross. On `infrastructure-large-slide`, `KAFKA_I -> BACKUP` turned 3.5px under the Kafka cluster's top edge, ran 17px along the inside of it and only then crossed out — a corner wedged against the frame, with its `(TCP/9095)` label pinched between the two. Seventeen pixels is well short of the span that makes a run count as hugging a side, so nothing ever looked at it. Such a corner is now taken *out* past the border, into the enclosing zone's padding, and the route crosses square on the segment that was going to cross anyway. Only where the span test refused the run outright — a run long enough to be a hug on its own terms is already handled, and clears inward as it always did
- The trailing-column reclaim may now spend a bottom-tier defect on a large win, where before it took only free ones. `infrastructure-large-slide` planned exactly the right move — the disaster-recovery site up 21px and left 105px, both external platforms into the column beside it — and threw it away over a single tier-3 `attachAway` on `KAFKA_I -> BACKUP`, keeping 217px of empty page (a tenth of the drawing). Anything at tier 2 or better stays unbuyable: those are the defects that make a drawing wrong rather than untidy. A tier-3 or tier-4 defect is purchasable only by a reclaim worth both a tenth of the width *and* 200px — a share alone misprices small drawings, where `placement/sides` wins a bigger fraction while reclaiming 77px less and one extra weave is far more of the picture. `infrastructure-large-slide` and `-wide` come in 2049 → 1832 at the same height; every corpus ratchet holds, and `nearParallel` improves
- A flow whose two ends sit on the faces looking away from each other is straightened onto the faces that look at each other. elk leaves a backward flow by the far side and loops it round; the port pass answers most of that by re-laying the graph out under `elk.port.side`, but it exempts anything `route-detour` flagged — and the flag outlives the channel. On `application-medium-page`, `BILL_ISSUE -> PPF` still carried it while leaving *Invoice issuing and sending* northward, hooking 19px back over the top of the box and descending the whole page, with a clear corridor under the box the entire way. It is now one straight line from the south face. Answered geometrically, over settled geometry, one flow at a time — re-laying the graph out to fix a single route was measured costing more than it won (`application-tech-stack-large` crossings 17 → 28, `nearParallel` through its ceiling), and re-seating one terminal cannot disturb a flow it does not touch. Kept only where the two facing spans overlap, the departure is not a real channel, neither end is pinned, and no defect of any kind grows
- A flow no longer runs along a border it is not attached to. Two holes in the side-hug pass let it: a route's terminal runs were exempt from *every* node of the flow rather than from the one they land on — so on `application-medium-page`, `BILL_ISSUE -> PPF` left *Invoice issuing and sending* northward, hooked back over the top of it and then descended the whole page flush against that same box's left border, drawn as one line with it; and the fixer reached for a hug only inside 3px, where the sweep's `sideHug` flags it, so the hook's horizontal ran 47px along the inside of *Billing*'s top border at exactly 3.0 and cleared the predicate. Each terminal run is now exempt from its own seat alone, and the fixer reaches 3.25px — the metric is unchanged, the pass that answers it is allowed to be a hair tidier than the floor it has to clear
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