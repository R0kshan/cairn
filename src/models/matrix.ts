/**
 * The flow-matrix value: what `buildFlowMatrix` produces and what the CSV /
 * Markdown / SVG formatters consume. Pure types, no logic — `views.ts` declares
 * which columns a view emits and `flow-matrix.ts` fills them in, so both depend
 * on this module rather than on each other.
 */

export type MatrixColumnId = "num" | "source" | "dest" | "proto" | "port" | "nature";

/** Presentation of one column: the SVG table centres short columns and caps wide ones. */
export interface MatrixColumn {
  id: MatrixColumnId;
  label: string;
  align: "start" | "middle";
  maxWidth: number;
}

/** One flow, cells aligned to `FlowMatrix.columns`. `id` is the flow id (`F01`). */
export interface FlowMatrixRow {
  id: string;
  cells: string[];
}

export interface FlowMatrix {
  /** Diagram type the matrix was built from (`infrastructure`, `security`, …). */
  view: string;
  /** Localized matrix title, with the diagram title appended when there is one. */
  heading: string;
  lang: "en" | "fr";
  columns: MatrixColumn[];
  rows: FlowMatrixRow[];
  /** What the SVG formatter needs; CSV and Markdown ignore it. */
  style: { theme: string; background?: string; fontFamily: string };
}

/** Per-view matrix shape, declared in the `views` registry. */
export interface MatrixSpec {
  /** Ancestor element kinds that annotate an endpoint — `Name (Zone)`. */
  zoneKinds: string[];
  /** Columns this view emits, in order. */
  columns: MatrixColumnId[];
}
