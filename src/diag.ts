// Diagnostic rendering: Rust-style human output + JSON mode.

import type { Diagnostic } from './model.ts';

const RESET = '\x1b[0m', BOLD = '\x1b[1m', RED = '\x1b[31m', YEL = '\x1b[33m', BLUE = '\x1b[34m', DIM = '\x1b[2m';

export function renderHuman(file: string, src: string, diags: Diagnostic[], color = true): string {
  const c = (code: string, s: string) => (color ? code + s + RESET : s);
  const lines = src.split('\n');
  const out: string[] = [];
  const sorted = [...diags].sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);

  for (const d of sorted) {
    const sevColor = d.severity === 'error' ? RED : YEL;
    const gutter = String(d.span.line).length;
    const pad = ' '.repeat(gutter);
    out.push(c(BOLD + sevColor, `${d.severity === 'error' ? 'error' : 'warning'}[${d.code}]`) + c(BOLD, `: ${d.message}`));
    out.push(c(BLUE, `${pad}--> `) + `${file}:${d.span.line}:${d.span.col}`);
    const srcLine = lines[d.span.line - 1] ?? '';
    out.push(c(BLUE, `${pad} |`));
    out.push(c(BLUE, `${d.span.line} | `) + srcLine);
    out.push(c(BLUE, `${pad} | `) + ' '.repeat(Math.max(0, d.span.col - 1)) + c(sevColor, '^'.repeat(Math.max(1, Math.min(d.span.len, srcLine.length - d.span.col + 1 || 1)))));
    if (d.note) out.push(c(BLUE, `${pad} = `) + c(DIM, `note: ${d.note}`));
    if (d.help) out.push(c(BOLD, 'help') + `: ${d.help}`);
    out.push('');
  }

  const ne = diags.filter(d => d.severity === 'error').length;
  const nw = diags.filter(d => d.severity === 'warning').length;
  if (ne + nw > 0) {
    const parts = [];
    if (ne) parts.push(c(BOLD + RED, `${ne} error${ne > 1 ? 's' : ''}`));
    if (nw) parts.push(c(BOLD + YEL, `${nw} warning${nw > 1 ? 's' : ''}`));
    out.push(parts.join(', ') + c(DIM, ' — run `cairn explain <code>` for the rule rationale'));
  }
  return out.join('\n');
}

export function renderJson(file: string, diags: Diagnostic[]): string {
  return JSON.stringify({
    file,
    diagnostics: diags.map(d => ({
      code: d.code,
      severity: d.severity,
      span: { file, line: d.span.line, col: d.span.col, len: d.span.len },
      message: d.message,
      note: d.note ?? null,
      help: d.help ?? null,
      fix: d.fix ?? null,
    })),
    summary: {
      errors: diags.filter(d => d.severity === 'error').length,
      warnings: diags.filter(d => d.severity === 'warning').length,
    },
  }, null, 2);
}
