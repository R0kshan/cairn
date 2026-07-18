// Non-regression snapshot gate.
//
// The idea: a real regression is a change to output that WASN'T supposed to
// change. CI can't infer intent, so we encode it: the committed snapshots below
// are the "known-good" render of a curated canary set. On every run we rebuild
// them and diff. An unintended change => the diff fails the build. An INTENDED
// change is acknowledged by regenerating and committing the snapshots in the
// same PR (`npm run snapshots`) — so the diff is clean and CI passes. That
// commit is the acknowledgement; without it, the gate fires.
//
// Why *normalized* snapshots (not raw byte diffs): the render is
// byte-deterministic on a given machine, but one value in the diagram output
// path comes from Math.hypot (numbered-flow label placement), which isn't
// guaranteed identical to the last bit across OSes / Node versions. Rounding
// every decimal to 1 dp erases that sub-pixel drift while still catching any
// real change (>=0.1px move, colour, text, or structural change). Integers are
// pure round/ceil output and are left as-is. The matrix outputs (CSV/MD) are
// plain text and need no normalization; the matrix SVG goes through the same
// float-normalizer as diagrams for the same reason.
//
// Three things are snapshotted here, each guarding a distinct code path:
//   1. CANARIES     — diagram rendering (parse -> validate -> layout -> render)
//   2. THEMES        — one snapshot per built-in theme/palette
//   3. MATRIX        — the infrastructure flow-matrix exporters (csv/md/svg)
//
// Regenerate after an intended change:  npm run snapshots

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parse.ts';
import { validate } from '../src/validate.ts';
import { layout } from '../src/layout.ts';
import { render } from '../src/render.ts';
import { matrixCsv, matrixMd, matrixSvg } from '../src/matrix.ts';
import { views } from '../src/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, '..', 'examples');
const SNAP = join(HERE, '__snapshots__');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

// Curated canary set — deliberately small so an intended change produces a
// reviewable diff, not 60 noisy ones. Covers each view at large/dense scale in
// BOTH languages (the highest-surface-area case per view: most nodes, most
// edges, most labels, and — for fr — the full localized chrome), plus the
// reroute-heavy numbered case and custom per-element colours. A regression in
// layout, rendering, OR i18n shows up in at least one snapshot.
const CANARIES = [
  'logical.cairn',                  // logical view, canonical (small) example
  'large.cairn',                    // logical view, large — en
  'large-fr.cairn',                 // logical view, large — fr
  'application-large.cairn',        // application view, large — en
  'application-large-fr.cairn',     // application view, large — fr
  'infrastructure-large.cairn',     // infrastructure view, large — en
  'infrastructure-large-fr.cairn',  // infrastructure view, large — fr
  'large-numbered.cairn',           // numbered flows (exercises the hypot path)
  'colors-custom.cairn',            // per-element fill/stroke/text rendering
  'infrastructure-fr.cairn',        // lang: fr on a smaller diagram
];

// One example per built-in theme (examples/themes/*.cairn) — guards every
// palette (fills, strokes, text colours) against an accidental shared-code
// change that only shows up on non-default themes.
const THEMES = [
  'classic', 'classic-dark', 'contrast', 'dark',
  'light', 'nord', 'sand', 'slate', 'solarized',
];

const load = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');

// Round every decimal to 1 dp; leave integers untouched. Stable across
// platforms; still sensitive to any change a human would call a regression.
const normalize = (svg: string): string =>
  svg.replace(/-?\d+\.\d+/g, (m) => (Math.round(parseFloat(m) * 10) / 10).toString());

const parseAndValidate = (src: string) => {
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  assert.equal(
    diags.filter((d) => d.severity === 'error').length, 0,
    'snapshot precondition — build has no errors',
  );
  return model;
};

const buildSvg = async (dir: string, file: string): Promise<string> => {
  const model = parseAndValidate(load(dir, file));
  const view = views[model.type!];
  const scene = await layout(model, view);
  return render(model, view, scene).svg;
};

// Shared assert-or-record logic for every snapshot kind below.
function snapshotAssert(name: string, actual: string) {
  const path = join(SNAP, name);
  if (UPDATE || !existsSync(path)) {
    mkdirSync(SNAP, { recursive: true });
    writeFileSync(path, actual);
    return; // regenerating / first run: record, don't assert
  }
  const expected = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(
    actual, expected,
    `${name} changed vs its committed snapshot. If this change is INTENTIONAL, ` +
    `run \`npm run snapshots\` and commit tests/__snapshots__/ in the same PR. ` +
    `If it is NOT, you've hit a regression.`,
  );
}

// ---------- 1. diagram canaries ----------

for (const file of CANARIES) {
  test(`snapshot: ${file}`, async () => {
    const actual = normalize(await buildSvg(EX, file));
    snapshotAssert(file.replace(/\.cairn$/, '.snap.svg'), actual);
  });
}

// ---------- 2. themes ----------

const THEMES_DIR = join(EX, 'themes');

for (const theme of THEMES) {
  test(`snapshot: theme ${theme}`, async () => {
    const actual = normalize(await buildSvg(THEMES_DIR, `${theme}.cairn`));
    snapshotAssert(`theme-${theme}.snap.svg`, actual);
  });
}

// ---------- 3. infrastructure flow-matrix exporters ----------
// The matrix (csv/md/svg) is a separate code path from diagram rendering
// (src/matrix.ts) — the DSL -> Model parsing is shared, but each exporter has
// its own formatting logic, so each format gets its own snapshot.

const MATRIX_SOURCE = 'infrastructure-large.cairn';

test('snapshot: matrix csv', () => {
  const model = parseAndValidate(load(EX, MATRIX_SOURCE));
  snapshotAssert('matrix-infrastructure-large.csv', matrixCsv(model, 'en'));
});

test('snapshot: matrix md', () => {
  const model = parseAndValidate(load(EX, MATRIX_SOURCE));
  const view = views[model.type!];
  snapshotAssert('matrix-infrastructure-large.md', matrixMd(model, view, 'en'));
});

test('snapshot: matrix svg', () => {
  const model = parseAndValidate(load(EX, MATRIX_SOURCE));
  const view = views[model.type!];
  snapshotAssert('matrix-infrastructure-large.snap.svg', normalize(matrixSvg(model, view, 'en')));
});

// ---------- determinism invariants (never need acknowledging) ----------
// If either of these ever fails, the snapshot gate itself is unsound (you'd
// get false regressions) — worth catching directly rather than as a mystery
// snapshot diff.

test('render is deterministic (same input → identical SVG)', async () => {
  const a = await buildSvg(EX, 'large-numbered.cairn');
  const b = await buildSvg(EX, 'large-numbered.cairn');
  assert.equal(a, b, 'non-deterministic render — output must be stable for snapshotting to work');
});

test('matrix generation is deterministic (same input → identical output)', () => {
  const model = parseAndValidate(load(EX, MATRIX_SOURCE));
  const view = views[model.type!];
  assert.equal(matrixCsv(model, 'en'), matrixCsv(model, 'en'));
  assert.equal(matrixMd(model, view, 'en'), matrixMd(model, view, 'en'));
  assert.equal(matrixSvg(model, view, 'en'), matrixSvg(model, view, 'en'));
});
