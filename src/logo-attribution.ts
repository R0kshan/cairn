/**
 * The attribution block a rendered SVG carries for the licensed artwork it draws.
 *
 * Six of the built-in logos keep their own MIT, BSD-3-Clause, CC-BY-4.0 or
 * Apache-2.0 terms instead of simple-icons' project-wide CC0-1.0, and each asks
 * for attribution from whoever passes a copy along. A diagram that draws one is
 * such a copy — the path data is in the file — and it travels without the
 * `licenses/` directory that discharges this on every other channel.
 *
 * Only marks actually painted are named: the vendored table is not tree-shaken,
 * so an artifact holds all 37 paths while an SVG holds what it drew.
 */
import { LOGOS } from "./logos.ts";
import { escComment } from "./xml-escape.ts";

/**
 * Opens every block that has something to say.
 *
 * The modification sentence is required, not courtesy: CC-BY-4.0 §3(a)(1)(B)
 * asks that a modification be indicated and previous ones retained, Apache-2.0
 * §4(b) that a changed file say so. Both apply to every built-in without
 * exception, which is why it sits here rather than under each entry.
 */
const PREAMBLE = [
  "This diagram contains third-party artwork under its own licence.",
  "Keep this notice with the file — it is the attribution those licences ask for.",
  "",
  "Every mark below is modified from the original: simple-icons redrew it as a",
  "single monochrome path, and cairn paints that path in the diagram's colours.",
];

/**
 * The XML comment for `drawn`, or `""` when nothing drawn carries its own
 * licence — the common case, which costs such a diagram nothing.
 *
 * Sorted by slug, not paint order, so the same diagram renders the same bytes
 * (INVARIANTS §2).
 */
export function logoAttributionComment(drawn: ReadonlySet<string>): string {
  const licensed = [...drawn]
    .sort()
    .map((slug) => ({ slug, logo: LOGOS[slug] }))
    .filter((entry) => entry.logo?.license);
  if (licensed.length === 0) return "";

  const lines = [...PREAMBLE];
  for (const { slug, logo } of licensed) {
    lines.push("", `${logo.title} (${slug}) — ${logo.license}`);
    if (logo.copyright) lines.push(`  ${logo.copyright}`);
    if (logo.source) lines.push(`  artwork: ${logo.source}`);
    if (logo.licenseUrl) lines.push(`  licence: ${logo.licenseUrl}`);
  }
  return `<!--\n${lines.map((line) => escComment(`  ${line}`).trimEnd()).join("\n")}\n-->\n`;
}
