/**
 * Exercises the published package the way a consumer does.
 *
 * Everything else in `tests/` imports `../src/*.ts` directly, which proves the
 * pipeline works but proves nothing about what `npm install @r0kshan/cairn`
 * actually hands someone: the `exports` map could point at a missing file, the
 * wrong condition, or a bundle that throws on load, and every other test would
 * still pass.
 *
 * So this resolves **by package name** — Node's self-reference, which is driven
 * by the real `exports` map — rather than by path. If the map is wrong, these
 * tests fail to import.
 *
 * Requires `npm run build:package` first (`lib/` is not committed). Run via
 * `npm run test:package`, not `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, themeNames, version } from "@r0kshan/cairn";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const example = (name: string): string => readFileSync(join(ROOT, "examples", name), "utf8");

test("compile() renders a valid diagram through the package entry", async () => {
  const source = example("infrastructure-large.cairn");

  const result = await compile(source);

  assert.equal(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    0,
    "expected zero error diagnostics",
  );
  assert.ok(result.svg, "expected non-null svg");
  assert.match(result.svg, /^<svg/, "expected the svg to start with an <svg> element");
  assert.ok(result.metrics, "expected metrics alongside a successful render");
  assert.ok(result.metrics.width > 0 && result.metrics.height > 0, "expected positive dimensions");
  assert.equal(result.metrics.overlaps, 0, "invariant §1: zero label overlaps");
});

test("compile() reports invalid source as diagnostics, never as a throw", async () => {
  const source = example("broken.cairn");

  const result = await compile(source);

  assert.equal(result.svg, null, "expected no svg for a broken diagram");
  assert.equal(result.metrics, null, "expected no metrics for a broken diagram");
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    "expected at least one error diagnostic",
  );
});

test("compile() honours the theme option", async () => {
  const source = example("logical.cairn");

  const [themed, plain] = await Promise.all([
    compile(source, { theme: "classic-dark" }),
    compile(source),
  ]);

  assert.ok(themed.svg && plain.svg, "expected both renders to succeed");
  assert.notEqual(themed.svg, plain.svg, "expected the theme option to change the output");
});

test("package exports themeNames and a version matching package.json", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  assert.ok(Array.isArray(themeNames) && themeNames.length > 0, "expected non-empty themeNames");
  assert.ok(themeNames.includes("classic-dark"), "expected the classic-dark theme to be listed");
  assert.equal(version, manifest.version);
});

test("the browser bundle renders without any Node global present", async () => {
  // The `browser` export condition is what Vite and friends resolve, and that
  // bundle is built with --platform=browser, which shims nothing. A bare
  // `process` reference in engine code throws only there — never under Node,
  // where every other test runs. Same guard as tests/playground.test.ts, on the
  // artifact npm actually ships.
  const bundleUrl = new URL("../../lib/index.browser.js", import.meta.url).href;
  const { compile: browserCompile } = await import(bundleUrl);
  const source = example("infrastructure-large.cairn");

  const realProcess = globalThis.process;
  Reflect.deleteProperty(globalThis, "process");
  let result: { svg: string | null } | undefined;
  let thrown: unknown;
  try {
    result = await browserCompile(source);
  } catch (error) {
    thrown = error;
  } finally {
    globalThis.process = realProcess;
  }

  assert.equal(thrown, undefined, `browser bundle must not need a Node global: ${thrown}`);
  assert.ok(result?.svg, "expected non-null svg from the browser bundle");
});
