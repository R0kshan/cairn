---
name: contributing-to-cairn
description: Supplementary guidance for working on cairn — to be invoke by LLM for every code modification
---

## Step 1 - Read `CLAUDE.md` and `CONTRIBUTING.md` at the repo root first. 
This skill only documents things those two files don't cover.

## Step 2 - Implement requested changes by the user
- All code modification must preserve the invariants in `CONTRIBUTING.md`.
- All code modification must follow clean code principles (ex: DRY , SRP, KISS, YAGNI, etc.).
- All code documentation must be clear, concise, and accurate and in TSDoc. Do NOT paraphrase the code, the code must be self-explanatory.


## Step 3 - Check for regressions
Follow instructions in `CONTRIBUTING.md` to run the test suite and snapshot checks. If any snapshot gate fails, follow the step-by-step instructions to determine if the change is intended or a regression.

## Step 4 - Rebuild the playground 
Follow the instructions in `CONTRIBUTING.md` to rebuild the playground.


## CodeRabbit review discipline

When addressing CodeRabbit comments from a PR:

1. **Verify against current code first** — the comment may reference diff state
   that no longer applies (outdated/resolved).

2. **Classify by severity:**
   - **Security** (`esc()` / `escAttr()` gaps, XSS) — fix first, always.
   - **Correctness** (wrong behavior, missing cases) — fix.
   - **Code quality** (nitpicks about deduplication, naming, architecture) —
     evaluate against actual code. Many CodeRabbit comments about
     "duplicated" code mistakenly claim byte-identical functions that are
     actually different implementations. Read the code before acting.

3. **Common false-positive patterns in CodeRabbit reviews on this repo:**
   - `isActor` predicates — three different functions exist, not one. The
     `validator.ts` version does an ID-based lookup via `model.index.get(id)`
     and includes `'actor-group'`; `scene-layout.ts` and `text-metrics.ts`
     check per-element `kind === 'actor'`. Not safe to unify.
   - "Stale imports" — verify imports actually reference old filenames.
     Many such comments are from an intermediate diff state and are already
     resolved by the time you work on them.
   - "Centralize esc/escAttr/Box" — these are 1-2 line functions embedded
     in svg-render.ts. Moving to a shared module adds import churn for
     negligible benefit. Low value.
   - "Docstring coverage (0.42%)" — this is CodeRabbit's default 80%
     threshold, not a project policy. Skip.
   - "Add re-export wrappers" — no code in the repo imports from the old
     filenames, so wrappers are unnecessary indirection. Fix the one
     `_probe.mjs` dev script directly instead.

4. **Never rename a file just because CodeRabbit suggests it.** Each file name
   carries its pipeline position. Renames propagate to imports, tests, CI
   config, playground bundles, and the `_probe.mjs` dev script — a single
   missed import breaks the build silently on Node (no error until runtime).

5. **Minimal changes.** Prefer the smallest edit that satisfies the issue.
   A one-line `escAttr()` wrap is better than refactoring the renderer.

## Cross-platform constraints (Windows)

The repo targets POSIX but must work on Windows. Common pitfalls:

- **`npm run snapshots` may not work on Windows** — the `spawnSync` call in
  `scripts/update-snapshots.mjs` may not inherit `UPDATE_SNAPSHOTS=1`.
  Workaround: `$env:UPDATE_SNAPSHOTS='1'; node --experimental-strip-types --test tests/snapshot.test.ts tests/corpus.test.ts`
- **`build-playground.sh` is a bash script.** On Windows run the `npx esbuild`
  commands directly (see above).
- **`rg` is not available** — use `grep` tool or `Select-String` in PowerShell.
- **`node_modules/.bin` commands need `npx` or full path** — use `npm run`
  wrappers.
