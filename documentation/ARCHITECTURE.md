# Architecture

How cairn is built, for anyone — human or agent — changing code rather than
just using the CLI. [`AGENTS.md`](../AGENTS.md) is the entry point and stays
short; this document is where the detail it points to lives.

## 1. What cairn is and isn't

A diagram-as-code CLI for enterprise-architecture views — `logical`,
`application`, `infrastructure` — rendered to SVG, plus a
per-view *flow matrix* export. It sells **dense
diagrams that stay readable**: overlap-free labels, typed views, deterministic
output. It is not a general diagramming tool — for flowcharts, sequence, or
ER diagrams, Mermaid or D2 remain the better fit ([README](../README.md#why-cairn)).

## 2. The pipeline, stage by stage

```
.cairn → lexer → parser → validator → scene-layout (elkjs) → route-detour
       → edge-tidy → compact → svg-render → SVG
```

Each stage is deterministic, does one job, and hands off a more refined
representation. "Deterministic", not "pure": only stage 3 (`validator.ts`) is
strictly non-mutating. Stages 4a–5 refine one `Scene` in place rather than
returning a fresh one — same input, same output, but the object is the same
object. Diagnostics accumulate alongside the data rather than aborting the
pipeline — see §5.

| Stage | File | In → Out | Guarantees |
|---|---|---|---|
| 1. Lex | [`lexer.ts`](../src/lexer.ts) | `.cairn` source → `Token[]` | Every token carries a `Span`; scanning always completes, even on malformed input (errors become `E0101` diagnostics, not exceptions) |
| 2. Parse | [`parser.ts`](../src/parser.ts) | `Token[]` → `Model` | Recovers from a syntax error via `syncToNextLine` — a broken file still yields a partial `Model`; rejects `__proto__`/`constructor`/`prototype` as element IDs |
| 3. Validate | [`validator.ts`](../src/validator.ts) | `Model` (+ active `View`) → `Diagnostic[]` | Purely diagnostic — never mutates the model; drives every check off the `views` registry, not hardcoded per-view logic. Defers the `layout { … }` block's own rules to [`layout-constraints.ts`](../src/layout-constraints.ts), the resolver it shares with stage 4 |
| 4. Layout | [`scene-layout.ts`](../src/scene-layout.ts) | `Model` → `Scene` | Delegates to elkjs; tries multiple candidate layouts for `slide`/`page` and keeps the best fit; transposes the scene for DOWN layouts around stage 4a (§3). Orchestrates sub-passes 4a–4c below internally — the CLI calls `layout()` once, not each sub-pass separately |
| 4a. Reroute | [`route-detour.ts`](../src/route-detour.ts) | `Scene` → `Scene` | No-op (byte-identical) when no edge qualifies as a wrap-around detour |
| 4b. Tidy | [`edge-tidy.ts`](../src/edge-tidy.ts) | `Scene` → `Scene` | Every flow individually traceable: collapses sub-pixel jogs, separates flows sharing a node side to `MIN_ATTACH_GAP` |
| 4c. Compact | [`compact.ts`](../src/compact.ts) | `Scene` → `Scene` | Removes only bands with zero pinning content (no node, label, or horizontal segment) — never distorts a container or reintroduces an overlap |
| 5. Render | [`svg-render.ts`](../src/svg-render.ts) | `Model` + `View` + `Scene` → `RenderResult` (`svg`, `overlapsBefore`, `overlapsAfter`) | All text through `esc()`/`escAttr()`; byte-identical across runs and platforms. Not pure rendering: settles final label positions, for repaired routes writes `edge.pts = edge.repairedFrom!`, then re-runs `compactVertical` on the settled geometry — the last geometry mutation happens here, after *every* stage 4 pass. Sub-pass 4c is not the end of layout: `layout()` keeps going past `compactVertical` with `optimiseRoutes`, `spreadAttachments`, `clearSideHugs`, `anchorFlowLabels` and `swapCrossingSiblingSeats` ([`scene-layout.ts`](../src/scene-layout.ts) — compaction, then those). Stage 5 runs after all of them |

`scripts/sweep.ts` runs stages 1–5 over every example × every disposition and
counts violations of the invariants stages 4–4c exist to guarantee — see §5.

## 3. The data model

- **`Model`** (`src/models/ast.ts`) — the parsed diagram: `Element[]` (with
  nesting), `Flow[]`, `BusinessObject[]`, legend notes, `DiagramStyle`. Pure
  types, no logic, so every stage can depend on it without import cycles.
  IDs are flat and unique across elements *and* business objects (DSL
  decision D1, [`DSL_SPEC.md`](./DSL_SPEC.md)) — no
  `parent.child` namespacing, so a reference is always just an ID.
- **`Diagnostic`** (`src/models/diagnostic.ts`) — `{ code, severity, span,
  message, note, help, fix? }`. A user error is a value returned alongside
  the model, never a thrown exception (§5).
- **`Scene` / `SceneNode` / `SceneEdge` / `SceneLabel`** (`src/scene-layout.ts`)
  — the post-layout representation: absolute-positioned nodes, edge point
  lists, label boxes, canvas size. Everything from stage 4 onward reads and
  rewrites this shape; `LaidOutNode`/`LaidOutEdge` are the raw elk result
  before it's assembled into a `Scene` (shared with `slide-fold.ts`'s folded
  layout).

## 4. The `views` registry as the extension point

`src/views.ts` is where a diagram type — `logical`, `application`,
`infrastructure`, `security` — is actually defined: valid element kinds,
nesting rules, per-view diagnostics, layout partitions (actors left, systems
middle, externals right), and visual defaults per kind per theme.

One entry in this registry drives three downstream stages without any of
them special-casing a view by name:

```
views.ts (one View entry)
   ├─→ parser.ts    — which kinds parse, how they nest
   ├─→ validator.ts — E02xx nesting/reference checks, W05xx completeness checks
   └─→ svg-render.ts — shape function + theme colors per kind
```

Adding a view, a diagnostic, a theme, or a style property starts here (or in
`themes.ts` / `models/ast.ts`'s `DiagramStyle` for the latter two) — see
[`AGENTS.md`](../AGENTS.md#extending-the-tool).

The author's own positioning hints (`order:` on an element, a `layout { … }`
entry, `ID.side` on a flow endpoint — [`DSL_SPEC.md`](./DSL_SPEC.md)) enter at
`scene-layout.ts` and nowhere else: they become elk layout options and ports
before a `Scene` exists. A top-level `order:` is the one that changes the graph's
shape rather than an option on a node — `readingSlots` resolves it into a band of
the element's view partition, which is what makes it read along `elk.direction`
(INVARIANTS §9, §17). Past that point a pinned flow is only a `pinned` boolean
on its `SceneEdge`, which is what keeps §16 intact (INVARIANTS §17).

The `layout` block is the one hint with a resolution step of its own:
[`layout-constraints.ts`](../src/layout-constraints.ts) turns its entries into a
rank per top-level element plus the problems (`E0230`–`E0232`, `E0234`) that
sink them. It is deliberately shared rather than duplicated —
`validator.ts` reads the problems and ignores the ranks, `scene-layout.ts` reads
the ranks and ignores the problems — so the diagnostics a user sees and the order
the layout applies come from one evaluation and cannot disagree.

## 5. Where each invariant is enforced

| Invariant ([`AGENTS.md`](../AGENTS.md#non-negotiable-invariants)) | Enforced by | Proven by |
|---|---|---|
| Zero label overlaps | `svg-render.ts` label-settling | `scripts/sweep.ts` (`overlaps: 0`, CI-gated); `.github/workflows/code-quality.yml`'s per-example build check |
| Byte-deterministic output | Every stage restricted to `+ - * / round ceil` + one normalized `Math.hypot` | `tests/corpus.test.ts` (structural digest), `tests/snapshot.test.ts` (canary diff) |
| Intended vs. regressed render changes | Committed reference output (`examples/*.svg`, `tests/__snapshots__/`) | `npm run snapshots` re-baselines *with* the change that caused it, in the same commit — CI can't tell intent from regression on its own |
| Readability (staircases, crossings, dead bands, …) | `route-detour.ts`, `compact.ts`, `edge-tidy.ts` | `scripts/sweep.ts` — 6 invariants at zero, 5 more as ceilings expressed per swept flow-instance (may only fall) |
| Flow labels required (logical/security), protocol required (infrastructure) | `validator.ts` driven by `views.ts` per-view flow rules | `tests/behavior.test.ts` (diagnostic-code assertions) |
| Routing/tidy/compaction/scoring are DSL-agnostic | `route-detour.ts`, `edge-tidy.ts`, `compact.ts` import only `Scene`/`SceneNode`/`SceneEdge` types, never `views.ts` or element `kind` | No automated gate — verified by import discipline; a `views.ts` or `kind`-string import into any of these three files is the signal to look for in review |

`Diagnostic`s are the mechanism common to the last row and to every
user-facing error: a `Model` with problems still parses and validates to a
list of coded, source-spanned diagnostics (§3) — cairn never throws a user
error as an exception.

## 6. Determinism budget

Only `+ - * /`, `Math.round`, `Math.ceil`, and one normalized `Math.hypot`
(numbered-flow labels in `scene-layout.ts`) are permitted anywhere in the
output path. No `Date.now()`, no randomness, no locale-formatted numbers.
`text-metrics.ts` measures text as pure arithmetic — `len × fontSize × 0.56`
— rather than querying system font metrics, which is *why* the same `.cairn`
file renders to byte-identical SVG on macOS, Linux, and Windows, and under
both Node and the Bun-compiled binary. `svg-render.ts` uses a second,
slightly narrower constant (`RENDER_CHAR_WIDTH = 0.52`) for its own packed
contexts (matrix table, legend) — deliberately different, not a bug.

## 7. Runtime & distribution

- **Dev**: `.ts` runs directly via `node --experimental-strip-types` (Node ≥
  22.6) — no build step, no `dist/`. Type checking exists only in `npm run
  typecheck` (this flag erases annotations without checking them).
- **Release binaries**: compiled by Bun (`bun build --compile`), which does
  not run Node and does not use this flag.
- **Browser playground**: an esbuild bundle of the same engine
  (`src/playground.ts` entry) — see [`PLAYGROUND_BUILD.md`](./PLAYGROUND_BUILD.md).

`npm test` is Node-only. It cannot prove the Bun binary or the esbuild
bundle actually work — a loader change can pass every Node test and still
break the compiled binary, since it bundles its own module graph (including
elkjs's worker). CI runs `npm run test:binary` and a playground build
separately; run them locally when touching bundling or the elkjs worker.

## 8. Map of the docs

| Document | Read it when… |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | Starting any work here — the entry point |
| This file | You need the system shape, not just a rule |
| [`DSL_SPEC.md`](./DSL_SPEC.md) | Writing or changing `.cairn` syntax |
| [`DIAGNOSTICS.md`](./DIAGNOSTICS.md) | Adding or looking up a diagnostic code |
| [`READABILITY_METRICS.md`](./READABILITY_METRICS.md) | You want to know what the sweep gate measures, how severe each defect is, and why |
| [`internals/ROUTING.md`](./internals/ROUTING.md) | You want to understand flow routing conceptually |
| [`internals/ROUTING_IMPLEMENTATION.md`](./internals/ROUTING_IMPLEMENTATION.md) | Touching `route-detour.ts` or `edge-tidy.ts` |
| [`.agents/reference/WORKING_METHODOLOGY.md`](../.agents/reference/WORKING_METHODOLOGY.md) | You need the working method, not just the facts |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Opening a PR — the gate-by-gate checklist |
