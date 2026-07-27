---
name: contributing-to-cairn
description: Supplementary guidance for working on cairn — to be invoke by LLM for every code modification
---

## Step 1 - Read `CLAUDE.md` and `CONTRIBUTING.md` at the repo root first. 
This skill only documents things those two files don't cover.

## Step 2 - Implement requested changes by the user
- Preserve all invariants defined in `CONTRIBUTING.md`.
- Follow clean code principles (DRY, SRP, KISS, YAGNI, etc.).
- Name all variables, functions, classes, and modules clearly and descriptively (no single letter variables). Avoid abbreviations or acronyms unless widely recognized.
- Declare variables using `const` (preferred) or `let` (never `var`). Rely on TypeScript's type inference for local variables, but explicitly type function signatures and public APIs. Avoid using `any` (use `unknown` if the type is truly dynamic).
- Keep functions deterministic and pure where possible. Isolate side effects (I/O, mutations) cleanly from business logic.
- Ensure classes and modules have well-defined boundaries, single responsibilities, and no circular dependencies.
- Pass all formatting (Prettier) and linting (ESLint) checks.
- Write unit tests covering edge cases using the AAA (Arrange-Act-Assert) pattern. Use descriptive test names, and use mocks/stubs sparingly and intentionally.
- Use `camelCase` for variables, functions, and methods; `PascalCase` for classes, interfaces, types, enums; and `UPPER_SNAKE_CASE` for global top-level constants.
- Write code that is self-explanatory. Use TSDoc comments for public APIs, exported types, and complex algorithms rather than repeating what the code does.
- Ensure code has no nested functions, no nested Ifs, no nested loops, or deeply nested ternary expressions. Refactor into smaller functions or early returns to improve readability.

## Step 3 - Check for regressions
- Follow instructions in `CONTRIBUTING.md` to run the test suite and snapshot checks. If any snapshot gate fails, follow the step-by-step instructions to determine if the change is intended or a regression.
- If there's a regression, fix it, than redo step 2. If there's no regression or the change is intended, updapte examples, snapshots and tests according to instructions in CONTRIBUTING.md, then proceed to step 4.

## Step 4 - Rebuild the playground 
Follow the instructions in `CONTRIBUTING.md` to rebuild the playground.

## Hard rules
- Do not commit code (let the human review the changes first).
- Do not break the invariants in `CLAUDE.md`.
- Do not break the build or test suite.
- Do not break the playground.
- Do not break the snapshot gates.
