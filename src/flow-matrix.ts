/**
 * The infrastructure *matrice des flux techniques* exporter — the primary
 * deliverable of the infrastructure view. Builds one row per flow (number,
 * source/dest with zone, protocol/port split, nature) and renders it as CSV, GFM
 * table, or a standalone themed SVG. Column headers localize via `style { lang }`.
 */

import type { Model } from "./models/ast.ts";
import type { View } from "./views.ts";
import { UI } from "./localization.ts";
import { palettes, lightPalette } from "./themes.ts";
import { esc, escAttr } from "./xml-escape.ts";
import { measure, CHAR_WIDTH } from "./text-metrics.ts";

export interface MatrixRow {
  num: number;
  source: string;
  dest: string;
  proto: string;
  port: string;
  nature: string;
}

function zoneOf(model: Model, id: string): string | undefined {
  const element = model.index.get(id);
  for (let ancestor = element?.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.kind === "network-zone" || ancestor.kind === "site")
      return ancestor.label ?? ancestor.id;
  }
  return undefined;
}

const endpoint = (model: Model, id: string): string => {
  const element = model.index.get(id);
  const name = element?.label?.replace(/\n/g, " ") ?? id;
  const zone = zoneOf(model, id);
  return zone ? `${name} (${zone})` : name;
};

function splitProto(protocol?: string): { proto: string; port: string } {
  if (!protocol) return { proto: "", port: "" };
  const slashIndex = protocol.lastIndexOf("/");
  if (slashIndex >= 0) {
    const tail = protocol.slice(slashIndex + 1);
    if (/^\d+$/.test(tail)) return { proto: protocol.slice(0, slashIndex), port: tail };
  }
  return { proto: protocol, port: "" };
}

export function buildMatrixRows(model: Model): MatrixRow[] {
  return model.flows.map((flow) => {
    const { proto, port } = splitProto(flow.tech?.protocol);
    return {
      num: parseInt(flow.id.slice(1), 10),
      source: endpoint(model, flow.from),
      dest: endpoint(model, flow.to),
      proto,
      port,
      nature: (flow.label ?? "").replace(/\n/g, " "),
    };
  });
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function matrixCsv(model: Model, lang: "en" | "fr"): string {
  const h = UI[lang].matrix;
  const rows = buildMatrixRows(model);
  const header = [h.n, h.source, h.dest, h.proto, h.port, h.nature];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [String(row.num), row.source, row.dest, row.proto, row.port, row.nature]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

const mdCell = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function matrixMd(model: Model, _view: View, lang: "en" | "fr"): string {
  const h = UI[lang].matrix;
  const rows = buildMatrixRows(model);
  const title = model.title ? `${h.title} — ${model.title}` : h.title;
  const cols = [h.n, h.source, h.dest, h.proto, h.port, h.nature];
  const outLines: string[] = [`# ${title}`, ""];
  outLines.push("| " + cols.join(" | ") + " |");
  outLines.push("|" + cols.map(() => "---").join("|") + "|");
  for (const row of rows) {
    outLines.push(
      "| " +
        [String(row.num), row.source, row.dest, row.proto, row.port, row.nature]
          .map(mdCell)
          .join(" | ") +
        " |",
    );
  }
  return outLines.join("\n") + "\n";
}

export function matrixSvg(model: Model, _view: View, lang: "en" | "fr"): string {
  const h = UI[lang].matrix;
  const pal = palettes[model.style.theme] ?? lightPalette;
  const rows = buildMatrixRows(model);
  const title = model.title ? `${h.title} — ${model.title}` : h.title;

  const headers = [h.n, h.source, h.dest, h.proto, h.port, h.nature];
  const cells = rows.map((row) => [
    String(row.num),
    row.source,
    row.dest,
    row.proto,
    row.port,
    row.nature,
  ]);
  const NATURE_COL = 5;
  const FONT_SIZE = 11,
    PADDING_X = 10,
    ROW_HEIGHT = 26,
    HEADER_HEIGHT = 30,
    TITLE_HEIGHT = 34;
  const columnWidths = headers.map((header, colIndex) => {
    const width = Math.max(
      measure(header, FONT_SIZE).width,
      ...cells.map((row) => measure(row[colIndex], FONT_SIZE).width),
    );
    const cap = colIndex === 1 || colIndex === 2 ? 420 : colIndex === NATURE_COL ? 360 : 220;
    return Math.min(width + 2 * PADDING_X, cap);
  });
  const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0);
  const viewWidth = Math.max(totalWidth, measure(title, 13).width) + 2;
  const viewHeight = TITLE_HEIGHT + HEADER_HEIGHT + rows.length * ROW_HEIGHT + 2;

  const columnXPositions: number[] = [];
  {
    let x = 0;
    for (const width of columnWidths) {
      columnXPositions.push(x);
      x += width;
    }
  }

  let svgOutput = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" font-family="${escAttr(model.style.font.family)},Arial,sans-serif">\n`;
  svgOutput += `<rect width="${viewWidth}" height="${viewHeight}" fill="${model.style.background ?? pal.background}"/>\n`;
  svgOutput += `<text x="1" y="22" font-size="13" font-weight="bold" fill="${pal.bandTitle}">${esc(title)}</text>\n`;

  const headerY = TITLE_HEIGHT;
  svgOutput += `<rect x="0" y="${headerY}" width="${totalWidth}" height="${HEADER_HEIGHT}" fill="${pal.containerFill}" stroke="${pal.divider}"/>\n`;
  headers.forEach((header, colIndex) => {
    const anchor = colIndex === 0 || colIndex === 4 ? "middle" : "start";
    const textX =
      anchor === "middle"
        ? columnXPositions[colIndex] + columnWidths[colIndex] / 2
        : columnXPositions[colIndex] + PADDING_X;
    svgOutput += `<text x="${textX}" y="${headerY + 20}" font-size="${FONT_SIZE}" font-weight="bold" text-anchor="${anchor}" fill="${pal.bandTitle}">${esc(header)}</text>\n`;
  });
  cells.forEach((row, rowIndex) => {
    const y = headerY + HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
    if (rowIndex % 2 === 1)
      svgOutput += `<rect x="0" y="${y}" width="${totalWidth}" height="${ROW_HEIGHT}" fill="${pal.divider}" opacity="0.18"/>\n`;
    row.forEach((cellText, colIndex) => {
      const anchor = colIndex === 0 || colIndex === 4 ? "middle" : "start";
      const textX =
        anchor === "middle"
          ? columnXPositions[colIndex] + columnWidths[colIndex] / 2
          : columnXPositions[colIndex] + PADDING_X;
      let text = cellText;
      const maxChars = Math.floor(
        (columnWidths[colIndex] - 2 * PADDING_X) / (FONT_SIZE * CHAR_WIDTH),
      );
      if (text.length > maxChars) text = text.slice(0, Math.max(1, maxChars - 1)) + "…";
      svgOutput += `<text x="${textX}" y="${y + 17}" font-size="${FONT_SIZE}" text-anchor="${anchor}" fill="${pal.bandText}">${esc(text)}</text>\n`;
    });
  });
  for (let colIndex = 1; colIndex < columnXPositions.length; colIndex++)
    svgOutput += `<line x1="${columnXPositions[colIndex]}" y1="${headerY}" x2="${columnXPositions[colIndex]}" y2="${viewHeight - 2}" stroke="${pal.divider}" stroke-width="1"/>\n`;
  svgOutput += `<line x1="0" y1="${viewHeight - 2}" x2="${totalWidth}" y2="${viewHeight - 2}" stroke="${pal.divider}"/>\n`;
  svgOutput += `<rect x="0" y="${headerY}" width="${totalWidth}" height="${viewHeight - headerY - 2}" fill="none" stroke="${pal.divider}"/>\n`;
  svgOutput += "</svg>\n";
  return svgOutput;
}
