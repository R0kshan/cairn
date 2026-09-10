/**
 * Guards the committed browser bundle (`playground/cairn-engine.js`) against
 * referencing Node-only globals, and round-trips the page's drag writeback
 * through the real parser — the DSL a drag writes has to be DSL cairn reads. The bundle runs in a real browser, where
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

// ---------- drag writeback ----------

/**
 * Lifts the page's own writeback functions out of `index.html` and into a
 * module, so the round-trip below tests the code that actually ships rather
 * than a copy of it that can drift.
 */
async function pageWriteback(): Promise<{
  writeOffset: (source: string, box: Record<string, unknown>, dx: number, dy: number) => string;
}> {
  const html = readFileSync(join(ROOT, "playground/index.html"), "utf8");
  const start = html.indexOf("// #region drag-writeback");
  const end = html.indexOf("// #endregion drag-writeback");
  assert.ok(start >= 0 && end > start, "the drag-writeback markers are gone from the playground");
  const source = html.slice(start, end);
  for (const name of ["spliceSpan", "readSpan", "writeOffset"])
    assert.ok(source.includes(`function ${name}(`), `\`${name}\` left the marked region`);
  return import(`data:text/javascript,${encodeURIComponent(`${source}\nexport { writeOffset };`)}`);
}

const DRAG_SRC = `diagram application "t"
actor-group G "Actors" {
  actor USER "User"
}
application APP "App" {
  module M1 "Mod one"
}
USER -> M1 : "Request"
`;

test("a drag writes DSL the parser reads back as the same offset", async () => {
  const { writeOffset } = await pageWriteback();
  const { parse } = await import("../src/parser.ts");
  const moduleOf = (src: string) => parse(src).model.elements[1].children[0];

  // No body yet: the drag has to open one.
  const opened = writeOffset(DRAG_SRC, { id: "M1", what: "element", line: 6 }, 40, -20);
  assert.equal(parse(opened).diags.filter((d) => d.severity === "error").length, 0);
  assert.deepEqual(moduleOf(opened).offset?.dx, 40);
  assert.deepEqual(moduleOf(opened).offset?.dy, -20);

  // Dragging again adds to what is there instead of replacing it, which is what
  // makes a series of small corrections behave the way a mouse implies.
  const span = moduleOf(opened).offset!.span;
  const again = writeOffset(opened, { id: "M1", what: "element", offsetSpan: span }, -15, 5);
  assert.equal(moduleOf(again).offset?.dx, 25);
  assert.equal(moduleOf(again).offset?.dy, -15);

  // A flow label with no inline block, then one that already has a style block.
  const labelled = writeOffset(DRAG_SRC, { id: "F01", what: "label", line: 8 }, 12, -6);
  assert.deepEqual(parse(labelled).model.flows[0].labelOffset?.dx, 12);
  // And a second drag on the same label adds to it rather than clobbering the key.
  const labelSpan = parse(labelled).model.flows[0].labelOffset!.span;
  const twice = writeOffset(labelled, { id: "F01", what: "label", offsetSpan: labelSpan }, 3, 3);
  assert.equal(parse(twice).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(parse(twice).model.flows[0].labelOffset?.dx, 15);
  assert.equal(parse(twice).model.flows[0].labelOffset?.dy, -3);
  const styled = DRAG_SRC.replace("(", "(").replace(
    'USER -> M1 : "Request"',
    'USER -> M1 : "Request" { stroke: dashed }',
  );
  const both = writeOffset(styled, { id: "F01", what: "label", line: 8 }, 12, -6);
  assert.equal(parse(both).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(parse(both).model.flows[0].labelOffset?.dy, -6);
  assert.equal(parse(both).model.flows[0].style?.stroke?.style, "dashed");
});
