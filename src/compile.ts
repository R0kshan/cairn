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
  containerSizeBounds,
  offsetDiagnostics,
  segmentSlideRange,
  straightRuns,
} from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views } from "./views.ts";
import { buildFlowMatrix } from "./flow-matrix.ts";
import type { FlowMatrix } from "./models/matrix.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import type { AttachSide, Model, Span } from "./models/ast.ts";
import type { Scene, SizeBounds } from "./scene-layout.ts";
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
 * Where one element, flow label, run of a flow's route or flow terminal ended up
 * on the canvas, paired with the source position an editor needs to write the
 * move back into the DSL.
 *
 * This is what makes a drag in the playground possible without stamping ids
 * into the SVG: the drawing's bytes stay exactly what they were (INVARIANTS
 * §2, §14), and the one consumer that needs identity gets it out of band.
 */
export interface LayoutBox {
  /** Element id, or the flow id for a label, a run of a route, or a terminal. */
  id: string;
  what: "element" | "label" | "segment" | "terminal";
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
   * Span of the `dw, dh` of a `size:`, the same way — `"element"` boxes on a
   * container only, since that is the only thing a `size:` may name.
   */
  sizeSpan?: Span;
  /**
   * What that `size:` came to, as drawn — which is not what it says wherever the
   * floor cut it short. An editor adds its drag to *this* and writes the sum, so
   * a second drag continues from the box on screen rather than from a number the
   * floor will swallow again. Absent when the element declares no `size:`.
   */
  sizeApplied?: { dw: number; dh: number };
  /**
   * How far a `size:` may take this container: never inside its own children,
   * never outside its parent. Container `"element"` boxes only.
   *
   * The engine's own numbers, not a rule an editor re-derives — the pass that
   * applies the hint clamps by exactly this, so a resize handle stopped here
   * promises the box that will actually be drawn.
   */
  resize?: SizeBounds;
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
  /**
   * Where a flow meets an element — `"terminal"` boxes only, one per end, with
   * `x/y` on the point itself and no extent.
   *
   * `span` is what an editor replaces to move the attachment: the side the
   * author declared when there is one, and otherwise the endpoint's id, which
   * takes an `ID.side` suffix in its place. An endpoint that names a *role*
   * (`CAPTURE.producer`) gets no terminal box at all: a side accumulates onto a
   * role in the DSL (`CAPTURE.producer.top`), but neither span an editor
   * replaces is the place to write it, so that one stays a hand edit.
   */
  endpoint?: { end: "from" | "to"; element: string; side?: AttachSide; span: Span };
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
  const declarations = new Map<
    string,
    { line: number; offsetSpan?: Span; sizeSpan?: Span; parent?: string }
  >();
  const walk = (elements: Model["elements"], parent?: string): void => {
    for (const element of elements) {
      declarations.set(element.id, {
        line: element.kindSpan.line,
        offsetSpan: element.offset?.span,
        sizeSpan: element.size?.span,
        parent,
      });
      walk(element.children, element.id);
    }
  };
  walk(model.elements);
  const flowById = new Map(model.flows.map((flow) => [flow.id, flow]));

  const sizeBounds = containerSizeBounds(scene, model);
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
      resize: sizeBounds.get(node.id),
      sizeApplied: scene.appliedSizes?.get(node.id),
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
    // One box per straight run, not one per flow and not one per pair of points:
    // a run is the line the reader sees and the thing a `segment-offset:` names,
    // and the rectangle around a whole route covers half the canvas once it
    // turns a corner. `straightRuns` is what numbers them, here and in the pass
    // that applies the hint — one reading, so a drag and the engine cannot
    // disagree about which run is which.
    straightRuns(edge.pts).forEach((run, index) => {
      const [a, b] = [edge.pts[run.from], edge.pts[run.to]];
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
        slide: segmentSlideRange(edge.pts, run, leaves),
      });
    });
    // The two ends, which move between the *sides* of their element rather than
    // by a delta — `ID.side` is the lever, so the box carries the span that
    // writes one and the editor never has to know the grammar.
    for (const end of ["from", "to"] as const) {
      if (end === "from" ? flow.fromRole : flow.toRole) continue;
      const declared = end === "from" ? flow.fromSide : flow.toSide;
      const point = end === "from" ? edge.pts[0] : edge.pts[edge.pts.length - 1];
      boxes.push({
        id: edge.id,
        what: "terminal",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        container: false,
        line: flow.span.line,
        endpoint: {
          end,
          element: end === "from" ? flow.from : flow.to,
          side: declared?.value,
          span: declared?.span ?? (end === "from" ? flow.fromSpan : flow.toSpan),
        },
      });
    }
  }
  return boxes;
}
