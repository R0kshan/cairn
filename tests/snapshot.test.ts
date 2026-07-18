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
// Why a *normalized* snapshot (not a raw-SVG byte diff): the render is
// byte-deterministic on a given machine, but one value in the output path comes
// from Math.hypot (numbered-flow label placement), which isn't guaranteed
// identical to the last bit across OSes / Node versions. Rounding every decimal
// to 1 dp erases that sub-pixel drift while still catching any real change
// (>=0.1px move, colour, text, or structural change). Integers are pure
// round/ceil output and are left as-is.
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
import { views } from '../src/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, '..', 'examples');
const SNAP = join(HERE, '__snapshots__');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

// Curated canary set — deliberately small so an intended change produces a
// reviewable diff, not 60 noisy ones. Covers each view, the reroute-heavy and
// numbered cases, custom per-element colours, and localized (fr) output, so a
// regression in layout OR rendering OR i18n shows up in at least one snapshot.
const CANARIES = [
  'logical.cairn',              // logical view, canonical example
  'small.cairn',                // logical, minimal
  'medium.cairn',               // logical, mid-density
  'application-large.cairn',    // application view, dense edge routing
  'infrastructure-large.cairn', // infrastructure view + zones
  'security.cairn',             // security view (trust zones, levels)
  'large-numbered.cairn',       // numbered flows (exercises the hypot path)
  'colors-custom.cairn',        // per-element fill/stroke/text rendering
  'infrastructure-fr.cairn',    // lang: fr — localized chrome
];

const load = (f: string) => readFileSync(join(EX, f), 'utf8').replace(/\r\n/g, '\n');

// Round every decimal to 1 dp; leave integers untouched. Stable across
// platforms; still sensitive to any change a human would call a regression.
const normalize = (svg: string): string =>
  svg.replace(/-?\d+\.\d+/g, (m) => (Math.round(parseFloat(m) * 10) / 10).toString());

const buildSvg = async (file: string): Promise<string> => {
  const src = load(file);
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  assert.equal(
    diags.filter((d) => d.severity === 'error').length, 0,
    `${file}: snapshot precondition — build has no errors`,
  );
  const view = views[model.type!];
  const scene = await layout(model, view);
  return render(model, view, scene).svg;
};

for (const file of CANARIES) {
  test(`snapshot: ${file}`, async () => {
    const actual = normalize(await buildSvg(file));
    const path = join(SNAP, file.replace(/\.cairn$/, '.snap.svg'));

    if (UPDATE || !existsSync(path)) {
      mkdirSync(SNAP, { recursive: true });
      writeFileSync(path, actual);
      return; // regenerating / first run: record, don't assert
    }

    const expected = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(
      actual, expected,
      `${file} render changed vs its committed snapshot. If this change is INTENTIONAL, ` +
      `run \`npm run snapshots\` and commit tests/__snapshots__/ in the same PR. ` +
      `If it is NOT, you've hit a regression.`,
    );
  });
}

// A hard invariant that never needs acknowledging: identical input must yield
// identical output. If this ever fails, the snapshot gate itself is unsound
// (you'd get false regressions), so it's worth catching directly.
test('render is deterministic (same input → identical SVG)', async () => {
  const a = await buildSvg('large-numbered.cairn');
  const b = await buildSvg('large-numbered.cairn');
  assert.equal(a, b, 'non-deterministic render — output must be stable for snapshotting to work');
});
