# Working method — how to reason and solve problems on this project

A general-purpose companion to `ROUTE_DETOUR_HANDOVER.md`. That file is *what
we know*; this one is *how the knowledge was produced*. It distills the method
that worked across five review rounds, including the mistakes, so another
model can work the same way. Nothing here is cairn-specific; everything here
was actually exercised.

## The core loop

Read `CLAUDE.md` → reproduce → diagnose → cheapest-experiment-first → decide
(with the user when it's their call) → implement → verify with more than one
signal → run the gates. Never skip a stage, and never reorder the first four:
skipping the project's own ground rules risks re-deriving or contradicting a
constraint that is already written down, proposing a fix before reproducing
wastes everyone's time, and implementing before the cheap experiment risks
building the wrong thing well.

Concretely: when the user reported wrap-around flows, the first acts were to
find the reproducing example in the repo, measure the pathology numerically
(path length ÷ direct distance per edge), and sweep the *configuration-level*
fixes (elk options) before writing any code. The sweep proved them byte-level
no-ops — that negative result is what justified building a custom pass, and
writing it down is what stops the next person from re-trying tuning.

## Evidence discipline

- **A claim about behavior needs a measurement.** "The routing improved" means
  a before/after table (total edge length, detour count, worst ratio, per
  example), not an impression. Build tiny throwaway measurement scripts and
  keep them one shell call away.
- **Distrust your own readouts.** The single worst bug of this session was an
  `awk` column off-by-one that made a failed experiment look like a dramatic
  success. When a result looks surprisingly good, re-derive it a second way
  before acting on it (the fix was caught by re-printing with labeled fields).
- **When output should not have changed, prove it**: `cmp` the bytes. When it
  should have changed, diff the *right abstraction* — geometry digests and
  rendered previews, not raw XML.
- **Debug by instrumenting a copy, never the real tree.** `cp -r` the repo to
  a temp dir, patch `console.error` probes into the copy, run, read, discard.
  The user's working tree only ever receives finished edits.
- **Print the actual data before theorizing.** Twice in this session a
  fallback silently failed and the wrong subsystem was suspected; a probe that
  dumped the actual candidate positions and the actual conflicting segments
  located the real blocker in one run. Speculating from memory about geometry
  is a losing game — ask the program.

## Designing under invariants

- **Find the canary.** Identify an output the user has already approved and
  keep it byte-identical while you work (`cmp` after every change). If a
  refactor breaks the canary unexpectedly, the refactor is wrong even if all
  tests pass — this caught an unconditional +4px shift that no test noticed.
- **Make the no-op path exact.** A post-processing pass must return without
  touching anything when nothing qualifies, and guards must be on *evidence of
  work done* (e.g. `topPlans.length`), not on loose sentinels. A `minY = 0`
  initialization instead of `minY = 4` silently shifted every diagram.
- **Prefer conservative fallback over forced success.** When a reroute can't
  be proven safe (blocked corridor, crowded side), keep the old behavior for
  that edge rather than emitting something ugly. A visible-but-known defect
  the user can point at beats a new defect you introduced.
- **Fallback chains, ordered by desirability**, each step feasibility-checked:
  preferred route → second-best → last resort → keep existing. When a step is
  geometrically fragile (a slot that only exists if two obstacles are exactly
  15px apart), don't tune constants to thread it — add a qualitatively
  different fallback instead.
- **When a check over-constrains, narrow its *scope*, not its threshold.**
  A veto that killed every candidate was fixed by distinguishing segments
  *attached* to a node edge from segments merely passing by — not by loosening
  the clearance until things squeaked through. Thresholds encode readability;
  scopes encode meaning. Loosen meaning, keep readability.

## Verification: one signal is zero signals

Every change was verified through independent channels before re-baselining:
the tool's own quality metric (label overlaps), a purpose-built audit
(coincident-segment counter), numeric improvement tables, byte-canaries, the
full test suite, and an actual rendered image reviewed by eye. Rendering
matters: two bugs (white-blob labels, a border-riding arrow) were only visible
in pixels. If the environment can't render, build the bridge (SVG→PNG with a
halo-stripping preprocess) rather than skipping the look.

Re-baselining reference output is an *act of judgment*, not a build step:
preview the diff report, attribute every changed file to your edit's blast
radius, eyeball a sample, and only then regenerate. A change you can't
attribute is a regression by definition.

## Working with the user

- **Their annotated screenshots are precise defect reports.** Before coding,
  map each red tag to the exact edge/points in the data (dump the edge's
  coordinates) and confirm the mechanism. Fixing an adjacent-but-different
  defect burns a whole review round.
- **Interview at genuine decision points, before implementing** — with 2–4
  concrete options, trade-offs stated, and a recommendation first. Decisions
  that belong to the user: policy (stability vs. global optimality), scope
  (which defect class to fix now), and preference (which of two readable
  layouts). Decisions that don't: anything with a measurable right answer.
- **Record decisions and never re-ask.** A settled choice ("bottom channel
  first", "#26 before #8") is a constraint from then on.
- **Report honestly at the right altitude**: what changed, the numbers, what
  deliberately didn't change and why, and what remains. Surface the caveats
  you can't verify yourself (here: the Bun-only binary test) instead of
  letting green checkmarks imply more than they proved.
- **When they name a resource that doesn't exist** (a skill, a file), say so
  and use the nearest real equivalent — don't silently guess.

## Committing is the maintainer's, the message is yours

**Never run `git commit`, `git add`, `git stash`, `git checkout`, `git reset`
or `git push`.** The working tree and the history belong to the maintainer —
they stage and commit themselves, often reordering or splitting the work, and
an agent-made commit takes that choice away. Read-only git (`status`, `diff`,
`log`, `show`) is always fine and is how you check what is already theirs
versus what is your delta.

**Finish every piece of work by proposing a commit message, when applicable.**
Doc-only or trivial edits don't need the full template below — a plain
one-line summary is enough. For anything functional, write the message you
would use, ready to paste, not a vague one:

- a subject line under ~72 characters, in the repo's existing style (check
  `git log --oneline`; here that means a `type(#issue):` prefix where one fits);
- a body explaining *why* the change was needed, not a restatement of the diff;
- the measured effect (before → after numbers), since that is what a reviewer
  cannot re-derive from the code;
- what was re-baselined, and anything deliberately left unchanged;
- any gate you could not run (here: `npm run test:binary`, which needs Bun).

Offer it as a suggestion, in a code block so it can be copied verbatim, and
leave the decision to commit — and how to split it — entirely to them.

## Change hygiene

- One concern per round; finish its gates before starting the next.
- After every functional change, the same closing sequence, in order:
  canary `cmp` → targeted rebuild of affected examples → audits → full test
  suite → typecheck → lint → derived artifacts (bundles) → re-baseline.
- Check `git status` at the start of a round: the user commits between rounds,
  so the working-tree delta tells you exactly what is yours. Watch the staging
  column too — files may be staged but not yet committed, which means the work
  is still awaiting the message you owe them.
- Leave every temp artifact in `/tmp`; the repo only receives deliverables.
- End significant work by updating the durable records (handover doc, project
  memory) — the next session, or the next model, starts from those.

## Anti-patterns actually hit in this work (avoid them)

1. Trusting a one-liner's field indexing without labeling fields (`awk '$8'`).
2. Guarding a side effect on the wrong condition (`minY = 0` baseline).
3. A safety band so wide it swallowed unrelated geometry (±40px veto that
   made a whole side unroutable — the correct band was the node's own edge).
4. Tuning deltas to thread a 15px gap instead of adding a proper fallback.
5. Assuming a screenshot's coordinate scale — always re-derive positions from
   the data, not from pixel estimates.
6. Chaining every gate into one shell call and hitting the timeout — split
   long commands; treat a timeout as "unknown state", verify before retrying.
