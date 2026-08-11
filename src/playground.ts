/**
 * Browser entry for the web playground. Injects a browser-side ELK factory, then
 * re-exports the public surface from `./api.ts` — which is deliberately
 * environment-neutral, so without this injection `elk-engine.ts` would fall back
 * to `elk-worker.ts`, Node-shaped code with no business in a browser bundle.
 *
 * This module is what `scripts/build-playground.sh` builds both playground
 * bundles from (browser + the Vercel `/api/svg` function). The readable source
 * of `compile` itself is `src/compile.ts`.
 */

import ELKConstructor, { type ELK } from "elkjs/lib/elk.bundled.js";
import { setElkFactory } from "./elk-engine.ts";

// elkjs' CommonJS default export needs a construct-signature cast (see elk-worker).
const ElkClass = ELKConstructor as unknown as new () => ELK;
setElkFactory(() => new ElkClass());

export { compile, themeNames, version } from "./api.ts";
export type { CompileResult, Diagnostic, Severity, Span } from "./api.ts";
