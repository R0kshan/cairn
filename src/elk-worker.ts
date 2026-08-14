/**
 * Node-side elkjs factory. elkjs expects a Web Worker `self`; this constructs
 * the bundled ELK with `self` temporarily removed so it runs synchronously
 * in-process (no worker), then restores the global. The compiled release binary
 * bundles this module's graph, so keep it free of Bun/Deno APIs.
 *
 * CodeQL flags js/missing-origin-verification against the generated playground
 * bundles. Not fixable in `src/`: the handler is elkjs's own GWT-compiled worker
 * dispatch (`saveDispatch`), inlined by the bundler, and edits to the bundle or
 * `node_modules/elkjs` are lost on the next install. The sink is unreachable in
 * both builds anyway — elkjs wires `self.onmessage` only behind the
 * dedicated-Web-Worker signature, which neither the main-thread playground nor
 * Node (where `delete globalThis.self` below skips the branch) satisfies.
 */

import ELKConstructor, { type ELK } from "elkjs/lib/elk.bundled.js";

// elkjs ships CommonJS: its default export types as a namespace, not a
// constructor, so we cast to the construct signature at this single boundary.
const ElkClass = ELKConstructor as unknown as new () => ELK;

export function nodeElkFactory(): ELK {
  const globalObject = globalThis as unknown as { self?: unknown };
  const savedSelf = globalObject.self;
  const hadSelf = "self" in globalObject;
  try {
    delete globalObject.self;
  } catch {
    /* ignore */
  }
  const elk = new ElkClass();
  if (hadSelf) globalObject.self = savedSelf;
  return elk;
}
