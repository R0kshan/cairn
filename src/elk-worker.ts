/**
 * Node-side elkjs factory. elkjs expects a Web Worker `self`; this constructs
 * the bundled ELK with `self` temporarily removed so it runs synchronously
 * in-process (no worker), then restores the global. The compiled release binary
 * bundles this module's graph, so keep it free of Bun/Deno APIs.
 *
 * ---
 * CodeQL: "Missing origin verification in `postMessage` handler"
 * (js/missing-origin-verification), reported against the generated playground
 * bundles. Recorded here because the finding is NOT fixable in `src/`:
 *
 *  - It is not our code. The handler is elkjs's GWT-compiled worker dispatch
 *    (`saveDispatch`), inlined by the bundler. `src/` contains no `postMessage`,
 *    `addEventListener`, or message handler of any kind.
 *  - Editing the bundle is pointless: `playground/*.js` and `playground/lib/*.mjs`
 *    are build artifacts of `npm run build:playground` and are overwritten on the
 *    next build. Patching `node_modules/elkjs` is likewise lost on `npm install`.
 *  - The sink is unreachable in both of our builds. elkjs only wires
 *    `self.onmessage = saveDispatch` behind `typeof document === "undefined" &&
 *    typeof self !== "undefined"` — the dedicated-Web-Worker signature. The
 *    playground runs ELK on the main thread (where `document` exists), and we
 *    never pass `workerUrl`/`workerFactory`, so no real Worker is ever created.
 *    In Node the `delete globalThis.self` below independently forces that same
 *    branch to be skipped.
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
