/**
 * Browser bundle entry for the web playground. The engine surface it exposes —
 * `compile`, `themeNames`, `version` — lives in `./api.ts`, which is also what
 * the npm package publishes; this module exists so the playground bundles keep
 * a stable entry name of their own (`scripts/build-playground.sh`,
 * `playground/api/svg.mjs`).
 *
 * Importing it also runs `api.ts`'s side effect of installing the browser ELK
 * factory.
 */

export * from "./api.ts";
