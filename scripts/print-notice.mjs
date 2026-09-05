/**
 * Print the third-party notice in the form a caller asks for.
 *
 *   node --experimental-strip-types scripts/print-notice.mjs           plain text
 *   node --experimental-strip-types scripts/print-notice.mjs --banner  `/*!` comment
 *
 * `src/notice.ts` is the single source; this is the seam that lets the shell
 * build scripts read it. Pass `--bun` for the binaries' variant (the one that
 * also names the embedded Bun runtime) — no esbuild bundle needs it, so the
 * banner never does.
 */
import { notice } from "../src/notice.ts";

const argv = process.argv.slice(2);
const text = notice({ bun: argv.includes("--bun") });

if (!argv.includes("--banner")) {
  process.stdout.write(`${text}\n`);
} else {
  // `/*!` rather than a plain `/*`: esbuild's `--legal-comments` only preserves
  // comments it recognises as legal, and `--minify` drops everything else. This
  // is exactly the trap elkjs' own plain-block-comment header falls into.
  const body = text
    .split("\n")
    .map((line) => (line ? ` * ${line}` : " *"))
    .join("\n");
  process.stdout.write(`/*!\n${body}\n */\n`);
}
