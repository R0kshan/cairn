/**
 * Format Diagnostics for humans and machines.
 *
 * Two renderers over the coded Diagnostics that parse/validate produce:
 *   renderHuman  a Rust-style report — severity, code, the source line, a caret
 *                under the offending span, and an optional help line (ANSI
 *                colour when writing to a TTY).
 *   renderJson   the same diagnostics as structured JSON, for editors/tooling.
 */

import type { Diagnostic } from './model.ts';

const RESET = '\x1b[0m', BOLD = '\x1b[1m', RED = '\x1b[31m', YEL = '\x1b[33m', BLUE = '\x1b[34m', DIM = '\x1b[2m';

export function renderHuman(file: string, src: string, diags: Diagnostic[], color = true): string {
  const paint = (ansi: string, text: string) => (color ? ansi + text + RESET : text);
  const srcLines = src.split('\n');
  const report: string[] = [];
  const byPosition = [...diags].sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);

  for (const d of byPosition) {
    const severityColor = d.severity === 'error' ? RED : YEL;
    const gutterPad = ' '.repeat(String(d.span.line).length);
    const srcLine = srcLines[d.span.line - 1] ?? '';
    const caretCount = Math.max(1, Math.min(d.span.len, srcLine.length - d.span.col + 1 || 1));
    report.push(paint(BOLD + severityColor, `${d.severity === 'error' ? 'error' : 'warning'}[${d.code}]`) + paint(BOLD, `: ${d.message}`));
    report.push(paint(BLUE, `${gutterPad}--> `) + `${file}:${d.span.line}:${d.span.col}`);
    report.push(paint(BLUE, `${gutterPad} |`));
    report.push(paint(BLUE, `${d.span.line} | `) + srcLine);
    report.push(paint(BLUE, `${gutterPad} | `) + ' '.repeat(Math.max(0, d.span.col - 1)) + paint(severityColor, '^'.repeat(caretCount)));
    if (d.note) report.push(paint(BLUE, `${gutterPad} = `) + paint(DIM, `note: ${d.note}`));
    if (d.help) report.push(paint(BOLD, 'help') + `: ${d.help}`);
    report.push('');
  }

  const errorCount = diags.filter(d => d.severity === 'error').length;
  const warningCount = diags.filter(d => d.severity === 'warning').length;
  if (errorCount + warningCount > 0) {
    const parts = [];
    if (errorCount) parts.push(paint(BOLD + RED, `${errorCount} error${errorCount > 1 ? 's' : ''}`));
    if (warningCount) parts.push(paint(BOLD + YEL, `${warningCount} warning${warningCount > 1 ? 's' : ''}`));
    report.push(parts.join(', ') + paint(DIM, ' — run `cairn explain <code>` for the rule rationale'));
  }
  return report.join('\n');
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
