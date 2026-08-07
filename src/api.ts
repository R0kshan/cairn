/**
 * The public surface of the package — the single module a published entry point
 * should point at. **Re-exports only** (plus the one-line `version` constant,
 * which has nowhere else to live). If a diff touches this file, the public
 * contract changed; if it touches anything else under `src/`, it did not. That
 * is the whole point: modules below may be renamed, split, or moved freely.
 *
 * (Unrelated to `playground/api/` — that directory is the Vercel HTTP endpoint.)
 *
 * Deliberately **environment-neutral**: nothing here injects an ELK factory.
 * That is the job of the entry points — `playground.ts` (browser) and
 * `cli-npm.ts` (the bundled npm CLI). Under Node, `elk-engine.ts`'s lazy
 * fallback loads `elk-worker.ts`, which is the correct default; an injection
 * here would silently override it for every consumer.
 *
 * The `exports` map and generated `.d.ts` declarations that would make these
 * names importable as `@r0kshan/cairn` are tracked in
 * https://github.com/R0kshan/cairn/issues/38 and are not in this repo yet.
 */

import pkg from "../package.json" with { type: "json" };

export { compile } from "./compile.ts";
export { themeNames } from "./themes.ts";

// Named explicitly rather than `export *`, so the surface can't widen by
// accident when an internal module gains an export. Every type reachable from
// `CompileResult` is listed, so a consumer never has to import an internal path.
export type { CompileResult } from "./compile.ts";
export type { Diagnostic, Severity } from "./models/diagnostic.ts";
export type { Span } from "./models/ast.ts";

export const version: string = pkg.version;
