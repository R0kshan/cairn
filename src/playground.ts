import ELK from "elkjs/lib/elk.bundled.js";
import { setElkFactory } from "./elk-engine.ts";
import { parse } from "./parser.ts";
import { validate } from "./validator.ts";
import { layout } from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views, themeNames, type Diagnostic } from "./model.ts";

setElkFactory(() => new (ELK as any)());

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
  const errors = diags.filter((d) => d.severity === "error");
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

export const version = "0.1.0";
