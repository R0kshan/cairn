/**
 * INVARIANTS §16 — flow positioning is blind to the DSL.
 *
 * Every pass that moves a flow sees geometry only: no element kind, no view
 * name. DSL meaning enters at `scene-layout` and stops there. Break this and a
 * new view inherits none of the routing tuning, while every ratchet in
 * `scripts/sweep.ts` silently becomes a measurement of the special case.
 *
 * The kind list comes from the `views` registry rather than a literal here, so
 * a kind added later is covered without editing this file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { views } from "../src/views.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Passes that may move a flow, a label, or a band. */
const POSITIONING_PASSES = [
  "edge-tidy.ts",
  "route-detour.ts",
  "label-anchor.ts",
  "compact.ts",
  "readability.ts",
];

/** Every element kind and view name the DSL knows about. */
const dslTerms = [
  ...new Set([
    ...Object.keys(views),
    ...Object.values(views).flatMap((view) => view.kinds),
  ]),
];

/**
 * Source with comments removed. Only code is searched: a comment naming a kind
 * is documentation, not a dependency on it.
 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Quoted occurrences of a DSL term — how a pass would branch on one. */
function dslTermsIn(code: string): string[] {
  return dslTerms.filter((term) => code.includes(`"${term}"`) || code.includes(`'${term}'`));
}

for (const pass of POSITIONING_PASSES) {
  test(`${pass} never branches on a DSL kind or view name (INVARIANTS §16)`, () => {
    assert.deepEqual(dslTermsIn(codeOf(pass)), []);
  });
}

test("only route-detour reaches for the Model, and only for style (INVARIANTS §16)", () => {
  const importsModel = POSITIONING_PASSES.filter((pass) =>
    /^import .*from "\.\/models\/ast\.ts";$/m.test(codeOf(pass)),
  );
  assert.deepEqual(importsModel, ["route-detour.ts"]);
});

test("no positioning pass imports the views registry (INVARIANTS §16)", () => {
  const importsViews = POSITIONING_PASSES.filter((pass) => codeOf(pass).includes('from "./views.ts"'));
  assert.deepEqual(importsViews, []);
});
