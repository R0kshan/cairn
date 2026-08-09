/**
 * The engine's public surface — what `playground.ts` re-exports today, and the
 * shape a published entry point will point at when one exists. **Re-exports
 * only.** If a diff touches this file the surface changed; if it touches
 * anything else under `src/` it did not. That is the whole point: modules below
 * may be renamed, split, or moved freely.
 *
 * Published as the package's `.` export via `scripts/build-api.sh`, which
 * bundles `playground.ts` — the browser entry that injects ELK around these
 * re-exports. Generated `.d.ts` declarations are still missing, so TypeScript
 * consumers get the engine untyped; tracked in
 * https://github.com/R0kshan/cairn/issues/38.
 *
 * (Unrelated to `playground/api/` — that directory is the Vercel HTTP endpoint.)
 *
 * Deliberately **environment-neutral**: nothing here injects an ELK factory.
 * That is the job of the entry points — `playground.ts` (browser) and
 * `cli-npm.ts` (the bundled npm CLI). Under Node, `elk-engine.ts`'s lazy
 * fallback loads `elk-worker.ts`, which is the correct default; an injection
 * here would silently override it for every consumer.
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

/**
 * Same build-time injection `cli.ts` uses (see its `CAIRN_BUILD_VERSION` note):
 * every build script passes `--define`, and `typeof` — safe on an undeclared
 * identifier — falls through to package.json for unbundled dev runs.
 *
 * The define is not only about tag-accuracy here, it is what keeps the manifest
 * out of the bundles. esbuild does not tree-shake a JSON import down to the one
 * field used, so a bare `pkg.version` shipped `devDependencies`, `scripts` and
 * the rest into the browser bundle for the sake of one string. With the define
 * the ternary folds, `pkg` goes unreferenced, and the import is dropped.
 * Hardcoding the version instead would break the release: the publish job runs
 * `npm version "${GITHUB_REF_NAME#v}"` before packing, so package.json at build
 * time is the source of truth and `smoke-npm.sh` asserts the installed CLI
 * agrees with the tag.
 */
declare const CAIRN_BUILD_VERSION: string | undefined;

export const version: string =
  typeof CAIRN_BUILD_VERSION !== "undefined" ? CAIRN_BUILD_VERSION : pkg.version;
