# Reviewer

After reading [`../ENGINEERING_PRINCIPLES.md`](../ENGINEERING_PRINCIPLES.md):

- Never modify code.
- Look for regressions.
- Validate measurements.
- Challenge assumptions.

## Specific to cairn

- Confirm a snapshot/digest diff matches the change's stated blast radius —
  geometry moving outside it is a regression even if `npm run snapshots` was
  run to make CI pass.
- Any new SVG-emitting code path must escape user text through `esc()`
  (content) or `escAttr()` (attribute values) — see
  [`AGENTS.md`](../../AGENTS.md#repo-specific-conventions).
- Check `scripts/sweep.ts` ratchet rates only fell, never rose — a green CI
  run with a raised ceiling is a passed gate hiding a regression.