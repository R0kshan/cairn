# AGENTS.md

Read this file first.

## Specialized Roles

Skim [`.agents/ENGINEERING_PRINCIPLES.md`](./.agents/ENGINEERING_PRINCIPLES.md)
before any non-trivial change — it defines the core workflow (reproduce →
diagnose → experiment → decide → implement → verify) that every role builds
on; its one hard rule (git ownership) is already stated below. Then consult
the role for the phase you're in:
- **System Planning:** [`.agents/roles/architect.md`](./.agents/roles/architect.md)
- **Code Generation:** [`.agents/roles/coder.md`](./.agents/roles/coder.md)
- **Code Review:** [`.agents/roles/reviewer.md`](./.agents/roles/reviewer.md)

The selected role augments (not replaces) these instructions. One rule from
`ENGINEERING_PRINCIPLES.md` is load-bearing enough to repeat here: **never run
`git add`/`commit`/`push`/`reset`/`checkout`/`stash`** — the repository belongs
to the maintainer; propose a commit message and let them run it. Read-only git
commands are always fine.

For the system architecture (pipeline stages, data model, where each invariant
below is enforced), see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What cairn is

A diagram-as-code CLI for enterprise-architecture views — `logical`,
`application`, `infrastructure`, `security` — rendered to SVG, plus an
infrastructure *matrice des flux techniques* export. It sells **dense diagrams
that stay readable**: overlap-free labels, typed views, deterministic output.
Not a general diagramming tool.

## Runtime model

- **No build step.** `.ts` runs directly via `node --experimental-strip-types`
  (Node ≥ 22.6). Don't add a transpile/bundle step, emit `dist/`, or rewrite
  imports to `.js` — the explicit `.ts` import extensions are intentional.
  This flag erases type annotations at runtime without compiling them. It
  matters in **development only** (the shipped binary uses Bun's compiler
  and runs without Node). In dev it eliminates the compile step — change
  source and re-run, no `tsc --watch` or `dist/` overhead. The project uses
  none of the unsupported TS features (`enum` initializers, `const enum`,
  `namespace`, legacy decorators). The tradeoff: it's experimental
  ([node#53725](https://github.com/nodejs/node/issues/53725)). If it changes,
  the fallback is a one-liner `tsc` compile step.
- **Type checking exists ONLY in `npm run typecheck`** — the runtime strips
  types without checking them. (TS 7.x native compiler; needs its per-platform
  binary installed.)
- **elkjs runs in-process** (sync fake worker). **Bun compiles release binaries
  only** — never a dev/test dependency; no Bun/Deno APIs in `src/`.
- **`elkjs` is the only runtime dep.** Keep it that way. Dev deps are exactly
  biome + typescript + @types/node.

## Pipeline & file map (`src/`)

```
.cairn → lexer.ts → parser.ts → validator.ts → scene-layout.ts (elkjs) → route-detour.ts → edge-tidy.ts → compact.ts → svg-render.ts → SVG
```

- `views.ts` — **the heart**: the `views` registry (kinds, nesting rules,
  per-view diagnostics, layout partitions, visual defaults). Imported by
  `parser.ts`, `validator.ts`, `svg-render.ts` and 6 other modules. **Most
  feature work starts here.**
- `models/ast.ts` — the AST types (`Model`/`Element`/`Flow`/`BusinessObject`/
  `DiagramStyle`), `defaultDiagramStyle`, diagnostic `explanations` ·
  `models/diagnostic.ts` — `Severity`/`Diagnostic` · `themes.ts` — `themes`/
  `mkTheme`/`themeFor` · `localization.ts` — i18n strings (`UI`) ·
  `geometry.ts` / `element-tree.ts` / `xml-escape.ts` — geometry helpers,
  element-tree traversal, `esc()`/`escAttr()`.
  `model.ts` is a **deprecated, unused re-export barrel** kept for external
  consumers that may still import `cairn/src/model.ts` directly — nothing in
  this repo imports it; don't add to it, don't import from it.
- `flow-matrix.ts` flow-matrix exporters · `slide-fold.ts` slide/page folding ·
  `text-metrics.ts` **pure-arithmetic** metrics (`len × fontSize × 0.56`, no system
  fonts — this is why output is platform-independent) · `diagnostics.ts` diagnostic
  rendering · `cli.ts` dispatch · `watch.ts` · `elk-*.ts` elkjs wiring ·
  `playground.ts` browser bundle entry.

`edge-tidy.ts`, `route-detour.ts`, and `compact.ts` are the three post-layout
passes between `scene-layout.ts` and `svg-render.ts`; what each guarantees,
the flow-routing mechanism specifically, and the full invariant-to-gate
mapping are in [`ARCHITECTURE.md`](./ARCHITECTURE.md) — not repeated here.

## Commands

```sh
npm test                  # sweep + unit + the non-regression gates (Node-only)
npm run typecheck         # tsc --noEmit — the only type check
npm run lint              # biome (lint-only; leave formatting alone)
npm run snapshots         # accept intended render changes (regenerate reference output)
npm run snapshots:report  # preview a render change, grouped by KIND
npm run sweep             # readability gate only (already included in npm test)
npm run test:binary       # compile the host bun binary + smoke-run it (needs Bun)
npm run examples          # refresh examples/*.svg only (subset of snapshots)
npm run cairn -- <cmd> <file>
```

CLI verbs: `validate` (`--format json`, `--strict`) · `build` (`-o`) · `matrix`
(`--format csv|md|svg`) · `watch` · `new` (`-L|-A|-I|-S`) · `explain <code>` ·
`version`/`--version`/`-v` (prints `package.json`'s version under plain Node;
release binaries instead print the exact tag they were built from — see
`CAIRN_BUILD_VERSION` in `cli.ts` and `scripts/build-binaries.sh`).

`npm test` is Node-only — it can't prove the **bun-compiled binary** or the
**esbuild playground bundle** work; CI does both, and the release job smoke-runs
the linux binary before publishing. The compiled binary bundles its own module
graph (incl. elkjs's worker), so a loader change can pass every Node test yet
break the binary — hence `test:binary`.

## Non-negotiable invariants

1. **Zero label overlaps.** Every example builds with `label overlaps: 0`
   (CI-gated).
2. **Byte-deterministic output.** Same input → identical SVG across runs and
   platforms. Only `+ - * /`, `round`, `ceil`, and one normalized `Math.hypot`
   (numbered-flow labels) are allowed in the output path. Never introduce
   `Date.now()` / randomness / locale-formatted numbers.
3. **The non-regression gates encode *intent*.** CI can't tell an intended
   render change from a regression — you express intent by committing
    regenerated reference output (`npm run snapshots`) in the SAME change. Three layers in
   `npm test`: structural digest (`corpus.digest`, geom/color/text per example),
    example-SVG fidelity (committed `examples/*.svg` can't rot), detailed snapshots.
   When a gate fires, run **`npm run snapshots:report` first** — geometry moving
   is the risky kind; colour-only is usually an intended theme edit. A change
   outside your edit's blast radius is a regression. **Never regenerate to
   silence a diff you don't understand** — that's the one instinct to override.
4. **Readability is gated by `npm run sweep`**, which recursively sweeps every
   `.cairn` fixture under `examples/` (top level plus `dispositions/` and
   `themes/`) × every disposition. Six invariants must stay at **0**: label
   overlaps, segments off orthogonal, runs crossing a leaf box, dead
   horizontal bands, coincident segments, shared attachment points. The rest
   (staircases, tight attachments, near-parallel runs, long detours) are a
   **ratchet**, expressed as a rate per swept flow-instance (not a raw count)
   so adding fixtures doesn't spuriously fail the gate: current rates are
   ceilings and may only fall. Lower a rate when a change earns it; never
   raise one to go green. What each defect looks like on the page and why
   it's bucketed the way it is: [`documentation/READABILITY.md`](./documentation/READABILITY.md).
5. **Flow labels are required on the logical & security views** (`E0203`),
   optional on application & infrastructure. Infrastructure flows must still
   carry `protocol/port` (`(HTTPS/443)` — `E0240`) even when unlabelled.
6. **Flow routing, tidying, compaction, and readability scoring are
   DSL-agnostic.** `route-detour.ts`, `edge-tidy.ts`, `compact.ts`, and
   `scripts/sweep.ts`'s metrics operate purely on the post-layout `Scene` /
   `SceneNode` / `SceneEdge` geometry (plus generic `Model.style` /
   `Model.flows`) — never on an element's `kind` or which view produced it.
   A `server` and an `actor` look identical to these passes. Adding a view
   or element kind must never require touching them.

## Repo-specific conventions

- **Diagnostics are coded, never thrown.** Errors `E0xxx`, warnings `W0xxx`,
  each with a `span` + `help`; rationale in `explanations` (via `cairn explain`).
  A user error is a `Diagnostic`, not an exception. 31 codes (see
  [`documentation/DIAGNOSTICS.md`](./documentation/DIAGNOSTICS.md)) — reuse
  the scheme; only rendered chrome localizes via `style { lang: fr }`.
- **Business objects are logical-view only** (`E0222` elsewhere). Element kinds
  are per-view (`views` registry) — e.g. `queue` (horizontal-cylinder) lives in
  application + infrastructure, not logical.
- SVG output is untrusted-string territory: **`esc()` for text content,
  `escAttr()` (escapes `"`) for attribute values.** Reserved keys
  (`__proto__`/`constructor`/`prototype`) are rejected at parse time. Every
  security fix ships with its exploit as a regression test.

## Before finishing a change

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md#opening-a-pr) for the pre-commit
checklist and snapshot regeneration procedure.

**Fast iteration loop:** edit → `node --experimental-strip-types src/cli.ts build examples/<file>.cairn -o /tmp/test.svg` → open SVG.

## Extending the tool

Adding a **view / diagnostic / theme / style property** all start in `views.ts`
(the `views` registry) or `themes.ts` (`themes`/`mkTheme`) or `models/ast.ts`
(`DiagramStyle`), then flow through `parser.ts` → `validator.ts` →
`svg-render.ts` as needed — see [`ARCHITECTURE.md`](./ARCHITECTURE.md#4-the-views-registry-as-the-extension-point)
for how one `views.ts` entry drives all three. After any such change run the
full gate **and** `npm run snapshots` to re-baseline. For code review use the
`code-review` / `security-review` skills.