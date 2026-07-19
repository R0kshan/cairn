// Full-corpus non-regression gate. One build pass over every buildable example
// enforces TWO things:
//
//   1. Structural digest — geometry / colour / text fingerprints for the whole
//      corpus in one committed file (tests/__snapshots__/corpus.digest). Cheap,
//      full coverage, and a small readable diff. `snapshots:report` says which
//      fingerprint moved (geometry = risky, colour = usually intended).
//
//   2. Example-SVG fidelity — the SVGs committed under examples/ (the images the
//      README shows) must still match what the code renders now, so a published
//      diagram can't silently rot. Compared normalized (1dp) for cross-platform
//      stability.
//
// Both are acknowledged the same way: `npm run snapshots` regenerates the digest
// AND refreshes the committed example SVGs; commit them in the same change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeCorpus, serialize, parseDigest, categorize, formatReport,
  normalize, DIGEST_PATH, EXAMPLES_DIR,
} from './corpus.ts';

const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

test('corpus: structural digest + example-SVG fidelity', async () => {
  const current = await computeCorpus();

  if (UPDATE) {
    // Refresh every committed README image that exists, then the digest.
    for (const d of current) {
      const svgPath = join(EXAMPLES_DIR, d.name.replace(/\.cairn$/, '.svg'));
      if (existsSync(svgPath)) writeFileSync(svgPath, d.svg);
    }
    writeFileSync(DIGEST_PATH, serialize(current));
    return;
  }

  // First run with no baseline yet: record it, don't assert.
  if (!existsSync(DIGEST_PATH)) {
    writeFileSync(DIGEST_PATH, serialize(current));
    return;
  }

  // (1) example-SVG fidelity
  const svgDrift: string[] = [];
  for (const d of current) {
    const svgPath = join(EXAMPLES_DIR, d.name.replace(/\.cairn$/, '.svg'));
    if (!existsSync(svgPath)) continue; // no committed image for this example
    const committed = readFileSync(svgPath, 'utf8').replace(/\r\n/g, '\n');
    if (normalize(committed) !== normalize(d.svg)) svgDrift.push(d.name);
  }
  assert.equal(
    svgDrift.length, 0,
    `committed example SVG(s) no longer match current render: ${svgDrift.join(', ')}\n` +
    'If this is an intended render change, run `npm run snapshots` to refresh them.',
  );

  // (2) structural digest
  const committed = parseDigest(readFileSync(DIGEST_PATH, 'utf8'));
  const cat = categorize(committed, current);
  assert.equal(
    cat.changed, 0,
    `corpus changed vs tests/__snapshots__/corpus.digest:\n${formatReport(cat)}\n` +
    'If intended, run `npm run snapshots` and commit the digest ' +
    '(preview with `npm run snapshots:report`).',
  );
});
