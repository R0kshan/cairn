/**
 * @deprecated Legacy compatibility re-export from before the `models/` split.
 * Nothing in the codebase imports this — import directly from `./models/ast.ts`
 * and `./models/diagnostic.ts` instead. Safe to delete once no external consumer
 * relies on `cairn/src/model.ts`.
 */

export type {
  Span,
  StyleProps,
  Disposition,
  DiagramStyle,
  Element,
  Flow,
  BusinessObject,
  Model,
} from "./models/ast.ts";
export { defaultDiagramStyle, explanations } from "./models/ast.ts";
export type { Severity, Diagnostic } from "./models/diagnostic.ts";
