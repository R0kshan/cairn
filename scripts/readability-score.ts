/**
 * Is this revision's corpus more readable than another's?
 *
 * The sweep answers "did anything regress against the recorded floor". That is
 * the gate, and it is deliberately unforgiving — but it cannot answer "is the
 * drawing *better* than main", because the floor is a committed file that lags
 * whatever the working tree does. This measures both revisions with their own
 * code and compares the results.
 *
 *     node --experimental-strip-types scripts/readability-score.ts
 *     node --experimental-strip-types scripts/readability-score.ts --base v1.0.0-RC16
 *     node --experimental-strip-types scripts/readability-score.ts --json
 *
 * The verdict is the **tier vector**, compared the way the ladder itself is
 * (§3): tiers from most to least serious, first difference decides. No quantity
 * of tier-3 tidying pays for one more tier-2 defect, so a single weighted number
 * would say the opposite of the rule the project actually enforces. The scalar
 * printed beside it is a headline, never the verdict.
 *
 * Rates are per 1000 flow-instances. The corpus grows, and comparing raw counts
 * across revisions would read a new example as a regression.
 *
 * The base revision is measured in a throwaway `git worktree`, so the working
 * tree is never touched and an uncommitted change is compared as it stands.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface Score {
  totalFlows: number;
  totals: Record<string, number>;
  byTier: number[];
  perDrawing: [string, [string, number][]][];
}

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const base = args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ?? "main";

/** Measure one checkout. `--score-json` gates nothing, so a revision whose
 *  baseline file disagrees with its code still reports. */
function measure(cwd: string): Score {
  const raw = execFileSync(
    process.execPath,
    ["--experimental-strip-types", join(cwd, "scripts", "sweep.ts"), "--jobs=auto", "--score-json"],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(raw) as Score;
}

const rates = (score: Score) => score.byTier.map((count) => (count / score.totalFlows) * 1000);

/** The ladder's own comparison: tiers in order, first difference decides. */
function verdictOf(before: number[], after: number[]): { tier: number; better: boolean } | null {
  for (let tier = 0; tier < before.length; tier++) {
    const delta = after[tier] - before[tier];
    if (Math.abs(delta) > 1e-9) return { tier, better: delta < 0 };
  }
  return null;
}

// Inside the repo, not the system temp dir: the worktree has no `node_modules`
// of its own, and Node resolves a bare import by walking *up* from the importing
// file. A sibling of the real checkout therefore finds nothing (`Cannot find
// package 'elkjs'`), while a child of it finds the dependencies already
// installed here.
const worktree = join(ROOT, ".readability-score-base");
let baseScore: Score;
try {
  rmSync(worktree, { recursive: true, force: true });
  execFileSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
  execFileSync("git", ["worktree", "add", "--detach", worktree, base], {
    cwd: ROOT,
    stdio: "ignore",
  });
  // One ruler, two subjects. `sweep.ts` carries every predicate itself and
  // imports only `src/`, so dropping this revision's copy into the base checkout
  // measures the base's *drawings* with this revision's *definitions*. Letting
  // each side run its own sweep would compare two measurements taken with
  // different instruments — and the base's would not know `--score-json` anyway.
  copyFileSync(join(ROOT, "scripts", "sweep.ts"), join(worktree, "scripts", "sweep.ts"));
  baseScore = measure(worktree);
} finally {
  rmSync(worktree, { recursive: true, force: true });
  execFileSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
}
const headScore = measure(ROOT);

const beforeRates = rates(baseScore);
const afterRates = rates(headScore);
const verdict = verdictOf(beforeRates, afterRates);

/**
 * `process.exitCode`, never `process.exit()`: stdout is asynchronous when it is a
 * pipe — which is what CI and `--json` are — and exiting outright drops whatever
 * has not reached the OS. Setting the code lets Node leave of its own accord once
 * the writes have drained. The `--json` payload carries both revisions'
 * per-drawing rows, so it is the one most likely to be cut.
 */
const failed = () => (verdict && !verdict.better ? 1 : 0);

if (asJson) {
  console.log(
    JSON.stringify({ base, baseScore, headScore, beforeRates, afterRates, verdict }, null, 1),
  );
  process.exitCode = failed();
} else {

  const pad = (text: string, width: number) => text.padEnd(width);
  const sign = (delta: number) => (delta > 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3));

  console.log(`readability: working tree vs ${base}`);
  console.log(
  `  flows ${baseScore.totalFlows} -> ${headScore.totalFlows}   (rates are per 1000 flows)\n`,
  );
  console.log(`  ${pad("tier", 6)}${pad(base, 12)}${pad("this", 12)}delta`);
  for (let tier = 0; tier < beforeRates.length; tier++) {
  const delta = afterRates[tier] - beforeRates[tier];
  const mark = Math.abs(delta) < 1e-9 ? " " : delta < 0 ? "↓" : "↑";
  console.log(
    `  ${pad(String(tier), 6)}${pad(beforeRates[tier].toFixed(3), 12)}${pad(
      afterRates[tier].toFixed(3),
      12,
    )}${sign(delta)} ${mark}`,
  );
  }

  const kinds = [...new Set([...Object.keys(baseScore.totals), ...Object.keys(headScore.totals)])];
  const moved = kinds
  .map((kind) => {
    const was = ((baseScore.totals[kind] ?? 0) / baseScore.totalFlows) * 1000;
    const now = ((headScore.totals[kind] ?? 0) / headScore.totalFlows) * 1000;
    return { kind, was, now, delta: now - was };
  })
  .filter((row) => Math.abs(row.delta) > 1e-9)
  .sort((a, b) => a.delta - b.delta);

  if (moved.length) {
  console.log(`\n  per metric (rate per 1000 flows)`);
  for (const row of moved)
    console.log(
      `  ${pad(row.kind, 18)}${pad(row.was.toFixed(3), 12)}${pad(row.now.toFixed(3), 12)}${sign(
        row.delta,
      )}`,
    );
  }

  console.log();
  if (!verdict) console.log("  = no change on any tier");
  else if (verdict.better) console.log(`  BETTER — first difference at tier ${verdict.tier}, lower`);
  else console.log(`  WORSE — first difference at tier ${verdict.tier}, higher`);

  process.exitCode = failed();
}
