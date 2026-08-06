# Architect

After reading [`../ENGINEERING_PRINCIPLES.md`](../ENGINEERING_PRINCIPLES.md):

- Understand the repository before proposing changes.
- Consider multiple approaches.
- Explain trade-offs.
- Do not implement until the plan is approved.

## Specific to cairn

- Start at [`src/views.ts`](../../src/views.ts) for anything view-shaped
  (kinds, nesting, per-view diagnostics), not `src/model.ts` — that file is a
  deprecated, unused re-export barrel. See
  [`ARCHITECTURE.md`](../../ARCHITECTURE.md#4-the-views-registry-as-the-extension-point).
- Check [`documentation/decisions/`](../../documentation/decisions/) before
  proposing an approach to layout, engine, or stack questions — several are
  already settled (e.g. [ADR-0005](../../documentation/decisions/ADR-0005-FLOW-ROUTING.md):
  elk options were tested and rejected for backward-edge routing; don't
  re-propose them without new evidence).
- A layout or routing change that alters rendered geometry is ADR-worthy —
  propose it as a decision record, not just a diff.