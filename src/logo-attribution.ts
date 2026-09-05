/**
 * The attribution block a rendered SVG carries for the licensed artwork it
 * draws.
 *
 * Most built-in logos are covered by simple-icons' project-wide CC0-1.0, which
 * waives copyright and asks for nothing. Six are not: they keep their own MIT,
 * BSD-3-Clause, CC-BY-4.0 or Apache-2.0 terms, and each of those asks for
 * attribution from whoever passes a copy along. A diagram that draws one *is*
 * such a copy — the path data is in the file — and it travels without the
 * `licenses/` directory that discharges this everywhere else, so it has to say
 * for itself what it contains and where the terms are.
 *
 * Only what was actually drawn is named. The vendored table is not tree-shaken,
 * so every artifact carries all 37 paths, but an SVG carries only the marks it
 * painted — claiming otherwise would attribute artwork the file does not hold.
 */
import { LOGOS } from "./logos.ts";
import { escComment } from "./xml-escape.ts";

/**
 * Written into every block that has anything to say, so the reader knows the
 * notice is load-bearing.
 *
 * The modification sentence is not a courtesy. CC-BY-4.0 §3(a)(1)(B) asks that
 * a modification be indicated and that previous ones be retained, and
 * Apache-2.0 §4(b) asks that a changed file say so. Both apply: simple-icons
 * redrew each brand mark as a single monochrome path before cairn vendored it,
 * and cairn paints that path in the node's own colour rather than the mark's.
 * It sits in the preamble rather than under each entry because it is true of
 * every built-in logo, without exception.
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
 * licence — which is the common case, and costs an unlicensed diagram nothing.
 *
 * Entries are ordered by slug rather than by paint order so the same diagram
 * always renders the same bytes (INVARIANTS §2).
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
