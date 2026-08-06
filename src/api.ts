/**
 * The package's public entry point — the one module `package.json`'s `exports`
 * map names, and the entry both the npm bundles and the playground bundles are
 * built from. Exposes `compile(source, options)` — the full parse → validate →
 * layout → render pipeline returning `{ svg, diagnostics, metrics }` — plus
 * `themeNames` and `version`.
 *
 * It is deliberately a thin façade over `src/`: everything behind it may be
 * renamed, split, or moved without changing the published surface. Anything
 * added here becomes API, so `tests/api-surface.test.ts` snapshots the resolved
 * shape of this module and fails on an unacknowledged change.
 *
 * Nothing reachable from here may touch a Node global — the browser bundle has
 * no shims. See `documentation/PLAYGROUND_BUILD.md`.
 */

import ELKConstructor, { type ELK } from "elkjs/lib/elk.bundled.js";
import pkg from "../package.json" with { type: "json" };
import { setElkFactory } from "./elk-engine.ts";
import { parse } from "./parser.ts";
import { validate } from "./validator.ts";
import { layout } from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views } from "./views.ts";
import { themeNames } from "./themes.ts";
import type { Diagnostic, Severity } from "./models/diagnostic.ts";
import type { Span } from "./models/ast.ts";

// elkjs' CommonJS default export needs a construct-signature cast (see elk-worker).
const ElkClass = ELKConstructor as unknown as new () => ELK;
setElkFactory(() => new ElkClass());

export { themeNames };
// `Span` and `Severity` are re-exported because `Diagnostic` references them:
// without these a consumer can hold a `Diagnostic` but cannot name the type of
// its `span` or `severity`.
export type { Diagnostic, Severity, Span };

/** A diagnostic as reported to API consumers — always classified. */
export type CompileDiagnostic = Diagnostic & { severity: "error" | "warning" };

/** Size and cost of a rendered diagram. `null` when nothing was rendered. */
export interface CompileMetrics {
  width: number;
  height: number;
  layoutMs: number;
  overlaps: number;
}

export interface CompileResult {
  svg: string | null;
  diagnostics: CompileDiagnostic[];
  metrics: CompileMetrics | null;
}

export interface CompileOptions {
  /** Overrides the diagram's own `style { theme: … }`. See `themeNames`. */
  theme?: string;
}

/**
 * Renders `.cairn` source to SVG.
 *
 * Never throws on invalid input: a malformed or incomplete diagram comes back
 * as `{ svg: null, metrics: null }` with the reasons in `diagnostics`. Warnings
 * are returned alongside a successful render.
 */
export async function compile(
  source: string,
  options?: CompileOptions,
): Promise<CompileResult> {
  const { model, diags } = parse(source);
  if (options?.theme) model.style.theme = options.theme;
  diags.push(...validate(model));
  const errors = diags.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length || !model.type || !views[model.type]) {
    return { svg: null, diagnostics: diags, metrics: null };
  }
  const view = views[model.type];
  const scene = await layout(model, view);
  const { svg, overlapsAfter } = render(model, view, scene);
  return {
    svg,
    diagnostics: diags,
    metrics: {
      width: scene.width,
      height: scene.height,
      layoutMs: scene.layoutMs,
      overlaps: overlapsAfter,
    },
  };
}

export const version = pkg.version;
