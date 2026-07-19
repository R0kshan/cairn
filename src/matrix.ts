// Matrice des flux techniques — the primary deliverable of the physical /
// infrastructure view in French EA practice (Dossier d'Architecture). Emitted
// as a companion file (CSV or Markdown) next to the diagram on `cairn build`,
// so it can be dropped straight into the DA table.
//
// Columns: N° · Source (zone) · Destination (zone) · Protocole · Port · Nature du flux
// Protocol/port are split from the infra tech tail `(HTTPS/443)` on the last
// `/`; a trailing all-digit segment becomes the Port column.

import type { Model, View } from './model.ts';
import { UI, palettes, lightPalette } from './model.ts';
import { measure } from './text.ts';

export interface MatrixRow {
  n: number; source: string; dest: string;
  proto: string; port: string; nature: string;
}

// nearest enclosing network-zone (else site) label — the flow's security/network context
function zoneOf(model: Model, id: string): string | undefined {
  const e = model.index.get(id);
  for (let a = e?.parent; a; a = a.parent) {
    if (a.kind === 'network-zone' || a.kind === 'site') return a.label ?? a.id;
  }
  return undefined;
}

const endpoint = (model: Model, id: string): string => {
  const e = model.index.get(id);
  const name = e?.label?.replace(/\n/g, ' ') ?? id;
  const z = zoneOf(model, id);
  return z ? `${name} (${z})` : name;
};

// split `HTTPS/443` -> { proto: 'HTTPS', port: '443' }; `TCP/5432` likewise;
// `SFTP` (no port) -> { proto: 'SFTP', port: '' }.
function splitProto(protocol?: string): { proto: string; port: string } {
  if (!protocol) return { proto: '', port: '' };
  const i = protocol.lastIndexOf('/');
  if (i >= 0) {
    const tail = protocol.slice(i + 1);
    if (/^\d+$/.test(tail)) return { proto: protocol.slice(0, i), port: tail };
  }
  return { proto: protocol, port: '' };
}

export function buildMatrixRows(model: Model): MatrixRow[] {
  return model.flows.map(f => {
    const { proto, port } = splitProto(f.tech?.protocol);
    return {
      n: parseInt(f.id.slice(1), 10),
      source: endpoint(model, f.from),
      dest: endpoint(model, f.to),
      proto, port,
      nature: (f.label ?? '').replace(/\n/g, ' '),
    };
  });
}

const csvCell = (s: string): string => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

export function matrixCsv(model: Model, lang: 'en' | 'fr'): string {
  const h = UI[lang].matrix;
  const rows = buildMatrixRows(model);
  const header = [h.n, h.source, h.dest, h.proto, h.port, h.nature];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([String(r.n), r.source, r.dest, r.proto, r.port, r.nature].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function matrixMd(model: Model, _view: View, lang: 'en' | 'fr'): string {
  const h = UI[lang].matrix;
  const rows = buildMatrixRows(model);
  const title = model.title ? `${h.title} — ${model.title}` : h.title;
  const cols = [h.n, h.source, h.dest, h.proto, h.port, h.nature];
  const out: string[] = [`# ${title}`, ''];
  out.push('| ' + cols.join(' | ') + ' |');
  out.push('|' + cols.map(() => '---').join('|') + '|');
  for (const r of rows) {
    out.push('| ' + [String(r.n), r.source, r.dest, r.proto, r.port, r.nature].map(mdCell).join(' | ') + ' |');
  }
  return out.join('\n') + '\n';
}

// Standalone SVG table — a paste-ready image for the physical-view page. Honors
// the diagram's `theme` (light/dark palette) so it sits next to the diagram.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Attribute context needs the quote escaped too (see render.ts escAttr).
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

export function matrixSvg(model: Model, _view: View, lang: 'en' | 'fr'): string {
  const h = UI[lang].matrix;
  const pal = palettes[model.style.theme] ?? lightPalette;
  const rows = buildMatrixRows(model);
  const title = model.title ? `${h.title} — ${model.title}` : h.title;

  const headers = [h.n, h.source, h.dest, h.proto, h.port, h.nature];
  const cells = rows.map(r => [String(r.n), r.source, r.dest, r.proto, r.port, r.nature]);
  const NATURE_COL = 5;
  const FS = 11, PADX = 10, ROW_H = 26, HEAD_H = 30, TITLE_H = 34;
  const colW = headers.map((hd, c) => {
    const w = Math.max(measure(hd, FS).width, ...cells.map(row => measure(row[c], FS).width));
    // Source/Destination carry zone-annotated names — give them room; only the
    // free-text "nature" column is capped (and ellipsized) to keep width sane.
    const cap = (c === 1 || c === 2) ? 420 : c === NATURE_COL ? 360 : 220;
    return Math.min(w + 2 * PADX, cap);
  });
  const totalW = colW.reduce((a, b) => a + b, 0);
  const W = Math.max(totalW, measure(title, 13).width) + 2;
  const H = TITLE_H + HEAD_H + rows.length * ROW_H + 2;

  const colX: number[] = [];
  { let x = 0; for (const w of colW) { colX.push(x); x += w; } }

  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${escAttr(model.style.font.family)},Arial,sans-serif">\n`;
  out += `<rect width="${W}" height="${H}" fill="${model.style.background ?? pal.background}"/>\n`;
  out += `<text x="1" y="22" font-size="13" font-weight="bold" fill="${pal.bandTitle}">${esc(title)}</text>\n`;

  const y0 = TITLE_H;
  // header row
  out += `<rect x="0" y="${y0}" width="${totalW}" height="${HEAD_H}" fill="${pal.containerFill}" stroke="${pal.divider}"/>\n`;
  headers.forEach((hd, c) => {
    const anchor = (c === 0 || c === 4) ? 'middle' : 'start';
    const tx = anchor === 'middle' ? colX[c] + colW[c] / 2 : colX[c] + PADX;
    out += `<text x="${tx}" y="${y0 + 20}" font-size="${FS}" font-weight="bold" text-anchor="${anchor}" fill="${pal.bandTitle}">${esc(hd)}</text>\n`;
  });
  // body rows
  cells.forEach((row, ri) => {
    const y = y0 + HEAD_H + ri * ROW_H;
    if (ri % 2 === 1) out += `<rect x="0" y="${y}" width="${totalW}" height="${ROW_H}" fill="${pal.divider}" opacity="0.18"/>\n`;
    row.forEach((val, c) => {
      const anchor = (c === 0 || c === 4) ? 'middle' : 'start';
      const tx = anchor === 'middle' ? colX[c] + colW[c] / 2 : colX[c] + PADX;
      // clip long "nature" text to the capped column
      let text = val;
      const maxChars = Math.floor((colW[c] - 2 * PADX) / (FS * 0.56));
      if (text.length > maxChars) text = text.slice(0, Math.max(1, maxChars - 1)) + '…';
      out += `<text x="${tx}" y="${y + 17}" font-size="${FS}" text-anchor="${anchor}" fill="${pal.bandText}">${esc(text)}</text>\n`;
    });
  });
  // grid: column separators + bottom border
  for (let c = 1; c < colX.length; c++) out += `<line x1="${colX[c]}" y1="${y0}" x2="${colX[c]}" y2="${H - 2}" stroke="${pal.divider}" stroke-width="1"/>\n`;
  out += `<line x1="0" y1="${H - 2}" x2="${totalW}" y2="${H - 2}" stroke="${pal.divider}"/>\n`;
  out += `<rect x="0" y="${y0}" width="${totalW}" height="${H - y0 - 2}" fill="none" stroke="${pal.divider}"/>\n`;
  out += '</svg>\n';
  return out;
}
