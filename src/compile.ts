/**
 * One-call orchestration of the whole pipeline: `parse` → `validate` → `layout`
 * → `render`, returning `{ svg, diagnostics, metrics }` instead of writing a
 * file or exiting a process. This is what embedders use; `cli.ts` drives the
 * same stages itself because it needs the intermediate results (diagnostics
 * formatting, the matrix export, watch mode).
 *
 * Errors are data, not exceptions — a source with error diagnostics comes back
 * as `svg: null` with the diagnostics attached, never a throw.
 *
 * Environment-neutral: it never injects an ELK factory. `layout()` resolves one
 * lazily via `elk-engine.ts`, and the entry points (`playground.ts` for the
 * browser, `cli-npm.ts` for the bundled npm CLI) inject the right one first.
 */

import { parse } from "./parser.ts";
import { validate } from "./validator.ts";
import { layout } from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views } from "./views.ts";
import type { Diagnostic } from "./models/diagnostic.ts";

export interface CompileResult {
  svg: string | null;
  diagnostics: (Diagnostic & { severity: "error" | "warning" })[];
  metrics: {
    width: number;
    height: number;
    layoutMs: number;
    overlaps: number;
  } | null;
}

export async function compile(
  source: string,
  options?: { theme?: string },
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
