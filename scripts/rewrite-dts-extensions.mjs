/**
 * Rewrites relative `.ts` import specifiers to `.js` in emitted `.d.ts` files.
 *
 * cairn's sources import with explicit `.ts` extensions because Node runs them
 * directly (CONTRIBUTING.md, "Why no build step works for cairn"). TypeScript
 * carries those specifiers verbatim into declaration output, where a consumer
 * of the published package cannot resolve them — `allowImportingTsExtensions`
 * is enabled in *this* repo, not in theirs. TypeScript's own
 * `rewriteRelativeImportExtensions` does not help: it rewrites emitted
 * JavaScript, and `tsconfig.types.json` is `emitDeclarationOnly`.
 *
 * A `.js` specifier is the correct form in a declaration file: TypeScript
 * resolves it to the sibling `.d.ts`. Only relative specifiers are touched, so
 * package specifiers like `elkjs/lib/elk.bundled.js` are left alone.
 *
 * Usage: node scripts/rewrite-dts-extensions.mjs <directory>
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RELATIVE_TS_SPECIFIER = /(from\s*|import\s*\(\s*)(["'])(\.{1,2}\/[^"']*)\.ts\2/g;

async function declarationFilesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await declarationFilesIn(path)));
    else if (entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/rewrite-dts-extensions.mjs <directory>");
  process.exit(2);
}

let rewritten = 0;
for (const file of await declarationFilesIn(target)) {
  const source = await readFile(file, "utf8");
  const output = source.replace(RELATIVE_TS_SPECIFIER, "$1$2$3.js$2");
  if (output === source) continue;
  await writeFile(file, output);
  rewritten++;
}

console.log(`  rewrote ${rewritten} declaration file(s)`);
