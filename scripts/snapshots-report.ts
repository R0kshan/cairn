#!/usr/bin/env node
// Preview what a snapshot regeneration WOULD change, grouped by kind — without
// touching any file. Run this before `npm run snapshots` to answer the only
// question that matters: "is this my feature, or a regression?"
//
//   • GEOMETRY moved  → a layout shift. The risky kind — look at these.
//   • colour only     → almost always an intended theme/palette edit.
//   • text only       → a label / i18n change.
//
// Usage: npm run snapshots:report
import { readFileSync, existsSync } from 'node:fs';
import { computeCorpus, parseDigest, categorize, formatReport, DIGEST_PATH } from '../tests/corpus.ts';

const current = await computeCorpus();
if (!existsSync(DIGEST_PATH)) {
  console.log('no baseline digest yet — run `npm run snapshots` to create it.');
  process.exit(0);
}
const committed = parseDigest(readFileSync(DIGEST_PATH, 'utf8'));
console.log(formatReport(categorize(committed, current)));
