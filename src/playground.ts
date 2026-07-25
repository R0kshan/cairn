/**
 * One entry point bundled for the browser playground and the Vercel /api/svg
 * function (see documentation/PLAYGROUND_BUILD.md).
 *
 * Wires the whole engine behind a single `compile(source)` call: parse →
 * validate → layout → render, returning the SVG plus diagnostics and metrics.
 * It also registers the browser ELK factory. esbuild inlines elkjs into the
 * bundles, so they ship with no runtime dependencies.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import { setElkFactory } from './elk-engine.ts';
import { parse } from './parser.ts';
import { validate } from './validator.ts';
import { layout } from './scene-layout.ts';
import { render } from './svg-render.ts';
import { views, themeNames, type Diagnostic } from './model.ts';

setElkFactory(() => new (ELK as any)());

export { themeNames };

export interface CompileResult {
  svg: string | null;
  diagnostics: (Diagnostic & { severity: 'error' | 'warning' })[];
  metrics: { width: number; height: number; layoutMs: number; overlaps: number } | null;
}

export async function compile(source: string, opts?: { theme?: string }): Promise<CompileResult> {
  const { model, diags } = parse(source);
  if (opts?.theme) model.style.theme = opts.theme;   // playground theme override (doesn't edit source)
  diags.push(...validate(model));
  const errors = diags.filter(d => d.severity === 'error');
  if (errors.length || !model.type || !views[model.type]) {
    return { svg: null, diagnostics: diags, metrics: null };
  }
  const view = views[model.type];
  const scene = await layout(model, view);
  const { svg, overlapsAfter } = render(model, view, scene);
  return {
    svg,
    diagnostics: diags,
    metrics: { width: scene.width, height: scene.height, layoutMs: scene.layoutMs, overlaps: overlapsAfter },
  };
}

export const version = '0.1.0';
