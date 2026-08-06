/**
 * The published API contract, stated explicitly and checked by the compiler.
 *
 * `src/api.ts` is what `package.json`'s `exports` map publishes. Once a
 * consumer depends on it, any change to a shape below is a breaking change for
 * them — and nothing else in this repo would notice, because no test here
 * consumes the package the way a consumer does. Every expectation is asserted
 * *mutually* assignable, so widening a type fails as loudly as narrowing one.
 *
 * This file contains no runtime assertions and no test cases: it is checked by
 * `npm run typecheck` (which covers `tests/**`), and CI runs that on every PR.
 * Behaviour is covered separately by `package-api.test.ts`, against the built
 * bundle.
 *
 * **A failure here is not a bug to work around.** It means the public surface
 * moved. Either revert the change, or update the expectation below — the diff
 * is the record that a published contract changed, and the reason this file is
 * written out by hand rather than generated.
 */

// Type-only: every name below is used in a type position (`typeof compile`
// works on a type-only import), so nothing here loads the engine.
import type {
  compile,
  CompileDiagnostic,
  CompileMetrics,
  CompileOptions,
  CompileResult,
  Diagnostic,
  Severity,
  Span,
  themeNames,
  version,
} from "../../src/api.ts";

/**
 * `true` only when `Actual` and `Expected` are the *same* type.
 *
 * Deliberately identity-based rather than "assignable in both directions":
 * mutual assignability cannot see an added optional property, since
 * `{ theme?: string }` and `{ theme?: string; scale?: number }` are assignable
 * each way. Adding an optional field to a published option bag is exactly the
 * kind of quiet surface change this file exists to catch. The conditional-type
 * identity below distinguishes them.
 */
type Exact<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends <
  T,
>() => T extends Expected ? 1 : 2
  ? true
  : false;

/**
 * Fails to compile unless its type argument resolved to `true`.
 *
 * The mismatch case above must be `false`, not `never`: `never` satisfies every
 * constraint, so a `never` sentinel would make every assertion below vacuous.
 */
const assertExact = <_ extends true>(): void => {};

assertExact<Exact<Span, { line: number; col: number; len: number }>>();

assertExact<Exact<Severity, "error" | "warning">>();

assertExact<
  Exact<
    Diagnostic,
    {
      code: string;
      severity: Severity;
      message: string;
      span: Span;
      note?: string;
      help?: string;
      fix?: { insert: string; atEndOfLine?: boolean };
    }
  >
>();

assertExact<Exact<CompileDiagnostic, Diagnostic & { severity: "error" | "warning" }>>();

assertExact<
  Exact<CompileMetrics, { width: number; height: number; layoutMs: number; overlaps: number }>
>();

assertExact<
  Exact<
    CompileResult,
    {
      svg: string | null;
      diagnostics: CompileDiagnostic[];
      metrics: CompileMetrics | null;
    }
  >
>();

assertExact<Exact<CompileOptions, { theme?: string }>>();

assertExact<Exact<typeof compile, (source: string, options?: CompileOptions) => Promise<CompileResult>>>();

assertExact<Exact<typeof themeNames, string[]>>();

assertExact<Exact<typeof version, string>>();
