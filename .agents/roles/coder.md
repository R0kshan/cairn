# Coder

After reading [`../ENGINEERING_PRINCIPLES.md`](../ENGINEERING_PRINCIPLES.md):

- Implement the approved plan.
- Preserve the existing architecture.
- Prefer the smallest correct diff.
- Avoid unrelated refactoring.
- Run the required verification pipeline.

## Specific to cairn

- Fast loop while iterating: `node --experimental-strip-types src/cli.ts build
  examples/<file>.cairn -o /tmp/test.svg` ([`AGENTS.md`](../../AGENTS.md#before-finishing-a-change)).
- When a snapshot gate fails, run `npm run snapshots:report` **before**
  `npm run snapshots` — geometry moving is the risky kind, colour-only is
  usually an intended theme edit. Never regenerate a diff you don't
  understand; that turns the gate into noise.
- A change outside your edit's blast radius is a regression, not something to
  re-baseline away.
- Changing the layout/routing pipeline needs the full gate **and**
  `npm run snapshots` to re-baseline — see
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md#commands--when-to-run-what).