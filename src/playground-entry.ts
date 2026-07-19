// Browser entry: the whole engine, client-side. Bundled by
// scripts/build-playground.sh into playground/cairn-engine.js (ESM).

import ELK from 'elkjs/lib/elk.bundled.js';
import { setElkFactory } from './elk.ts';
import { parse } from './parse.ts';
import { validate } from './validate.ts';
import { layout } from './layout.ts';
import { render } from './render.ts';
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
