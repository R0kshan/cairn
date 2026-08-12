/**
 * Block-nesting gate: the deepest `if`/`for`/`while` nesting each source file
 * reaches. Run with `npm run nesting`.
 *
 * Biome's `noExcessiveCognitiveComplexity` already punishes nesting, but only
 * as part of one score — a function can trade breadth for depth and keep the
 * same number. Depth is what a reader actually pays for, so it gets its own
 * ceiling. `noExcessiveNestedCallbacks` does not cover this: it counts nested
 * *callbacks*, and the deep code here is plain `if`/`for` blocks.
 *
 * `CEILING` works like `sweep.ts`'s `CEILING_RATE` — a ratchet over debt that
 * cannot be zero yet. Lower an entry whenever a change earns it; never raise
 * one to make a run pass. Files absent from the table are held at `DEFAULT`.
 *
 * Depth is read from indentation, which is exact here because biome formats
 * every file at two spaces and the reader sees the same thing. Block comments
 * and template literals are stripped first — both indent for reasons that have
 * nothing to do with control flow.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDENT_WIDTH = 2;

/** Depth every file is held to unless it appears in `CEILING`. */
const DEFAULT = 6;

/**
 * Files carrying nesting debt, each at the exact depth it reaches today. An
 * entry with slack is an entry to lower — the run says so when it sees one.
 */
const CEILING: Record<string, number> = {
  "edge-tidy.ts": 10,
  "scene-layout.ts": 7,
  "svg-render.ts": 7,
  "watch.ts": 7,
};

interface Deepest {
  depth: number;
  line: number;
}

/**
 * Deepest indentation reached by a line of actual code. Returns depth 0 for a
 * file that is entirely comment or string.
 */
function deepestNesting(source: string): Deepest {
  let inBlockComment = false;
  let inTemplate = false;
  let depth = 0;
  let line = 0;

  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const wasInside = inBlockComment || inTemplate;

    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
    } else if (inTemplate) {
      if (countUnescapedBackticks(trimmed) % 2 === 1) inTemplate = false;
    } else if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
    } else if (countUnescapedBackticks(trimmed) % 2 === 1) {
      inTemplate = true;
    }

    if (wasInside || !trimmed || trimmed.startsWith("//")) continue;

    const indent = raw.length - raw.trimStart().length;
    const here = Math.floor(indent / INDENT_WIDTH);
    if (here > depth) {
      depth = here;
      line = index + 1;
    }
  }
  return { depth, line };
}

function countUnescapedBackticks(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++)
    if (text[index] === "`" && text[index - 1] !== "\\") count++;
  return count;
}

const files = readdirSync(join(ROOT, "src"))
  .filter((name) => name.endsWith(".ts"))
  .sort();

let failed = false;
const rows: string[] = [];

for (const name of files) {
  const { depth, line } = deepestNesting(readFileSync(join(ROOT, "src", name), "utf8"));
  const debt = CEILING[name];
  const ceiling = debt ?? DEFAULT;
  const ok = depth <= ceiling;
  if (!ok) failed = true;
  const earned = debt !== undefined && depth < debt;
  rows.push(
    `  ${ok ? "✓" : "✗"} ${name.padEnd(20)} depth ${String(depth).padStart(2)}` +
      ` / ceiling ${String(ceiling).padStart(2)}` +
      (depth > 0 ? `  src/${name}:${line}` : "") +
      (earned ? `  ← ratchet earned: lower to ${depth}` : ""),
  );
}

console.log("Block nesting depth\n");
console.log(rows.join("\n"));

if (failed) {
  console.log("\n✗ a file nests deeper than its ceiling. Extract a function; do not raise the ceiling.");
  process.exit(1);
}
console.log("\n✓ every file within its ceiling.");
