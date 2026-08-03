# HANDOVER — cairn sweep-green work (2026-08-03)

Read this first, then `CLAUDE.md`, `documentation/INVARIANTS.md`, `documentation/LADDER.md`.

## 1. Goal

Make the cairn sweep green after commit `472aa1d` ("Add label overlap on other flow avoidance",
which knowingly left the sweep failing), then lock the baseline. Two user-reported visual
defects were added to scope mid-way (see §4). User decisions recorded: gros-cluster approach =
**elk port constraints**; labelStraddled strategy = **reseat first, spacing fallback**;
commit B2+C first (done).

## 2. Repo workflow (hard-won, follow it)

- **No build**: run everything with `node --experimental-strip-types <file>`.
- **Sweep**: `node --experimental-strip-types scripts/sweep.ts --jobs=auto`. npm swallows
  `--update-baseline`; always invoke node directly. Sweep **exits 1 on failure** — this breaks
  PowerShell `if ($?)` chains (it once skipped a `git stash pop`; check `git stash list` after).
  Useful flags: `--only=<tag-prefix>` (informational rates, per-drawing baseline still gates),
  `--detail` (prints per-edge defect notes).
- **Sweep mechanics**: a metric kind absent from the baseline file is rate-gated only (no
  per-drawing gating) until `--update-baseline` records it. Per-drawing floors: a rise is a
  regression unless paid by a strictly-lower-tier gain in the same drawing (TIER map ~line 923).
- **LADDER rules**: ceilings/rates only go DOWN. Never recalibrate a ceiling upward — fix instead.
  Tier 0 (titleStruck/labelPierced/deadBand/throughContainer/leaf merges) is never purchasable.
- **Tests**: `node --experimental-strip-types --test tests/*.test.ts`. Snapshot regen (test
  fixtures only, safe): `$env:UPDATE_SNAPSHOTS='1'; node --experimental-strip-types --test tests/snapshot.test.ts`.
- **NEVER run `npm run examples`** (`scripts/render-examples.mjs`) — the user renders examples
  themselves and visually checks SVGs. (`npm run snapshots` also rewrites example SVGs — avoid.)
- Lint: `npx biome lint src scripts`. Typecheck: `npx tsc --noEmit`.
- Commit style: short imperative, with `(NB: ...)` caveat for known-failing state, e.g. `472aa1d`.
- CONTRIBUTING.md asks to open an issue first — not done yet.
- Dev probes (gitignored, `.tmp/`): `diag.ts <example> <disposition> [edgeIds]` dumps
  NODE/EDGE/LABEL/TITLE/REPAIRED_FROM; `away.ts <example> <disposition>` lists attachAway-flagged
  edges; `port-probe.ts` validates elk port behavior.
- Always answer in English, concise, architect/ELKjs-expert tone.

## 3. Committed (branch feature/optimize-flow-positionning)

- `8df01e6` — housekeeping: deleted obsolete `.tmp` probes, `.gitignore` gains `.tmp/`.
- `83f0cf8` — **B2+C fixes + 3 regenerated snapshots**:
  - B2: `spreadAttachments` (extracted, exported from edge-tidy.ts) now also runs **after**
    `optimiseRoutes` in scene-layout.ts — the optimiser re-crowds sides after tidyEdges spread
    them. attachTight 23→1.
  - C: `routedTitles = titleBoxesOf(scene, model)` re-derived **after** rerouteDetours/transpose
    and passed to tidyEdges/anchorFlowLabels. rerouteDetours' shift-down block translates the
    whole scene (+32.5px on logical-fr/slide), so boxes measured before it are stale and §4c's
    re-aim pass accepted a run through a title band it could not see (F19). Fixed the
    logical-fr/slide titleStruck 0→1 regression.

## 4. Uncommitted working tree — 4 work items

Verified at HEAD of this session; `npx tsc --noEmit` clean; unit tests 82/83 (only test 59,
pre-existing corpus-digest failure — needs user example re-render + `npm run snapshots`).

### (a) `scripts/sweep.ts` — new `sideHug` predicate (user issue 1)
Flags any run <3px off a node **or container** side with >24px shared span, unless the edge
attaches to that node. Measured corpus: **97** hits (logical-archi F02 riding SUIV_FLUX's left
side at 1px/47px; medium-tall F08 vs Settlement layer 1px/207px; F05 vs Investigation 2px/192px).
TIER 2. Ceiling calibrated post-fix at `0.0127` (49). **Note**: the house ladder's own `hug:`
(readability.ts) is **leaf-only, 8px/12px** — different metric, see §6 issue 1.

### (b) `src/edge-tidy.ts` — `clearSideHugs(scene)` (exported)
Translates a hugging run to SIDE_CLEAR=8px off the side (leaf sides: outward only; container
sides: toward the half the run sits in). Terminals may slide along their side, which clamps the
shift. Validates: sibling seats (attachShared t0), jog collapse/reversal, leaf hits, re-hug,
coincident (t0), **new crossings and NEW nearParallel refused** (same-tier purchases the ladder
rejects). Called from tidyEdges **and** from scene-layout after optimiseRoutes — `compactVertical`
shrinks gaps and *recreates* hugs (SUIV_FLUX overlap went 6px→47px after compaction).
Result: 97→49; remaining = validated debt (e.g. F02: terminal clamped ≥1021 but SUIV_FLUX's
west stubs end at 1026 — any position crosses them; needs re-side, not translation).
**Cleanup pending**: `sideDbg` debug helper (env `CAIRN_DEBUG_SIDE`) still in the function — remove before commit.

### (c) `src/label-anchor.ts` — labelStraddled fix (user issue 2, reseat-first)
`straddledSeat(box, vertical, ownEdge)` — exact port of the sweep's `straddledBy` (§4j: a foreign
run parallel to the label's own, strictly inside its box, is masked the same way by the halo —
unreadable). Now rejected in **both** seating sweeps, `alternatives`, `stretched`, and
`besideRun` (away=0 only). Crossing runs remain accepted in sweep 2 (halo masks them fine).
Result: **338→254** (ceiling 330, passes). Cost: labelOffLine 41→62 (labels whose only
straddle-free seat was off-run; still under ceiling 75). Fallback `seatOn(host)` deliberately
unchanged (keeps §4d over §4j when all seats straddled). **Spacing fallback (user-approved
second half) NOT implemented** — the 254 + 62 off-line are its population.

### (d) `src/scene-layout.ts` — elk port constraints two-pass (gros cluster, attachAway)
- `attachAwayOf(scene, model)`: exact port of the sweep's attachAway predicate (detour-exempt).
- `constrainPorts(graph, scene, flagged, model)`: for nodes touched by flagged flows, sets
  `elk.portConstraints: FIXED_SIDE` + per-flow ports with `elk.port.side` (**1×1, not 0×0** —
  0×0 crashes elk's scanline math on hierarchical graphs). Flagged flows face their
  counterpart (dominant axis); unflagged sibling flows keep elk's pass-1 side.
- Orchestration at end of `layout()`: pass 1 as before; if `attachAwayOf > 0`, rebuild the
  winning graph spec (direction/options tracked), constrain, re-layout, re-pipeline.
  `CAIRN_NO_PORT_PASS=1` disables the second pass (A/B testing).
- `selectionExtras(scene, model)`: injects the ladder's blind spots into the verdict —
  container-inclusive sideHug (t2) and labels-over-titles (t0) — because a whole-layout
  choice cannot afford them (added by a concurrent session).
- **Selection = `relayoutVerdict`** (local, position-tolerant): the house ladder keys defects
  by position, so a wholesale relayout's same-pair crossings read as gained+lost at two
  addresses and everything was refused. relayoutVerdict normalises keys (positions and
  segment indices stripped), keeps multiplicity as counts, walks tiers refusing any gain.
  **Tier-attribution bug fixed**: judge a key only at its own tier (`(w ?? n)!.tier !== tier`)
  — the `?? tier` fallback previously judged every key at every tier, refusing legitimate
  payments (a tier-1 win paying tier-2 collateral).
- try/catch backstop remains for elk crashes.
- Result: **attachAway 322→303**, zero per-drawing regressions.

## 5. Last measured sweep state (full corpus, 3884 flow-instances)

**Determinism**: an early session reported {attachAway 296, sideHug 64}; that was a *code
difference*, not nondeterminism — a follow-up session was editing the tree concurrently (added
`selectionExtras`, 1×1 ports). Verified stable since: repeated `--jobs=auto` runs and `--jobs=1`
are byte-identical.

| metric | now | ceiling | status |
|---|---|---|---|
| attachAway | 303 | 247 | ✗ (was 322) |
| sideHug | 24 | 50 | ✓ (97 → 24) |
| nearParallel | 63 | 53 | ✗ (was 62) |
| fanTangle | 62 | 59 | ✗ (was 54) |
| labelStraddled | 252 | 330 | ✓ (was 338) |
| labelOffLine | 58 | 75 | ✓ (was 41) |
| titleStruck | 98 | 789 | ✓ |
| everything else | — | — | ✓ |
| per-drawing regressions | 0 | — | ✓ (application-compact ×2 fixed via accepted trades) |
| per-drawing improvements | 402 | — | pending `--update-baseline` |

Unit tests 82/83 (only test 59, pre-existing corpus-digest — user re-renders examples).
Snapshots regenerated at the 303 state. Lint clean.

## 5b. Second-pass anatomy (measured, CAIRN_DEBUG_PORTS, serial sweep)

- 131 of 260 drawings trigger the port-constraint second pass (attachAway > 0 in pass 1).
- **18 accepted, 113 refused, 0 crashed** (1×1 ports fixed the elk scanline crash on themes/*).
- Refusals are honest: wholesale relayouts gain same-or-better-tier collateral (crossings,
  jogs, hugs) while clearing away-defects.
- Full pinning (every flow, not just flagged-incident) measured WORSE (304, nearParallel 66,
  application-compact regressions back) and was reverted — elk needs freedom on unflagged
  edges to reorganise corridors around the new ports.
- **elk port constraints have plateaued at 303.** The remaining ~56-over-ceiling need a
  different lever (see §6).

## 6. Remaining issues (priority order)

1. ~~sideHug over ceiling~~ — RESOLVED: stable at 24 (ceiling 50).
2. **attachAway 303 > 247 — elk port constraints have plateaued (§5b).** Remaining levers,
   user decision needed:
   (a) iterated port surgery (refuse → constrain collateral edges → retry) or FIXED_ORDER port
   ordering — deeper elk work, uncertain payoff, more sweep time;
   (b) **route-detour claim relaxation** (lower RATIO_THRESHOLD/MIN_WASTE so sub-threshold
   wraps get channels — detour-flagged routes are attachAway-exempt). This was the
   "channel-side planning" option deferred in favour of elk ports; the ports evidence is now
   on the table to revisit;
   (c) canvas growth — last resort per constraints.
3. **nearParallel 63 > 53, fanTangle 62 > 59** — moved by relayouts; same cluster decision.
4. **labelStraddled spacing fallback** (user-approved, unimplemented): when no straddle-free
   on-line seat exists, widen the gap between the parallel runs. Population = 252 straddled +
   58 off-line labels. Architecturally belongs in a route pass driven by label geometry, or
   fold into whatever reshapes the corridors next.
5. **Before commit**: remove `sideDbg` (clearSideHugs, env CAIRN_DEBUG_SIDE) and the
   CAIRN_DEBUG_PORTS block in scene-layout.ts (keep or strip the writeFileSync dump);
   snapshots are at the 303 state; re-run full sweep + unit tests + `npx biome lint src scripts`.
   Ask user before committing.
6. **Phase D (after green)**: `node --experimental-strip-types scripts/sweep.ts --jobs=auto
   --update-baseline` (direct node, never npm), re-verify, user re-renders examples, commit.
7. 16 example SVGs on disk are a stale/fresh mix from an aborted render — harmless, user's
   next full render overwrites them.

## 7. Key technical lessons (don't relearn the hard way)

- **Passes after tidyEdges recreate defects**: compactVertical shrinks y-gaps (recreates hugs,
  tight attachments); optimiseRoutes re-crowds sides. Fix pattern: extract the pass, call it
  again late (spreadAttachments, clearSideHugs). "Nothing below this line moves geometry"
  comments lie when you add a pass — update them.
- **Title boxes go stale** across any pass that translates the scene — re-derive, never reuse.
- **The house ladder is set-based per tier** (readability.ts): a defect *moving* = refused.
  Any new selection/validation logic must speak it (`inspect(...).local(allIds, new Map())` +
  `ladderAccepts`), never raw counts.
- **INVARIANTS §3**: a guard must measure what the invariant measures — port predicates
  verbatim between sweep and src (straddledSeat, attachAwayOf are exact ports).
- elk honors FIXED_SIDE + elk.port.side; edges reference ports by plain id in sources/targets;
  FIXED_SIDE constrains ALL edges of the node (hence sibling-port preservation in constrainPorts).
- elk nondeterminism was never observed; layout is deterministic — geometry diffs between runs
  mean code changed.
- `.tmp/diag.ts` calls `render()` after layout (render mutates geometry slightly, ~8px);
  sweep judges the pre-render scene. Numbers from diag are indicative, sweep is truth.
