/**
 * Non-regression snapshot gate.
 *
 * Committed snapshots are the "known-good" render of a curated canary set. On
 * every run we rebuild them and diff. An unintended change fails the build; an
 * INTENDED change is acknowledged by regenerating and committing (`npm run
 * snapshots`).
 *
 * Snapshots are *normalized* (1dp) because one value in the output path comes
 * from Math.hypot, which isn't bit-identical across OSes / Node versions.
 * Rounding to 1dp erases sub-pixel drift while catching any real change.
 *
 * Three paths are guarded:
 *   1. CANARIES — diagram rendering (parse → validate → layout → render)
 *   2. THEMES — one snapshot per built-in theme
 *   3. MATRIX — flow-matrix exporters (csv/md/svg), every view × every format
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { buildFlowMatrix, matrixCsv, matrixMd, matrixSvg } from "../src/flow-matrix.ts";
import { views } from "../src/views.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, "..", "examples");
const SNAP = join(HERE, "__snapshots__");
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

// Curated canary set — deliberately small so an intended change produces a
// reviewable diff. Covers each view at large/dense scale in both languages,
// plus the reroute-heavy numbered case and custom per-element colours.
const CANARIES = [
  "logical.cairn", // logical view, canonical (small) example
  "large.cairn", // logical view, large — en
  "large-fr.cairn", // logical view, large — fr
  "application-large.cairn", // application view, large — en
  "application-large-fr.cairn", // application view, large — fr
  "infrastructure-large.cairn", // infrastructure view, large — en
  "infrastructure-large-fr.cairn", // infrastructure view, large — fr
  "large-numbered.cairn", // numbered flows (exercises the hypot path)
  "colors-custom.cairn", // per-element fill/stroke/text rendering
  "infrastructure-fr.cairn", // lang: fr on a smaller diagram
];

// One example per built-in theme — guards every palette against shared-code changes that only show up on non-default themes.
const THEMES = [
  "classic",
  "classic-dark",
  "contrast",
  "dark",
  "light",
  "nord",
  "sand",
  "slate",
  "solarized",
];

// Read a file and normalize line endings.
const load = (dir: string, f: string) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");

// Round every decimal to 1dp; leave integers untouched. Absorbs cross-platform Math.hypot drift.
const normalize = (svg: string): string =>
  svg.replace(/-?\d+\.\d+/g, (m) => (Math.round(parseFloat(m) * 10) / 10).toString());

// Parse and validate a source string. Asserts zero errors as a snapshot precondition.
const parseAndValidate = (src: string) => {
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  assert.equal(
    diags.filter((d) => d.severity === "error").length,
    0,
    "snapshot precondition — build has no errors",
  );
  return model;
};

// Build a `.cairn` file through the full pipeline (parse → validate → layout → render), returning the SVG string.
const buildSvg = async (dir: string, file: string): Promise<string> => {
  const model = parseAndValidate(load(dir, file));
  const view = views[model.type!];
  const scene = await layout(model, view);
  return render(model, view, scene).svg;
};

// Assert that `actual` matches the committed snapshot, or write it if `UPDATE_SNAPSHOTS` is set or the file doesn't exist yet.
function snapshotAssert(name: string, actual: string) {
  const path = join(SNAP, name);
  if (UPDATE || !existsSync(path)) {
    mkdirSync(SNAP, { recursive: true });
    writeFileSync(path, actual);
    return; // regenerating / first run: record, don't assert
  }
  const expected = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  assert.equal(
    actual,
    expected,
    `${name} changed vs its committed snapshot. If this change is INTENTIONAL, ` +
      `run \`npm run snapshots\` and commit tests/__snapshots__/ in the same PR. ` +
      `If it is NOT, you've hit a regression.`,
  );
}

// ---------- 1. diagram canaries ----------

for (const file of CANARIES) {
  test(`snapshot: ${file}`, async () => {
    const actual = normalize(await buildSvg(EX, file));
    snapshotAssert(file.replace(/\.cairn$/, ".snap.svg"), actual);
  });
}

// ---------- 2. themes ----------

const THEMES_DIR = join(EX, "themes");

for (const theme of THEMES) {
  test(`snapshot: theme ${theme}`, async () => {
    const actual = normalize(await buildSvg(THEMES_DIR, `${theme}.cairn`));
    snapshotAssert(`theme-${theme}.snap.svg`, actual);
  });
}

// ---------- 3. flow-matrix exporters ----------
// The matrix (csv/md/svg) is a separate code path from diagram rendering
// (src/flow-matrix.ts) — the DSL -> Model parsing is shared, but each exporter has
// its own formatting logic, so each format gets its own snapshot.

// Every view × every format. The column set is per-view data (`views.ts` →
// `View.matrix`), so a change there that silently reshapes one view's table
// would otherwise only show up in whichever view happened to be snapshotted.
const MATRIX_SOURCE = "infrastructure-large.cairn";
const MATRIX_SOURCES = [
  "logical.cairn", // no technical tail at all
  "application.cairn", // protocol, no port
  MATRIX_SOURCE, // the reference shape: protocol + port
  "security.cairn", // protocol only, trust-zone annotation
];

for (const file of MATRIX_SOURCES) {
  const stem = file.replace(/\.cairn$/, "");
  const matrixOf = () => {
    const model = parseAndValidate(load(EX, file));
    return buildFlowMatrix(model, views[model.type!]);
  };

  test(`snapshot: matrix csv — ${stem}`, () => {
    snapshotAssert(`matrix-${stem}.csv`, matrixCsv(matrixOf()));
  });

  test(`snapshot: matrix md — ${stem}`, () => {
    snapshotAssert(`matrix-${stem}.md`, matrixMd(matrixOf()));
  });

  test(`snapshot: matrix svg — ${stem}`, () => {
    snapshotAssert(`matrix-${stem}.snap.svg`, normalize(matrixSvg(matrixOf())));
  });
}

// ---------- determinism invariants (never need acknowledging) ----------
// If either of these ever fails, the snapshot gate itself is unsound (you'd
// get false regressions) — worth catching directly rather than as a mystery
// snapshot diff.

test("render is deterministic (same input → identical SVG)", async () => {
  const a = await buildSvg(EX, "large-numbered.cairn");
  const b = await buildSvg(EX, "large-numbered.cairn");
  assert.equal(a, b, "non-deterministic render — output must be stable for snapshotting to work");
});

test("matrix generation is deterministic (same input → identical output)", () => {
  const model = parseAndValidate(load(EX, MATRIX_SOURCE));
  const build = () => buildFlowMatrix(model, views[model.type!]);
  assert.equal(matrixCsv(build()), matrixCsv(build()));
  assert.equal(matrixMd(build()), matrixMd(build()));
  assert.equal(matrixSvg(build()), matrixSvg(build()));
});
