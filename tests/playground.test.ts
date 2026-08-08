/**
 * Guards the committed browser bundle (`playground/cairn-engine.js`) against
 * referencing Node-only globals. The bundle runs in a real browser, where
 * `process` does not exist — a bare reference throws a ReferenceError there
 * even though every other test in this suite runs under Node and never sees
 * the gap. Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_URL = new URL("../playground/cairn-engine.js", import.meta.url).href;

test("browser bundle renders a large diagram with no `process` global", async () => {
  const { compile } = await import(BUNDLE_URL);
  const src = readFileSync(join(ROOT, "examples/infrastructure-large.cairn"), "utf8");

  const realProcess = globalThis.process;
  Reflect.deleteProperty(globalThis, "process");
  let result: { svg: string | null; diagnostics: { severity: string }[] } | undefined;
  let thrown: unknown;
  try {
    result = await compile(src);
  } catch (error) {
    thrown = error;
  } finally {
    globalThis.process = realProcess;
  }

  assert.equal(thrown, undefined, `bundle must not throw without a Node global: ${thrown}`);
  assert.ok(result?.svg, "expected non-null svg output");
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "expected zero error diagnostics",
  );
});
