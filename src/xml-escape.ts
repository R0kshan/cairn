/**
 * SVG string-safety helpers. `esc` escapes text content (`&`, `<`, `>`);
 * `escAttr` also escapes `"` for attribute values. Every user-supplied string
 * must pass through one of these — INVARIANTS §5.
 */

export const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const escAttr = (text: string) => esc(text).replace(/"/g, "&quot;");
