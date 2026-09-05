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
 * Makes text safe inside an XML comment: XML forbids `--`, and a `-` closing the
 * content. Deliberately does *not* escape `&` or `<` — comment content is not
 * parsed, and running an attribution URL through `esc` would break the link the
 * notice exists to provide.
 */
export const escComment = (text: string) =>
  text.replace(/-{2,}/g, (run) => [...run].join(" ")).replace(/-$/, "- ");
