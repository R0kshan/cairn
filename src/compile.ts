/**
 * One-call orchestration of the whole pipeline: `parse` → `validate` →
 * `layout` → `render`, returning `{ svg, diagnostics, metrics, matrix }`
 * instead of writing a file or exiting a process. What embedders use; `cli.ts`
 * drives the same stages itself since it needs the intermediate results
 * (diagnostics formatting, output paths, watch mode).
 *
 * Errors are data, not exceptions: a source with error diagnostics comes back
 * as `svg: null` with the diagnostics attached, never a throw.
 *
 * Environment-neutral: never injects an ELK factory. `layout()` resolves one
 * lazily via `elk-engine.ts`; the entry points (`playground.ts` for the
 * browser, `cli-npm.ts` for the npm CLI) inject the right one first.
 */

import { parse } from "./parser.ts";
import { validate } from "./validator.ts";
import { layout } from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views } from "./views.ts";
import { buildFlowMatrix } from "./flow-matrix.ts";
import type { FlowMatrix } from "./models/matrix.ts";
import type { Diagnostic } from "./models/diagnostic.ts";

export interface CompileOptions {
  theme?: string;
  /** Build the flow matrix too. Off by default — it costs a pass over the flows. */
  matrix?: boolean;
}

export interface CompileResult {
  svg: string | null;
  diagnostics: (Diagnostic & { severity: "error" | "warning" })[];
  metrics: {
    width: number;
    height: number;
    layoutMs: number;
    overlaps: number;
  } | null;
  /** Present only when `options.matrix` asked for it and the source has no errors. */
  matrix: FlowMatrix | null;
}

export async function compile(source: string, options?: CompileOptions): Promise<CompileResult> {
  const { model, diags } = parse(source);
  if (options?.theme) model.style.theme = options.theme;
  diags.push(...validate(model));
  const errors = diags.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length || !model.type || !views[model.type]) {
    return { svg: null, diagnostics: diags, metrics: null, matrix: null };
  }
  const view = views[model.type];
  // Before layout: the matrix reads the model only, so it survives an ELK failure
  // and costs nothing when it wasn't asked for.
  const matrix = options?.matrix ? buildFlowMatrix(model, view) : null;
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
    matrix,
  };
}
