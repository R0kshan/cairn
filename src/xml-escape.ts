/**
 * SVG string-safety helpers. `esc` escapes text content (`&`, `<`, `>`);
 * `escAttr` additionally escapes `"` for attribute values. SVG output is
 * untrusted-string territory — every user-supplied string must pass through one
 * of these (see the security convention in CLAUDE.md).
 */

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");
