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
import {
  layout,
  attachSideDiagnostics,
  offsetDiagnostics,
  segmentSlideRange,
} from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views } from "./views.ts";
import { buildFlowMatrix } from "./flow-matrix.ts";
import type { FlowMatrix } from "./models/matrix.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import type { Model, Span } from "./models/ast.ts";
import type { Scene } from "./scene-layout.ts";
import { resolveThemeSpec } from "./theme-spec.ts";
import type { ThemeOverrides } from "./theme-spec.ts";

export interface CompileOptions {
  /**
   * A built-in theme name, or a palette of your own.
   *
   * An object is validated and merged over the built-in its `extends` names
   * (default `light`), so overriding one colour is a two-key object rather than
   * a full palette. It is used for this call only — nothing is registered, so
   * concurrent callers cannot see or clobber each other's colours.
   */
  theme?: string | ThemeOverrides;
  /** Build the flow matrix too. Off by default — it costs a pass over the flows. */
  matrix?: boolean;
  /**
   * Element id → inlined `data:` URI for its `logo: "<path>"`. Built-in logos
   * need nothing here; file-sourced ones do, because reading them is filesystem
   * work this entry point cannot do. Without it an embedder could never render
   * what `cairn build` renders from the same source, and the CLI and an
   * embedder must not disagree (INVARIANTS §15).
   */
  logos?: Map<string, string>;
}

/**
 * Where one element, flow label or run of a flow's route ended up on the canvas,
 * paired with the source position an editor needs to write a nudge back into
 * the DSL.
 *
 * This is what makes a drag in the playground possible without stamping ids
 * into the SVG: the drawing's bytes stay exactly what they were (INVARIANTS
 * §2, §14), and the one consumer that needs identity gets it out of band.
 */
export interface LayoutBox {
  /** Element id, or the flow id for a label or one run of a route. */
  id: string;
  what: "element" | "label" | "segment";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Containers hold other elements; a drag moves their whole subtree. */
  container: boolean;
  /** The container that holds this element — a child is never drawn outside it. */
  parent?: string;
  /** 1-based line the declaration sits on — an element's, or its flow's. */
  line: number;
  /** Span of the `dx, dy` an author already wrote, so an editor can replace it. */
  offsetSpan?: Span;
  /**
   * Which run of the route this is, counted from 1 — `"segment"` boxes only, and
   * what a `segment-offset:` names.
   */
  segment?: number;
  /**
   * The run's two endpoints. A run is a line, not a box: one side of
   * `x/y/width/height` is zero, so an editor hit-tests the distance to these
   * instead. `"segment"` boxes only.
   */
  points?: { x: number; y: number }[];
  /**
   * How far this run may slide along its normal — left/right for a vertical run,
   * up/down for a horizontal one. Wide open in the middle of a route; bounded at
   * either end by the element side the terminal sits on, so an editor can hold a
   * drag to what the drawing will actually show. `"segment"` boxes only.
   */
  slide?: { min: number; max: number };
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
  /** Element, label and route-run geometry, for editors that place things by hand. Null on error. */
  boxes: LayoutBox[] | null;
}

export async function compile(source: string, options?: CompileOptions): Promise<CompileResult> {
  const { model, diags } = parse(source);
  // A name goes onto the model, where the renderer resolves it as usual. A spec
  // bypasses that registry entirely and travels in the render options instead —
  // see RenderOptions.theme for why an embedder must not register anything.
  const theme = typeof options?.theme === "object" ? resolveThemeSpec(options.theme) : undefined;
  if (typeof options?.theme === "string") model.style.theme = options.theme;
  diags.push(...validate(model));
  const errors = diags.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length || !model.type || !views[model.type]) {
    return { svg: null, diagnostics: diags, metrics: null, matrix: null, boxes: null };
  }
  const view = views[model.type];
  // Before layout: the matrix reads the model only, so it survives an ELK failure
  // and costs nothing when it wasn't asked for.
  const matrix = options?.matrix ? buildFlowMatrix(model, view) : null;
  const scene = await layout(model, view);
  // Post-layout: whether a declared attachment side actually survived is only
  // knowable from the finished geometry (W0570).
  diags.push(...attachSideDiagnostics(scene, model));
  const { svg, overlapsAfter } = render(model, view, scene, { logos: options?.logos, theme });
  // After `render`, not before: it settles every label that is free to move, so
  // this is the first point where a label box is where the reader will see it —
  // which is what W0572 has to judge, and what `layoutBoxes` reports. `cli.ts`
  // has always ordered it this way; a diagnostic the CLI and an embedder
  // disagree about is worse than either answer.
  diags.push(...offsetDiagnostics(scene, model));
  return {
    svg,
    boxes: layoutBoxes(model, scene),
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

/** Pairs the finished geometry with the source spans an editor writes back to. */
function layoutBoxes(model: Model, scene: Scene): LayoutBox[] {
  const declarations = new Map<string, { line: number; offsetSpan?: Span; parent?: string }>();
  const walk = (elements: Model["elements"], parent?: string): void => {
    for (const element of elements) {
      declarations.set(element.id, {
        line: element.kindSpan.line,
        offsetSpan: element.offset?.span,
        parent,
      });
      walk(element.children, element.id);
    }
  };
  walk(model.elements);
  const flowById = new Map(model.flows.map((flow) => [flow.id, flow]));

  const boxes: LayoutBox[] = [];
  // A terminal is seated on a leaf, never on the box drawn around it — the same
  // rule the slide bounds are measured by.
  const leaves = scene.nodes.filter((node) => !node.container);
  for (const node of scene.nodes) {
    const declaration = declarations.get(node.id);
    if (!declaration) continue;
    boxes.push({
      id: node.id,
      what: "element",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      container: node.container,
      ...declaration,
    });
  }
  for (const edge of scene.edges) {
    const flow = flowById.get(edge.id);
    if (!flow) continue;
    for (const label of edge.labels)
      boxes.push({
        id: label.flowId,
        what: "label",
        x: label.x,
        y: label.y,
        width: label.width,
        height: label.height,
        container: false,
        line: flow.span.line,
        offsetSpan: flow.labelOffset?.span,
      });
    // One box per run, not one per flow: a run is what a `segment-offset:` names
    // and what an editor lets the reader take hold of, and the rectangle around
    // a whole route covers half the canvas once it turns a corner.
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const [a, b] = [edge.pts[index], edge.pts[index + 1]];
      const declared = flow.segmentOffsets?.find((entry) => entry.segment === index + 1);
      boxes.push({
        id: edge.id,
        what: "segment",
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
        container: false,
        line: flow.span.line,
        offsetSpan: declared?.span,
        segment: index + 1,
        points: [
          { x: a.x, y: a.y },
          { x: b.x, y: b.y },
        ],
        slide: segmentSlideRange(edge.pts, index, leaves),
      });
    }
  }
  return boxes;
}
