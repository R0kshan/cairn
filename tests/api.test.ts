/**
 * Public API suite: `compile()` and the flow-matrix formatters as an embedder
 * calls them. The other suites drive the stages directly, so nothing else here
 * covers the one-call surface `dist/cairn.mjs` publishes.
 * Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, matrixCsv } from "../src/api.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EX = join(ROOT, "examples");
const load = (f: string) => readFileSync(join(EX, f), "utf8").replace(/\r\n/g, "\n");

test("compile() leaves the matrix out unless it is asked for", async () => {
  const result = await compile(load("infrastructure.cairn"));
  assert.equal(result.matrix, null);
});

test("compile({ matrix: true }) tabulates every flow", async () => {
  const result = await compile(load("infrastructure.cairn"), { matrix: true });
  // infrastructure.cairn declares 13 flows; the matrix is one row per flow.
  assert.equal(result.matrix?.rows.length, 13);
});

test("the API and the CLI produce the same matrix bytes", async () => {
  // The committed companion is written by `cairn matrix` (scripts/render-examples.mjs).
  // If the two paths ever diverge, an embedder's table stops matching the dossier.
  const result = await compile(load("infrastructure.cairn"), { matrix: true });
  assert.equal(matrixCsv(result.matrix!), load("infrastructure.flow.csv"));
});

test("the matrix locale follows the diagram's style { lang }", async () => {
  const result = await compile(load("infrastructure-fr.cairn"), { matrix: true });
  assert.equal(result.matrix?.lang, "fr");
});

test("a source with errors returns no matrix rather than throwing", async () => {
  const result = await compile(load("broken.cairn"), { matrix: true });
  assert.equal(result.matrix, null);
});

test("a valid diagram with no flows returns an empty matrix, not an error", async () => {
  const result = await compile('diagram logical "t"\nsystem S "s" { block B "b" }\n', {
    matrix: true,
  });
  assert.deepEqual(result.matrix?.rows, []);
});

test("compile() still returns the svg when the matrix is requested", async () => {
  const result = await compile(load("infrastructure.cairn"), { matrix: true });
  assert.ok(result.svg?.startsWith("<svg"));
});
