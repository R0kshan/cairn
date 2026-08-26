/**
 * The *matrice des flux techniques* exporter — the primary deliverable of the
 * infrastructure view, available from every view. Split in two halves:
 * `buildFlowMatrix` turns a `Model` into a `FlowMatrix` (localized column
 * headers + one row per flow, endpoints annotated with their zone,
 * protocol/port split), and the three formatters turn that value into CSV, a
 * GFM table, or a standalone themed SVG.
 *
 * Which columns a view emits, and which containers count as its "zone", are
 * declared by the view itself (`views.ts` → `View.matrix`) — nothing here
 * branches on a diagram type.
 *
 * The split is what lets the CLI, `compile()` and an embedder share one table:
 * the formatters are pure functions of `FlowMatrix` and read no `Model`, so a
 * consumer that wants its own rendering can stop after the build step.
 */

import type { Model } from "./models/ast.ts";
import type { FlowMatrix, MatrixColumn, MatrixColumnId } from "./models/matrix.ts";
import type { View } from "./views.ts";
import { UI } from "./localization.ts";
import { palettes, lightPalette } from "./themes.ts";
import { esc, escAttr } from "./xml-escape.ts";
import { measure, CHAR_WIDTH } from "./text-metrics.ts";

const COLUMN_PRESENTATION: Record<MatrixColumnId, { align: "start" | "middle"; maxWidth: number }> =
  {
    num: { align: "middle", maxWidth: 220 },
    source: { align: "start", maxWidth: 420 },
    dest: { align: "start", maxWidth: 420 },
    proto: { align: "start", maxWidth: 220 },
    port: { align: "middle", maxWidth: 220 },
    nature: { align: "start", maxWidth: 360 },
  };

const columnLabel = (id: MatrixColumnId, lang: "en" | "fr"): string => {
  const labels = UI[lang].matrix;
  const byId: Record<MatrixColumnId, string> = {
    num: labels.n,
    source: labels.source,
    dest: labels.dest,
    proto: labels.proto,
    port: labels.port,
    nature: labels.nature,
  };
  return byId[id];
};

function zoneOf(model: Model, id: string, zoneKinds: string[]): string | undefined {
  const element = model.index.get(id);
  for (let ancestor = element?.parent; ancestor; ancestor = ancestor.parent) {
    if (zoneKinds.includes(ancestor.kind)) return ancestor.label ?? ancestor.id;
  }
  return undefined;
}

const endpoint = (model: Model, id: string, zoneKinds: string[]): string => {
  const element = model.index.get(id);
  const name = element?.label?.replace(/\n/g, " ") ?? id;
  const zone = zoneOf(model, id, zoneKinds);
  return zone ? `${name} (${zone})` : name;
};

function splitProto(protocol?: string): { proto: string; port: string } {
  if (!protocol) return { proto: "", port: "" };
  const slashIndex = protocol.lastIndexOf("/");
  const tail = slashIndex >= 0 ? protocol.slice(slashIndex + 1) : "";
  const hasNumericPort = slashIndex >= 0 && /^\d+$/.test(tail);
  if (hasNumericPort) return { proto: protocol.slice(0, slashIndex), port: tail };
  return { proto: protocol, port: "" };
}

/** Builds a flow matrix from the model, with localized headers and annotated endpoints. */
export function buildFlowMatrix(model: Model, view: View): FlowMatrix {
  const lang = model.style.lang;
  const matrixLabels = UI[lang].matrix;
  const { zoneKinds, columns: columnIds } = view.matrix;
  const columns: MatrixColumn[] = columnIds.map((id) => ({
    id,
    label: columnLabel(id, lang),
    ...COLUMN_PRESENTATION[id],
  }));
  const rows = model.flows.map((flow) => {
    const { proto, port } = splitProto(flow.tech?.protocol);
    const byId: Record<MatrixColumnId, string> = {
      num: String(parseInt(flow.id.slice(1), 10)),
      source: endpoint(model, flow.from, zoneKinds),
      dest: endpoint(model, flow.to, zoneKinds),
      proto,
      port,
      nature: (flow.label ?? "").replace(/\n/g, " "),
    };
    return { id: flow.id, cells: columns.map((column) => byId[column.id]) };
  });
  return {
    view: model.type ?? "",
    heading: model.title ? `${matrixLabels.title} — ${model.title}` : matrixLabels.title,
    lang,
    columns,
    rows,
    style: {
      theme: model.style.theme,
      background: model.style.background,
      fontFamily: model.style.font.family,
    },
  };
}

const csvCell = (text: string): string => {
  // A cell opening with `= + - @` (or a tab/CR before them) is executable formula
  // text in Excel and Sheets, and element names come from the .cairn source. The
  // leading apostrophe forces the spreadsheet to read the cell as literal text —
  // the CSV counterpart of escaping user text before SVG emission.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Exports a flow matrix as CSV (comma-separated values). */
export function matrixCsv(matrix: FlowMatrix): string {
  const lines = [matrix.columns.map((column) => csvCell(column.label)).join(",")];
  for (const row of matrix.rows) lines.push(row.cells.map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

const mdCell = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Exports a flow matrix as GitHub-Flavored Markdown. */
export function matrixMd(matrix: FlowMatrix): string {
  const cols = matrix.columns.map((column) => column.label);
  const outLines: string[] = [`# ${matrix.heading}`, ""];
  outLines.push("| " + cols.join(" | ") + " |");
  outLines.push("|" + cols.map(() => "---").join("|") + "|");
  for (const row of matrix.rows) outLines.push("| " + row.cells.map(mdCell).join(" | ") + " |");
  return outLines.join("\n") + "\n";
}

/** Exports a flow matrix as a standalone themed SVG table. */
export function matrixSvg(matrix: FlowMatrix): string {
  const pal = palettes[matrix.style.theme] ?? lightPalette;
  const title = matrix.heading;
  const headers = matrix.columns.map((column) => column.label);
  const cells = matrix.rows.map((row) => row.cells);
  const FONT_SIZE = 11,
    PADDING_X = 10,
    ROW_HEIGHT = 26,
    HEADER_HEIGHT = 30,
    TITLE_HEIGHT = 34;
  const columnWidths = matrix.columns.map((column, colIndex) => {
    const width = Math.max(
      measure(column.label, FONT_SIZE).width,
      ...cells.map((row) => measure(row[colIndex], FONT_SIZE).width),
    );
    return Math.min(width + 2 * PADDING_X, column.maxWidth);
  });
  const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0);
  const viewWidth = Math.max(totalWidth, measure(title, 13).width) + 2;
  const viewHeight = TITLE_HEIGHT + HEADER_HEIGHT + matrix.rows.length * ROW_HEIGHT + 2;

  const columnXPositions: number[] = [];
  {
    let columnX = 0;
    for (const width of columnWidths) {
      columnXPositions.push(columnX);
      columnX += width;
    }
  }
  const textXOf = (colIndex: number): number =>
    matrix.columns[colIndex].align === "middle"
      ? columnXPositions[colIndex] + columnWidths[colIndex] / 2
      : columnXPositions[colIndex] + PADDING_X;

  let svgOutput = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" font-family="${escAttr(matrix.style.fontFamily)},Arial,sans-serif">\n`;
  svgOutput += `<rect width="${viewWidth}" height="${viewHeight}" fill="${escAttr(matrix.style.background ?? pal.background)}"/>\n`;
  svgOutput += `<text x="1" y="22" font-size="13" font-weight="bold" fill="${pal.bandTitle}">${esc(title)}</text>\n`;

  const headerY = TITLE_HEIGHT;
  svgOutput += `<rect x="0" y="${headerY}" width="${totalWidth}" height="${HEADER_HEIGHT}" fill="${pal.containerFill}" stroke="${pal.divider}"/>\n`;
  headers.forEach((header, colIndex) => {
    svgOutput += `<text x="${textXOf(colIndex)}" y="${headerY + 20}" font-size="${FONT_SIZE}" font-weight="bold" text-anchor="${matrix.columns[colIndex].align}" fill="${pal.bandTitle}">${esc(header)}</text>\n`;
  });
  cells.forEach((row, rowIndex) => {
    const rowY = headerY + HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
    if (rowIndex % 2 === 1)
      svgOutput += `<rect x="0" y="${rowY}" width="${totalWidth}" height="${ROW_HEIGHT}" fill="${pal.divider}" opacity="0.18"/>\n`;
    row.forEach((cellText, colIndex) => {
      let text = cellText;
      const maxChars = Math.floor(
        (columnWidths[colIndex] - 2 * PADDING_X) / (FONT_SIZE * CHAR_WIDTH),
      );
      if (text.length > maxChars) text = text.slice(0, Math.max(1, maxChars - 1)) + "…";
      svgOutput += `<text x="${textXOf(colIndex)}" y="${rowY + 17}" font-size="${FONT_SIZE}" text-anchor="${matrix.columns[colIndex].align}" fill="${pal.bandText}">${esc(text)}</text>\n`;
    });
  });
  for (let colIndex = 1; colIndex < columnXPositions.length; colIndex++)
    svgOutput += `<line x1="${columnXPositions[colIndex]}" y1="${headerY}" x2="${columnXPositions[colIndex]}" y2="${viewHeight - 2}" stroke="${pal.divider}" stroke-width="1"/>\n`;
  svgOutput += `<line x1="0" y1="${viewHeight - 2}" x2="${totalWidth}" y2="${viewHeight - 2}" stroke="${pal.divider}"/>\n`;
  svgOutput += `<rect x="0" y="${headerY}" width="${totalWidth}" height="${viewHeight - headerY - 2}" fill="none" stroke="${pal.divider}"/>\n`;
  svgOutput += "</svg>\n";
  return svgOutput;
}
