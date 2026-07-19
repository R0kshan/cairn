# CLAUDE.md — working in the cairn repository

Context, rules, and **method** for AI agents (and humans) in this codebase.
Terse on purpose; follow the pointers for depth.

## What cairn is

A diagram-as-code CLI for enterprise-architecture views — `logical`,
`application`, `infrastructure`, `security` — rendered to SVG, plus an
infrastructure *matrice des flux techniques* export. The value proposition is
**dense, information-rich diagrams that stay readable**: overlap-free labels,
typed views with validation, deterministic output. It is not a general
diagramming tool (see README's positioning vs Mermaid/D2/C4).

## How to work here — the method

These are not style preferences; each one exists because skipping it has
caused real breakage in this repo.

1. **Verify current state before acting.** This repo changes between sessions:
   files get moved, deleted, re-pinned, or hand-edited outside any one
   conversation. Never act on memory of the codebase or on what a doc says —
   `Read` the file, run the command, check `git status` first. Docs go stale
   (RELEASING.md once pointed at a folder that no longer existed); **code and
   CI output are the only ground truth**.
2. **Diagnose fully before touching anything.** When something fails, find the
   producing side AND the consuming side before editing either. Most failures
   here are **broken contracts**: one job writes a filename, another derives
   the same name independently and reads it. If they disagree you get ENOENT
   or 404 — the bug is the *contract*, not either endpoint. Fix the contract
   (single source of truth), not the symptom.
3. **Smallest change that restores the invariant.** No drive-by refactors, no
   "while I'm here". One concern per change keeps the snapshot diff readable —
   and the snapshot diff is the review artifact.
4. **Prove guards by breaking them.** A test that has never failed is
   unproven. When adding any gate (snapshot, lint rule, security check),
   deliberately introduce the defect it should catch, watch it fail, revert,
   watch it pass. Same for security fixes: reproduce the exploit, apply the
   fix, re-run the exploit, then lock it with a regression test.
5. **Run the FULL gate after every fix, including mechanical ones.** A
   one-line "obvious" edit (a type annotation, an import removal) can be
   wrong in a non-obvious way; `typecheck + lint + test` costs seconds and has
   caught exactly that here.
6. **Deleted ≠ lost.** Before recreating a missing file, check history:
   `git log --oneline -- <path>` then `git show <commit>^:<path>`. Restoring
   beats rewriting — it preserves decisions you don't remember making.
7. **Ask before acting on a fork in the road; act without asking on facts.**
   Anything checkable (does X exist? does Y pass?) — check it, don't ask.
   Genuine decisions (scope, trade-offs, security posture) — present options
   with a recommendation and wait.

## Runtime model — read before you touch anything

- **TypeScript runs directly. There is NO build step.** Source is `.ts` executed
  via `node --experimental-strip-types` (requires **Node ≥ 22.6**). Do not add a
  transpile/bundle step, emit `dist/`, or convert imports to `.js`. Imports use
  explicit `.ts` extensions on purpose.
- **Type safety exists ONLY in `npm run typecheck`** — the runtime strips types
  without checking them. tsc green is mandatory, not advisory.
- **elkjs runs in-process** (synchronous fake worker) — no external layout
  service, no browser.
- **Bun is used only to compile release binaries** (`scripts/build-binaries.sh`),
  never for dev or test. Don't introduce Bun/Deno APIs into `src/`.
- Only runtime dependency is `elkjs`. Keep it that way; every new dep is
  permanent maintenance for a solo project. (Dev deps: biome, typescript,
  @types/node — that's the whole toolchain, deliberately.)

## Pipeline & file map (`src/`)

Data flows in one direction:

```
.cairn source
  → lex.ts       tokenizer
  → parse.ts     recursive-descent parser → Model (+ parse diagnostics)
  → validate.ts  schema/rule checks per view → more diagnostics
  → layout.ts    elkjs layered layout → Scene (node boxes + edge waypoints)
  → render.ts    Scene → SVG (style resolution, overlap post-pass)
```

Supporting modules:

- `model.ts` — the heart. Types (`Model`, `Element`, `View`, `StyleProps`,
  `DiagramStyle`), the `views` registry (element kinds, nesting rules, per-view
  diagnostics), themes/palettes (`themes`, `mkTheme`, `themeFor`), i18n strings
  (`UI`), and diagnostic `explanations`. Most feature work starts here.
- `matrix.ts` — the flow-matrix exporters (`matrixCsv`/`matrixMd`/`matrixSvg`).
- `fold.ts` — disposition folding (slide/page multi-column layouts).
- `text.ts` — text metrics. **Pure arithmetic** (`length × fontSize × 0.56`), no
  system fonts — this is why output is platform-independent. Keep it that way.
- `diag.ts` — diagnostic rendering (human + JSON).
- `cli.ts` — command dispatch. `watch.ts` — `cairn watch`. `elk.ts`/`elk-node.ts`
  — elkjs wiring. `playground-entry.ts` — browser bundle entry.

## Commands

```sh
npm test                              # full suite (unit + snapshot gate)
npm run snapshots                     # regenerate snapshot goldens (see below)
npm run cairn -- <cmd> <file>         # run the CLI from source
npm run typecheck                     # tsc --noEmit (the ONLY type check)
npm run lint                          # biome (lint-only; formatting is the author's)
```

CLI verbs: `validate` (`--format json`, `--strict`), `build` (`-o`), `matrix`
(`--format csv|md|svg`), `watch`, `new` (`-L|-A|-I|-S` scaffold), `explain <code>`.

## Non-negotiable invariants — do not regress these

1. **Zero label overlaps.** Every example must build with `label overlaps: 0`.
   CI rebuilds all examples and fails otherwise. Label space is reserved during
   layout; overlaps are measured every render.
2. **Byte-deterministic output.** Same input → identical SVG, across runs and
   platforms. The one non-bit-exact call is a single `Math.hypot` (numbered-flow
   labels); the snapshot gate normalizes for it. Never introduce
   `Date.now()`/random/locale-formatted numbers into rendered output.
3. **The non-regression gates** encode *intent*: CI can't tell an intended
   render change from a regression, so intent is expressed by committing
   regenerated goldens (`npm run snapshots`) in the SAME change as the code.
   Three layers, all in `npm test`: the **structural digest**
   (`tests/corpus.test.ts` → `corpus.digest`, geom/color/text fingerprints for
   every example), **example-SVG fidelity** (committed `examples/*.svg` can't
   rot), and **canary snapshots** (`tests/snapshot.test.ts`, curated full SVGs +
   matrix). When a gate fires, run **`npm run snapshots:report`** first — it
   groups changes by kind (⚠ geometry = risky, colour = usually intended). A
   change outside your edit's blast radius is a regression — find it. **Never
   regenerate to silence a diff you don't understand.**
4. **Every flow is labelled.** Infrastructure flows must additionally carry a
   `protocol/port` (`(HTTPS/443)`) — diagnostic `E0240`.

## Failure playbook — symptom → first thing to check

Each entry below is a failure that actually happened here.

| Symptom | Cause to check first |
|---|---|
| Release workflow silently doesn't run on a tag | Tag case. `tags: ["v*"]` is **case-sensitive**; `V1.0.0` never triggers. Lowercase `v` always. |
| `taps` job: `ENOENT … cairn-<X>-checksums.txt` | Version-name contract: the name *produced* (build-binaries) vs *derived* (`${GITHUB_REF_NAME#v}`) disagree. Tag is the source of truth; `package.json` must never carry a leading `v`. |
| `taps` job: `List Artifacts … 404` | `upload-artifact` / `download-artifact` **major versions differ** (v3 and v4 backends are incompatible). Keep majors matched. |
| `ENOENT … packaging/cairn.rb` | The `packaging/` folder moved/was deleted. Restore from git history, don't rewrite. |
| Snapshot test fails, you didn't touch render/layout | Real regression upstream (a constant, a shared helper). Bisect the change, don't regen. |
| Output differs across platforms | Someone added trig/locale/time into the output path. Only `+ - * /`, `round`, `ceil`, and the one normalized `hypot` are allowed. |

## House style (observed conventions — match them)

- **Single-file modules**, small and focused. No framework, no DI, no classes
  where a function suffices — the code is functional and direct.
- **Comments explain *why*, not *what*.** Terse, high-signal, often one line
  above a non-obvious decision. Don't add narration.
- **Diagnostics are coded and source-located.** Errors are `E0xxx`, warnings
  `W0xxx`, each with a `span` and a `help` string; user-facing rationale lives in
  `explanations` (surfaced by `cairn explain`). Never `throw` for a user error —
  emit a diagnostic. ~29 codes exist; reuse the scheme.
- **DSL keywords stay English** even when output is French (decision "D2"): only
  *rendered chrome* is localized via `style { lang: fr }`.
- Terminology: the typed diagram schema is a **"view"** (never "profile").
- Prefer editing `examples/` real files over inventing throwaway ones; they are
  also the snapshot/overlap corpus.

## Decisions already made (don't relitigate)

Architecture Decision Records live in `documentation/decisions/`:
ADR-0001 (ELK + custom post-passes), ADR-0002 (TypeScript + Bun binaries),
ADR-0003 (CLI-first), ADR-0004 (built-in compiled views). Other settled calls:
"view" not "profile"; no separate `functional` view (logical covers it); i18n is
output-only with English keywords; matrix companion file extension is `.flow`;
themes are a closed compiled registry (no DSL theme authoring); release
version-sync back to `main` was considered and **rejected** (credential surface
outweighs cosmetic drift — the tag is authoritative).

Reference docs: `documentation/DSL_SPEC.md` (grammar), `documentation/DIAGNOSTICS.md`
(codes), `documentation/DESIGN_BRIEF.md` (rationale).

## Security

User `.cairn` input becomes SVG output — treat every user string as hostile:

- `esc()` for text content; **`escAttr()`** (also escapes `"`) for anything
  inside an attribute value. A raw user string in `="..."` is an injection
  vector when the SVG is opened standalone. When adding a render sink, decide
  the context (text vs attribute) explicitly.
- Untrusted keys never index plain objects unchecked — reserved names
  (`__proto__`, `constructor`, `prototype`) are rejected at parse time.
- Every security fix ships with the exploit encoded as a regression test
  (see the `security:` tests in `tests/smoke.test.ts`).
- CI: CodeQL, dependency-review, `npm audit`, zizmor (workflow scan) — see
  `.github/workflows/{codeql,dependency-review,security}.yml`. Workflows are
  SHA-pinned, least-privilege, `persist-credentials: false`; keep that posture.

## After every code modification

- `npm run typecheck`, `npm run lint`, and `npm test` are all green — run all
  three even for "trivial" changes.
- If render/layout changed intentionally: `npm run snapshots`, then **review the
  snapshot diff yourself** before committing it — it is the record of what your
  change did to output.
- New/changed examples build with `label overlaps: 0`.
- Nothing added a build step, a runtime dep, or non-deterministic output.
- **Releases:** lowercase `vX.Y.Z` tag; the workflow derives everything from the
  tag. `RELEASING.md` is the runbook.
- NEVER commit, always ask user to review the changes

## Skills

- **`cairn-extend`** (`.claude/skills/`) — extending the pipeline: add a view,
  diagnostic code, theme, or style property, with the required
  validate→build→snapshot loop.
- For generic work use the installed `engineering` plugin skills
  (`code-review`, `architecture`, `testing-strategy`, `debug`) and the
  `security-review` / `review` commands — this file exists only for what those
  can't know: this repo's specifics.
