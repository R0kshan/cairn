# CLAUDE.md — working in cairn

Facts an agent needs that it **cannot infer from the code or from generic
competence**. Everything here is repo-specific; general good practice is assumed,
not restated. If a section ever reads like advice you'd give on any project,
delete it.

## What cairn is

A diagram-as-code CLI for enterprise-architecture views — `logical`,
`application`, `infrastructure`, `security` — rendered to SVG, plus an
infrastructure *matrice des flux techniques* export. It sells **dense diagrams
that stay readable**: overlap-free labels, typed views, deterministic output.
Not a general diagramming tool.

## Runtime model — surprising, read first

- **No build step.** `.ts` runs directly via `node --experimental-strip-types`
  (Node ≥ 22.6). Don't add a transpile/bundle step, emit `dist/`, or rewrite
  imports to `.js` — the explicit `.ts` import extensions are intentional.
- **Type checking exists ONLY in `npm run typecheck`** — the runtime strips
  types without checking them. (TS 7.x native compiler; needs its per-platform
  binary installed.)
- **elkjs runs in-process** (sync fake worker). **Bun compiles release binaries
  only** — never a dev/test dependency; no Bun/Deno APIs in `src/`.
- **`elkjs` is the only runtime dep.** Keep it that way. Dev deps are exactly
  biome + typescript + @types/node.

## Pipeline & file map (`src/`)

```
.cairn → lex.ts → parse.ts → validate.ts → layout.ts (elkjs) → render.ts → SVG
```

- `model.ts` — the heart: types, the `views` registry (kinds, nesting rules,
  per-view diagnostics), themes (`themes`/`mkTheme`/`themeFor`), i18n (`UI`),
  diagnostic `explanations`. Most feature work starts here.
- `matrix.ts` flow-matrix exporters · `fold.ts` slide/page folding ·
  `text.ts` **pure-arithmetic** metrics (`len × fontSize × 0.56`, no system
  fonts — this is why output is platform-independent) · `diag.ts` diagnostic
  rendering · `cli.ts` dispatch · `watch.ts` · `elk*.ts` elkjs wiring ·
  `playground-entry.ts` browser bundle entry.

## Commands

```sh
npm test                  # unit + the non-regression gates (Node-only)
npm run typecheck         # tsc --noEmit — the only type check
npm run lint              # biome (lint-only; leave formatting alone)
npm run snapshots         # accept intended render changes (regenerate reference output)
npm run snapshots:report  # preview a render change, grouped by KIND
npm run test:binary       # compile the host bun binary + smoke-run it (needs Bun)
npm run cairn -- <cmd> <file>
```

CLI verbs: `validate` (`--format json`, `--strict`) · `build` (`-o`) · `matrix`
(`--format csv|md|svg`) · `watch` · `new` (`-L|-A|-I|-S`) · `explain <code>`.

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
4. **Flow labels are required on the logical & security views** (`E0203`),
   optional on application & infrastructure. Infrastructure flows must still
   carry `protocol/port` (`(HTTPS/443)` — `E0240`) even when unlabelled.

## Repo-specific conventions

- **Diagnostics are coded, never thrown.** Errors `E0xxx`, warnings `W0xxx`,
  each with a `span` + `help`; rationale in `explanations` (via `cairn explain`).
  A user error is a `Diagnostic`, not an exception. ~29 codes — reuse the scheme; only rendered chrome localizes via `style { lang: fr }`.
- The typed schema is a **"view"**, never "profile".
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

Adding a **view / diagnostic / theme / style property** all start in `model.ts`
(the `views` registry / `themes` / `DiagramStyle`), then flow through
`parse.ts` → `validate.ts` → `render.ts` as needed. After any such change run the
full gate **and** `npm run snapshots` to re-baseline. For generic work use the
`engineering` plugin skills and the `security-review` / `review` commands.