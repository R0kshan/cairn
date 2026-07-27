/**
 * Browser bundle entry for the web playground. Injects a browser ELK factory,
 * then exposes `compile(source, { theme })` — the full parse → validate → layout
 * → render pipeline returning `{ svg, diagnostics, metrics }` — plus `themeNames`
 * for the UI. This module is what the esbuild playground bundle is built from.
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
import type { Diagnostic } from "./models/diagnostic.ts";

// elkjs' CommonJS default export needs a construct-signature cast (see elk-worker).
const ElkClass = ELKConstructor as unknown as new () => ELK;
setElkFactory(() => new ElkClass());

export { themeNames };

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

export const version = pkg.version;
