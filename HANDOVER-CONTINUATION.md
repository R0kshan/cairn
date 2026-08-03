# HANDOVER — cairn sweep-green work (continuation, 2026-08-03)

Read `CLAUDE.md`, `documentation/INVARIANTS.md`, `documentation/LADDER.md`, and the earlier
`HANDOVER.md` (root) for full context. This handover covers the latest session only.

## 1. Committed state (branch feature/optimize-flow-positionning)

```
e682205 Fix clearSideHugs reorder and swapCrossingSiblingSeats
335082d Regenerated examples after current ongoing fixes
83f0cf8 Spread attachments after route optimisation and re-derive title boxes after detour rerouting
8df01e6 Remove obsolete .tmp probe scripts and ignore .tmp
472aa1d (baseline commit — sweep knowingly left failing)
```

`e682205` contains:
- **clearSideHugs reorder**: moved AFTER the repair-recording loop in scene-layout.ts so the
  renderer's batch audit can't revert hug fixes as collateral. This fixed 10 more hugs (sideHug
  24→14) including F19/application-large-fr (the run riding REF_CUSTOMERS cylinder's top).
- **swapCrossingSiblingSeats** (new exported function in edge-tidy.ts): swaps the attachment
  seats of two flows sharing a leaf side when their routes cross, strictly validated (no new
  crossings, hugs, shared seats). Fixed logical-archi F05×F06 (the user's issue B). Side
  effects: fanTangle 62→36 (under ceiling ✓, was red), crossings 3576→3509, nearParallel 63→55.
- Snapshots regenerated. Tests 82/83 (only pre-existing test 59).

## 2. Current working tree (uncommitted, INCOMPLETE)

The working tree has **incomplete debug-instrumented code** that must be cleaned up:

### In `src/edge-tidy.ts` — `resideAttempt` inside `clearSideHugs`
An incomplete re-side fallback added to clearSideHugs: when translation fails for a terminal
run that hugs a side, it tries re-siding the terminal to an adjacent perpendicular side of the
same node (e.g., south→west). The scan steps 8px through possible riser positions and validates
each (no new crossings, hugs, leaf hits, shared seats).

**STATUS: does not work.** Tested on logical-archi/wide F02 (SUIV_FLUX case). Every riser
position is blocked:
- West-side re-side: F11's vertical at x=1011 (COORD→SUIV_FLUX's approach stub) spans y
  318.5..525.6 — covering CFG_SYS's entire west-side y-range (379.8..426.8). Any horizontal
  approach to CFG_SYS west side crosses F11's vertical. No valid approach exists.
- East-side re-side: F13/F17 detour horizontals at y=699.7/638.2 (x ∈ [1098,1592]/[1132,1458])
  block any riser at x near CFG_SYS's east side (x=1179).

**Conclusion: F02's hug is geometrically irreparable by route changes that preserve the current
corridor structure.** The corridor between SUIV_FLUX's west-side stubs (x≤1011) and the detour
channels (x≥1098) is fully occupied. Fixing F02 requires either:
1. Rerouting F11's approach to SUIV_FLUX from a different side (not west) — freeing x=1011.
2. An elk-level layout change that moves nodes apart.
3. Accepting F02 as honest debt (it's under ceiling: sideHug 14 < 50).

### Debug instrumentation to REMOVE before commit:
- `sideDbg` function in clearSideHugs (env `CAIRN_DEBUG_SIDE`) — prints `[sideHug Fxx] ...`
- `CAIRN_DEBUG_PORTS` block in scene-layout.ts — prints `[ports] ...` and writes
  `.tmp/constrained-graph.json`
- `CAIRN_DEBUG_AUDIT` was already removed from svg-render.ts (no longer present)
- `resideAttempt` function itself — incomplete, not working, should be removed OR completed
  (see §3 below)

## 3. What the next model should do

### Step 1: Clean up
Remove ALL debug instrumentation from edge-tidy.ts and scene-layout.ts:
- `sideDbg` and all `sideDbg(edge, ...)` calls in clearSideHugs
- `resideAttempt` function (incomplete — does not produce valid candidates for the known cases)
- `CAIRN_DEBUG_PORTS` block in scene-layout.ts (the `writeFileSync` dump + console.logs)
- The `CAIRN_NO_PORT_PASS` env check can stay (it's a useful A/B test hatch)
- Run `npx tsc --noEmit` + `npx biome lint src` to verify clean

### Step 2: Decide on F02 (the user's reported sideHug in logical-archi)
F02's hug at x=1027 vs SUIV_FLUX left side x=1026 is **the** remaining visible case the user
cares about. Three options (present to user):
- **(a) Reroute F11**: F11 (COORD→SUIV_FLUX) uses a vertical at x=1011 that blocks F02's
  west-side re-side. If F11 entered SUIV_FLUX from the north (not the west), x=1011 would be
  free and F02 could re-side. But this changes F11's route — needs validation that it doesn't
  create F11 issues. This is a deeper fix (modifying a bystander edge to free a corridor).
- **(b) Accept as debt**: sideHug is 14 < ceiling 50. F02 is one of the 14 remaining. The
  ceiling passes. The user might accept this once they understand the corridor is fully
  occupied and fixing it requires surgery on a bystander edge.
- **(c) Elk layout change**: constrain the elk layout so nodes don't sit so close that
  corridors between their attachment stubs are narrower than a riser. This is the root-cause
  fix but requires deeper elk work (port spacing, node spacing).

### Step 3: Remaining sweep failures (unchanged from prior handover)
| metric | now | ceiling | status |
|---|---|---|---|
| attachAway | 303 | 247 | ✗ (elk port plateau — user decision needed) |
| nearParallel | 55 | 53 | ✗ (just 2 over) |
| fanTangle | 36 | 59 | ✓ (was red, now green!) |
| sideHug | 14 | 50 | ✓ |
| everything else | — | — | ✓ |

Zero per-drawing regressions. 413 improvements pending baseline lock.

### Step 4: Other remaining work (from prior handover)
- **labelStraddled spacing fallback** (user-approved, unimplemented): when no straddle-free
  on-line seat exists, widen the gap between the parallel runs.
- **attachAway 303 > 247**: the elk port constraint two-pass plateaued. The user deferred
  the lever decision (channel-side planning vs iterated ports vs accept).
- **nearParallel 55 > 53**: just 2 over ceiling. Likely fixable with the same swap pass
  or a small nearParallel-specific nudge.

## 4. How the repo works (critical for a weaker model)

- **No build**: `node --experimental-strip-types <file>`. TypeScript is stripped at runtime.
- **Sweep**: `node --experimental-strip-types scripts/sweep.ts --jobs=auto`. NEVER use `npm run
  sweep` (npm swallows flags like `--update-baseline`). Sweep exits 1 on failure — breaks
  PowerShell `if ($?)` chains.
- **Sweep flags**: `--only=<tag>` (e.g. `--only=logical-archi`), `--detail` (prints per-edge
  defect notes), `--jobs=1` (serial, for debugging), `--update-baseline` (locks current floors
  — only at Phase D when green).
- **Tests**: `node --experimental-strip-types --test tests/*.test.ts`. Snapshot regen:
  `$env:UPDATE_SNAPSHOTS='1'; node --experimental-strip-types --test tests/snapshot.test.ts`.
- **NEVER run `npm run examples`** — the user renders examples themselves and visually checks.
- **LADDER rules**: ceilings/rates only go DOWN. Never recalibrate upward. Tier 0 never
  purchasable. Same-tier trades refused (a jog added to clear a hug = refused).
- **House ladder** (`readability.ts`): `inspect(scene, titles).local(ids, overrides)` returns
  a `Profile` (Map<string, number> defect-key → tier). `ladderAccepts(before, after)` walks
  tiers 0→4, refuses any gain, accepts at first tier that only lost. Keys include positions
  (`cross:F01~F02@x,y`) — for whole-layout comparison, use `relayoutVerdict` in scene-layout.ts
  (normalizes keys, count-based per identity).
- **The renderer's repair audit** (svg-render.ts ~416-552): the renderer can ROLL BACK
  `optimiseRoutes`'s repairs (repairedFrom) when a whole-drawing comparison shows the repair
  made things worse (label collateral). `clearSideHugs` and `swapCrossingSiblingSeats` must run
  AFTER the repair-recording loop (scene-layout.ts ~740) to be permanent — otherwise the batch
  audit can revert their fixes as collateral.
- **Debug tools** (gitignored `.tmp/`): `diag.ts <example> <disposition> [edgeIds]` dumps
  NODE/EDGE/LABEL/TITLE/REPAIRED_FROM (calls `render()` after layout — render mutates geometry
  slightly, ~8px, so diag numbers ≠ sweep numbers which call render too). `away.ts` lists
  attachAway-flagged edges. `hug-probe.ts` checks sideHug detection on a single example.
- **elk**: runs synchronously in-process (no worker — `nodeElkFactory` in elk-worker.ts deletes
  `globalThis.self` to force synchronous GWT execution). `elk.portConstraints: "FIXED_SIDE"` +
  `elk.port.side` on ports works (validated). 0×0 ports crash elk's scanline on hierarchical
  graphs — use 1×1. The two-pass port constraint in scene-layout.ts is try/catch guarded.

## 5. Key files map

- `src/scene-layout.ts` — layout pipeline: makeGraph (elk graph), sceneFromResult (passes),
  attachAwayOf/constrainPorts/relayoutVerdict/selectionExtras (two-pass port constraints),
  clearSideHugs + swapCrossingSiblingSeats calls (after repair recording)
- `src/edge-tidy.ts` — tidyEdges, spreadAttachments, clearSideHugs (with incomplete
  resideAttempt), swapCrossingSiblingSeats, optimiseRoutes
- `src/label-anchor.ts` — label seating with straddledSeat (issue 2 reseat-first)
- `src/readability.ts` — inspect/ladder (defect sets per tier, the house judge)
- `src/route-detour.ts` — channel planner (top/bottom lanes for backward flows)
- `src/svg-render.ts` — renderer with repair audit (can roll back optimiseRoutes moves)
- `scripts/sweep.ts` — predicates, CEILING_RATE, TIER, sideHug predicate, baseline gate
- `documentation/LADDER.md`, `documentation/INVARIANTS.md` — the rules

## 6. User preferences (MUST follow)

- **Always speak English**, concise, software-architect + ELKjs expert tone.
- **Never run `npm run examples`** — user renders examples themselves.
- **Never commit without explicit confirmation.**
- **Never recalibrate ceilings upward.**
- **Verify before reporting**: typecheck, sweep, tests, lint.
- The user reviews regenerated SVGs visually after fixes. Report what to look at and where.