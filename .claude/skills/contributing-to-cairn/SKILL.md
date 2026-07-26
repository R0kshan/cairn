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

## Hard rules
- Do not commit code (let the human review the changes first).
- Do not break the invariants in `CLAUDE.md`.
- Do not break the build or test suite.
- Do not break the playground.
- Do not break the snapshot gates.
