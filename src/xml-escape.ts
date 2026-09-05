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

/**
 * Makes text safe inside an XML comment.
 *
 * Comment content is not parsed, so `&` and `<` must *not* be escaped here —
 * running an attribution URL through `esc` would turn a working link into
 * `…&amp;…` and break the very thing the notice exists to provide. What XML
 * forbids in a comment is the sequence `--`, and a `-` immediately before the
 * closing delimiter.
 */
export const escComment = (text: string) =>
  text.replace(/-{2,}/g, (run) => [...run].join(" ")).replace(/-$/, "- ");
