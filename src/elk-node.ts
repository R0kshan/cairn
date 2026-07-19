// Node/Bun ELK loader — sync fake-worker mode, using the self-contained bundled
// ELK (elk.bundled.js) that has the worker embedded inline.
// bun build --compile cannot follow createRequire/require('elkjs/lib/elk-worker*'),
// so we must use the pre-bundled file where all internal require() calls resolve
// within the bundle, not against the filesystem / the compiled binary's virtual fs.

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
