# WORKING METHODOLOGY

These principles describe **how to reason and solve problems** on this project.

## Core workflow

Always follow this sequence:

> Reproduce → Diagnose → Try the cheapest experiment → Decide (with the user when appropriate) → Implement → Verify using multiple signals → Run all required gates.

Never propose a fix before reproducing the problem, and prefer configuration or data-driven experiments before changing code.

---

## Evidence over intuition

* Every behavioral claim must be backed by a measurement.
* Verify surprising results using an independent method.
* Compare the correct abstraction:
  * `cmp` for expected no-op changes.
  * Geometry digests, rendered output, or semantic diffs for expected changes.
* Print actual runtime data before forming hypotheses.
* Instrument temporary copies of the repository; never leave debugging code in the working tree.

---

## Design conservatively

* Preserve approved outputs unless intentionally changing them.
* Ensure true no-op paths produce identical output.
* Prefer safe fallbacks over risky "perfect" solutions.
* Build explicit fallback chains instead of tuning fragile constants.
* When a constraint is too restrictive, narrow its scope rather than weakening its thresholds.

---

## Verify with independent signals

Never rely on a single verification method.

When appropriate, combine:

* quantitative metrics
* targeted audits
* regression tests
* byte-for-byte comparisons
* rendered output
* manual inspection

Re-baseline reference outputs only after every change is understood and attributed.

---

## Collaborate deliberately

* Treat annotated screenshots as precise defect reports.
* Ask the user only at genuine decision points, presenting concrete options with trade-offs and a recommendation.
* Record decisions and treat them as constraints.
* Report what changed, why, how it was verified, and any remaining limitations.
* Never invent missing files, skills, or resources—state what exists and use the closest valid alternative.

---

## Git ownership

The repository belongs to the maintainer.

Never run:

* `git add`
* `git commit`
* `git push`
* `git reset`
* `git checkout`
* `git stash`

Read-only Git commands are always acceptable.

When appropriate, finish by proposing a complete by concise commit message explaining:

* why the change was made
* measurable impact (when applicable)
* any re-baselined artifacts
* any verification that could not be performed

---

## Change hygiene

* Solve one concern at a time.
* After functional changes, run the complete verification pipeline before moving on.
* Check `git status` at the beginning of every round.
* Keep temporary artifacts outside the repository.
* Update durable project documentation before finishing significant work.

---

## Common failure modes

Avoid these recurring mistakes:

* Trusting a single parsing or measurement script.
* Guarding mutations on inferred state instead of evidence that work occurred.
* Overly broad safety checks that block unrelated behavior.
* Tuning constants where a better fallback strategy is needed.
* Inferring behavior from screenshots instead of source data.
* Chaining long-running commands into a single timeout-prone pipeline.
