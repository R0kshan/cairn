/**
 * SVG string-safety helpers. `esc` escapes text content (`&`, `<`, `>`);
 * `escAttr` also escapes `"` for attribute values. Every user-supplied string
 * must pass through one of these — INVARIANTS §5.
 */

/** Escapes text content for safe SVG embedding (handles &, <, >). */
export const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Escapes text for SVG attribute values (handles &, <, >, "). */
export const escAttr = (text: string) => esc(text).replace(/"/g, "&quot;");
