/**
 * The `Diagnostic` shape every stage emits instead of throwing: a stable code
 * (`E0xxx`/`W0xxx`), severity, message, source `span`, and optional note/help/fix.
 * User errors are data, not exceptions — see the diagnostics convention in CLAUDE.md.
 */

import type { Span } from "./ast.ts";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  span: Span;
  note?: string;
  help?: string;
  fix?: { insert: string; atEndOfLine?: boolean };
}
