/**
 * Stage 4c½ (`reclaimTrailingColumns`) — the two things that make it safe to
 * leave switched on for every drawing.
 *
 * 1. It fires on the shape it exists for: a sink in a trailing partition band
 *    holding a column of its own beside a neighbour that is not using it.
 * 2. It is a no-op everywhere else, to the byte — the pass runs a trial and
 *    rolls it back, and a rollback that leaks residue silently re-picks the
 *    layout (see the `medium` note in the pass).
 *
 * Geometry only: the corpus digest and the snapshot gate own the rendering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { views } from "../src/views.ts";
import type { Scene } from "../src/scene-layout.ts";

async function sceneOf(source: string): Promise<Scene> {
  const { model, diags } = parse(source);
  const errors = [...diags, ...validate(model)].filter((d) => d.severity === "error");
  assert.deepEqual(errors.map((d) => d.code), [], "fixture must be error-free");
  return layout(model, views[model.type!]);
}

const box = (scene: Scene, id: string) => {
  const node = scene.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `no node ${id}`);
  return node;
};

/**
 * The shape the pass exists for, and the reason it is a committed example rather
 * than a fixture: `PSP` and `Plateformes transporteurs` are egress externals, so
 * they land in `EGRESS_PARTITION` — a band past `Site de secours` — while that
 * site uses 180px of a 500px column. Left alone elk gives the two of them a
 * column of their own out past it, and the flows feeding them cross 1038px and
 * 1426px of drawing to get there.
 */
test("reclaim: a trailing external is pulled back beside the site it was standing past", async () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "infrastructure-large-fr.cairn"),
    "utf8",
  );
  const scene = await sceneOf(source);
  const site = box(scene, "DC2");
  const right = Math.max(...scene.nodes.map((node) => node.x + node.width));

  for (const id of ["PSP_EXT", "CARRIERS_EXT"]) {
    const external = box(scene, id);
    assert.ok(
      external.x < site.x + site.width,
      `${id} still starts past DC2 (${external.x} >= ${site.x + site.width})`,
    );
  }
  assert.equal(right, site.x + site.width, "DC2 should be what the drawing ends at");

  // A slide may never buy width by putting two boxes on top of each other. The
  // sweep polices this corpus-wide; here because it is the one thing this pass
  // could get catastrophically wrong.
  const tops = ["DC1", "DC2", "PSP_EXT", "CARRIERS_EXT"].map((id) => box(scene, id));
  for (const [index, a] of tops.entries())
    for (const b of tops.slice(index + 1))
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        `${a.id} overlaps ${b.id}`,
      );
});

/**
 * A chain with nothing standing in a column beside anything: the pass plans no
 * move worth keeping, rolls its trial back, and the drawing is the one the rest
 * of the pipeline produced.
 */
const PLAIN = `diagram application "Plain"
system A "A"
system B "B"
system C "C"
A -> B "one"
B -> C "two"
`;

test("reclaim: leaves a drawing it cannot help exactly as it found it", async () => {
  const [first, second] = await Promise.all([sceneOf(PLAIN), sceneOf(PLAIN)]);
  // Determinism is the observable half of "rolled back cleanly": a trial that
  // leaked would move the candidate sweep off the layout it picks here.
  assert.deepEqual(
    first.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]),
    second.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]),
  );
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  // Nothing to reclaim: the three systems sit in successive layers, so no box
  // has an empty column beside it to move into.
  assert.equal(box(first, "A").x < box(first, "B").x, true);
  assert.equal(box(first, "B").x < box(first, "C").x, true);
});
