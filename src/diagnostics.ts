/**
 * Diagnostic presentation. `renderHuman` formats `Diagnostic[]` as a
 * Rust-style report with source excerpt, carets, note/help and an optional-ANSI
 * colour summary; `renderJson` emits the machine-readable form for
 * `validate --format json`. Rendering only — the checks live in the validator.
 */

import type { Diagnostic } from "./models/diagnostic.ts";

const RESET = "\x1b[0m",
  BOLD = "\x1b[1m",
  RED = "\x1b[31m",
  YEL = "\x1b[33m",
  BLUE = "\x1b[34m",
  DIM = "\x1b[2m";

export function renderHuman(
  file: string,
  src: string,
  diagnostics: Diagnostic[],
  color = true,
): string {
  const paint = (ansi: string, text: string) => (color ? ansi + text + RESET : text);
  const srcLines = src.split("\n");
  const report: string[] = [];
  const byPosition = [...diagnostics].sort(
    (diagA, diagB) => diagA.span.line - diagB.span.line || diagA.span.col - diagB.span.col,
  );

  for (const diagnostic of byPosition) {
    const severityColor = diagnostic.severity === "error" ? RED : YEL;
    const gutterPad = " ".repeat(String(diagnostic.span.line).length);
    const srcLine = srcLines[diagnostic.span.line - 1] ?? "";
    const caretCount = Math.max(
      1,
      Math.min(diagnostic.span.len, srcLine.length - diagnostic.span.col + 1 || 1),
    );
    report.push(
      paint(
        BOLD + severityColor,
        `${diagnostic.severity === "error" ? "error" : "warning"}[${diagnostic.code}]`,
      ) + paint(BOLD, `: ${diagnostic.message}`),
    );
    report.push(
      paint(BLUE, `${gutterPad}--> `) + `${file}:${diagnostic.span.line}:${diagnostic.span.col}`,
    );
    report.push(paint(BLUE, `${gutterPad} |`));
    report.push(paint(BLUE, `${diagnostic.span.line} | `) + srcLine);
    report.push(
      paint(BLUE, `${gutterPad} | `) +
        " ".repeat(Math.max(0, diagnostic.span.col - 1)) +
        paint(severityColor, "^".repeat(caretCount)),
    );
    if (diagnostic.note)
      report.push(paint(BLUE, `${gutterPad} = `) + paint(DIM, `note: ${diagnostic.note}`));
    if (diagnostic.help) report.push(paint(BOLD, "help") + `: ${diagnostic.help}`);
    report.push("");
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  if (errorCount + warningCount > 0) {
    const parts = [];
    if (errorCount)
      parts.push(paint(BOLD + RED, `${errorCount} error${errorCount > 1 ? "s" : ""}`));
    if (warningCount)
      parts.push(paint(BOLD + YEL, `${warningCount} warning${warningCount > 1 ? "s" : ""}`));
    report.push(
      parts.join(", ") + paint(DIM, " — run `cairn explain <code>` for the rule rationale"),
    );
  }
  return report.join("\n");
}

export function renderJson(file: string, diagnostics: Diagnostic[]): string {
  return JSON.stringify(
    {
      file,
      diagnostics: diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        span: {
          file,
          line: d.span.line,
          col: d.span.col,
          len: d.span.len,
        },
        message: d.message,
        note: d.note ?? null,
        help: d.help ?? null,
        fix: d.fix ?? null,
      })),
      summary: {
        errors: diagnostics.filter((d) => d.severity === "error").length,
        warnings: diagnostics.filter((d) => d.severity === "warning").length,
      },
    },
    null,
    2,
  );
}
