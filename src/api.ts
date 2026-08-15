/**
 * The engine's public surface. **Re-exports only, except `version`** — the
 * modules below may be renamed, split or moved freely; nothing here changes
 * unless the contract does. `version` is local because the build scripts
 * replace `CAIRN_BUILD_VERSION` at bundle time (see the note on it below).
 *
 * Published chain: `api.ts` → `playground.ts` → `dist/cairn.mjs`. An export
 * added to `playground.ts` widens the contract too, and a published export
 * cannot be withdrawn — `scripts/smoke-npm.sh` asserts the installed export set
 * matches exactly.
 *
 * No `.d.ts` yet, so TypeScript consumers get the engine untyped
 * (https://github.com/R0kshan/cairn/issues/38).
 *
 * Deliberately **environment-neutral**: nothing here injects an ELK factory —
 * that is the entry points' job, `playground.ts` (browser) and `cli-npm.ts`
 * (npm CLI). Injecting one here would override `elk-engine.ts`'s lazy fallback
 * for every consumer.
 */

import pkg from "../package.json" with { type: "json" };

export { compile } from "./compile.ts";
export { themeNames } from "./themes.ts";

// The flow matrix `compile(source, { matrix: true })` returns is data, not text.
// These turn it into the same CSV / Markdown / SVG `cairn matrix` writes — a
// consumer rendering its own table can ignore them and read `matrix.rows`.
export { matrixCsv, matrixMd, matrixSvg } from "./flow-matrix.ts";

// Named explicitly rather than `export *`, so the surface can't widen by
// accident when an internal module gains an export. Every type reachable from
// `CompileResult` is listed, so a consumer never has to import an internal path.
export type { CompileOptions, CompileResult } from "./compile.ts";
export type { FlowMatrix, FlowMatrixRow, MatrixColumn, MatrixColumnId } from "./models/matrix.ts";
export type { Diagnostic, Severity } from "./models/diagnostic.ts";
export type { Span } from "./models/ast.ts";

/**
 * Same build-time injection `cli.ts` uses (`CAIRN_BUILD_VERSION` note there):
 * every build script passes `--define`, and `typeof` — safe on an undeclared
 * identifier — falls through to package.json for unbundled dev runs.
 *
 * Not just tag-accuracy: it keeps the manifest out of the bundles. esbuild
 * doesn't tree-shake a JSON import to one field, so a bare `pkg.version`
 * shipped `devDependencies` and `scripts` into the browser bundle for one
 * string — with the define the ternary folds, `pkg` goes unreferenced, and
 * the import drops. Hardcoding the version instead would break the release:
 * the publish job runs `npm version "${GITHUB_REF_NAME#v}"` before packing,
 * so package.json at build time is the source of truth, and `smoke-npm.sh`
 * asserts the installed CLI agrees with the tag.
 */
declare const CAIRN_BUILD_VERSION: string | undefined;

export const version: string =
  typeof CAIRN_BUILD_VERSION !== "undefined" ? CAIRN_BUILD_VERSION : pkg.version;
