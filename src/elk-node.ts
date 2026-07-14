// Node/Bun ELK loader — the sync fake-worker mode validated in the brief §2.3.
// elkjs's UMD picks its browser branch when `self` exists (Bun defines it):
// hide `self` during require, use the synchronous fake worker (right for a CLI).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function nodeElkFactory(): any {
  const g = globalThis as any;
  const savedSelf = g.self;
  const hadSelf = 'self' in g;
  try { delete g.self; } catch { /* ignore */ }
  const { Worker: FakeWorker } = require('elkjs/lib/elk-worker.min.js');
  if (hadSelf) g.self = savedSelf;
  const ELKApi = require('elkjs/lib/elk-api.js');
  return new ELKApi({ workerFactory: () => new FakeWorker() });
}
