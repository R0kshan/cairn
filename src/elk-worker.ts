/**
 * Load ELK for Node/Bun using the self-contained bundled build.
 *
 * Uses elkjs's pre-bundled `elk.bundled.js` (worker embedded inline) in sync
 * fake-worker mode. `bun build --compile` cannot follow the dynamic
 * require('elkjs/lib/elk-worker*'), so the pre-bundled file — where every
 * internal require() resolves inside the bundle rather than against the
 * filesystem / the compiled binary's virtual fs — is the only variant that
 * works in the compiled binary.
 */

import ELKConstructor from 'elkjs/lib/elk.bundled.js';

export function nodeElkFactory(): any {
  const g = globalThis as any;
  const savedSelf = g.self;
  const hadSelf = 'self' in g;
  try { delete g.self; } catch { /* ignore */ }
  // ELKNode (the default export of elk.bundled.js) auto-provides a FakeWorker
  // factory when none is given — no separate elk-worker.min.js require needed.
  const elk = new (ELKConstructor as any)();
  if (hadSelf) g.self = savedSelf;
  return elk;
}
