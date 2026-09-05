/**
 * Regenerates `src/logos.ts` — the vendored tech-stack logo paths behind
 * `logo: <name>` in the DSL — and restamps the simple-icons version in
 * `THIRD-PARTY-NOTICES.md` so the two cannot disagree.
 *
 * Icons come from simple-icons (CC0-1.0). They are *vendored*, not depended on:
 * the published package installs zero dependencies, and cairn has no build step
 * for dev or test, so the paths are committed as source rather than generated
 * at build time. This script only has to run when the curated set changes.
 *
 * simple-icons is fetched with `npm pack` into a temp directory instead of being
 * added as a devDependency, so the dependency list stays at the five entries
 * AGENTS.md documents.
 *
 * Why these icons are safe to inline verbatim: every simple-icons glyph is a
 * single `<path>` in a `0 0 24 24` viewBox with no `id` and no `fill`, so they
 * carry no colour of their own (the renderer paints them in the node's stroke
 * colour), and inlining several into one document cannot collide on ids.
 *
 * The generated file is formatted here, with the repo's own pinned biome, so
 * "do not edit by hand" is literally true: a regeneration that changed nothing
 * leaves no diff, and there is no second command a maintainer can forget.
 *
 *   node scripts/update-logos.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Pinned so a regeneration is reproducible — bump deliberately, never floating. */
const SIMPLE_ICONS_VERSION = "16.29.0";

/**
 * Per-icon licences cairn is willing to redistribute. simple-icons as a project
 * is CC0-1.0, but its `DISCLAIMER.md` is explicit that individual icons may
 * carry their own terms, and a handful do — so the blanket licence is not
 * enough to go on.
 *
 * Everything here permits commercial redistribution, which is what cairn's own
 * Apache-2.0 grants downstream; the attribution each one asks for is discharged
 * by the generated table in `THIRD-PARTY-NOTICES.md`. Adding to this set is a
 * licensing decision, not a formality: check that the terms survive being
 * embedded in someone else's diagram and sold.
 */
const PERMITTED_LICENSES = new Set([
  "CC0-1.0",
  "MIT",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "Apache-2.0",
]);

/**
 * The curated set. Kept deliberately small: every entry costs bytes in
 * `bin/cairn.mjs`, and an architecture diagram names a handful of technologies,
 * not a catalogue. Anything missing is still reachable through a workspace file.
 *
 * Names are simple-icons slugs. Note that AWS, Azure and Oracle are absent from
 * simple-icons entirely, so they have no built-in and must come from a file.
 */
const CURATED = [
  // languages & runtimes
  "dotnet",
  "go",
  "javascript",
  "kotlin",
  "nodedotjs",
  "openjdk",
  "python",
  "typescript",
  // frameworks
  "angular",
  "django",
  "express",
  "fastapi",
  "nextdotjs",
  "react",
  "spring",
  // data stores
  "elasticsearch",
  "mongodb",
  "mysql",
  "postgresql",
  "redis",
  "sqlite",
  // messaging & streaming
  "apachekafka",
  "apachespark",
  "natsdotio",
  "rabbitmq",
  // platform & infrastructure
  "apache",
  "docker",
  "googlecloud",
  "grafana",
  "kubernetes",
  "nginx",
  "prometheus",
  "terraform",
  "vault",
  // delivery & identity
  "github",
  "gitlab",
  "graphql",
];

/**
 * Where the full text of each per-icon licence lives in `licenses/`. MIT and
 * BSD-3-Clause require the text itself to travel with a redistribution, not
 * just the identifier, and CC-BY-4.0 requires the licence be linked — an SPDX
 * id in a table discharges none of that on its own.
 *
 * `MIT` resolves to logo.js' own LICENSE, copyright line intact, because the
 * only MIT-licensed icon cairn vendors is the JavaScript mark from that repo.
 * If a second MIT icon is ever curated, this must become per-icon: an MIT text
 * carries its holder's name, so one file cannot stand in for two holders.
 */
const LICENSE_TEXTS = {
  MIT: "licenses/MIT-javascript-logo.js.txt",
  "BSD-3-Clause": "licenses/BSD-3-Clause.txt",
  "CC-BY-4.0": "licenses/CC-BY-4.0.txt",
  "Apache-2.0": "licenses/Apache-2.0.txt",
};

/**
 * Where each licence's text lives on the public web. cairn keeps this map
 * because simple-icons does not: its `license.url` field is populated only for
 * `custom` licences, and every icon cairn vendors declares an SPDX id instead —
 * so upstream records the identifier and nothing to link to. Verified against
 * simple-icons 16.29.0.
 *
 * A rendered SVG travels on its own, with no `licenses/` directory beside it,
 * so the relative links the notice table uses are useless there. These absolute
 * ones are what an exported diagram can actually carry.
 *
 * The publisher's own URL is preferred where there is one. MIT and BSD-3-Clause
 * have no single publisher — they are templates instantiated per rights-holder —
 * so those point at the SPDX registry, and the holder's own copyright line is
 * carried separately (see `copyrightLineOf`).
 */
const LICENSE_URLS = {
  MIT: "https://spdx.org/licenses/MIT.html",
  "BSD-3-Clause": "https://spdx.org/licenses/BSD-3-Clause.html",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/legalcode",
  "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0.txt",
};

/**
 * The rights-holder's own copyright line, read out of the licence text cairn
 * ships rather than retyped — one source, so the two cannot disagree.
 *
 * MIT and BSD-3-Clause ask for the copyright notice itself to travel with a
 * copy, which a link to a licence template does not supply. Returns null when
 * the shipped text carries no real line: `licenses/BSD-3-Clause.txt` is the
 * SPDX template with `<year> <owner>` left as upstream wrote them, because the
 * OpenJDK artwork publishes no copyright notice anywhere reachable (see
 * SOURCE_NOTES). Attribution for that mark is to its source URL instead.
 */
function copyrightLineOf(licenseType) {
  const text = LICENSE_TEXTS[licenseType];
  if (!text) return null;
  const lines = readFileSync(new URL(`../${text}`, import.meta.url), "utf8").split("\n");
  const line = lines.find((candidate) => /^Copyright\b/.test(candidate.trim()))?.trim() ?? null;
  // A template's placeholder is not a copyright line. `licenses/BSD-3-Clause.txt`
  // leaves `<year> <owner>` as SPDX wrote them, and Apache-2.0's appendix shows
  // `[yyyy] [name of copyright owner]` as an example for a licensor to fill in —
  // neither names a holder, and emitting one as attribution would be a lie.
  // A filled-in notice states a year; a placeholder spells one. Testing for the
  // year rather than for brackets keeps the holder's own `<email>` intact.
  if (!line || !/\b\d{4}\b/.test(line)) return null;
  return line.replace(/\s+$/, "").replace(/\.$/, "");
}

/**
 * Supplementary notes for icons whose recorded `source` no longer tells the
 * whole story. simple-icons' data is a snapshot: a URL that resolved when the
 * icon was added can rot, and a rotted attribution URL is a broken attribution.
 *
 * These are written by hand because they are the result of a search a script
 * cannot do — checking whether a rights-holder publishes a copyright notice
 * anywhere reachable. Recording the negative result matters as much as a
 * positive one: it stops the next reviewer repeating the hunt, and it is the
 * justification for attributing to a URL rather than to a named holder.
 */
const SOURCE_NOTES = {
  openjdk:
    "simple-icons records <https://hg.openjdk.java.net/duke/duke/file/ca00f100dafc/" +
    "vector/Agent.svg>, and that Mercurial host has been retired — it answers 403. " +
    "The attribution above therefore names the live GitHub location of the same " +
    "file, recorded in SOURCE_OVERRIDES rather than silently swapped. Checked " +
    "2026-09-04: that repository has no LICENSE file, the GitHub API reports no " +
    "licence for it, and `vector/Agent.svg` carries no copyright notice of its own. " +
    "So there is no upstream copyright line to reproduce, which is why " +
    "`licenses/BSD-3-Clause.txt` keeps the SPDX `<year> <owner>` fields blank and " +
    "attribution for this mark is to the source URL.",
};

/**
 * Live replacements for a recorded `source` that has since died.
 *
 * simple-icons' data is a snapshot, and attribution for these marks *is* the
 * URL — there is no copyright line behind them — so a rotted one is a broken
 * attribution, not a cosmetic blemish. It reaches further than the notice now
 * that a rendered SVG carries the source of every licensed mark it draws: a
 * dead link here ships inside every diagram that uses the logo.
 *
 * An override is a verified claim, not a guess: check that the replacement
 * serves the same artwork before adding one, and record what upstream says in
 * SOURCE_NOTES so the substitution stays visible rather than looking like
 * upstream data.
 */
const SOURCE_OVERRIDES = {
  openjdk: "https://github.com/openjdk/duke/blob/master/vector/Agent.svg",
};

const work = mkdtempSync(join(tmpdir(), "cairn-logos-"));
try {
  execFileSync("npm", ["pack", `simple-icons@${SIMPLE_ICONS_VERSION}`, "--silent"], {
    cwd: work,
    stdio: ["ignore", "ignore", "inherit"],
  });
  execFileSync("tar", ["xzf", `simple-icons-${SIMPLE_ICONS_VERSION}.tgz`], { cwd: work });
  const pkg = join(work, "package");

  const data = JSON.parse(readFileSync(join(pkg, "data", "simple-icons.json"), "utf8"));
  const icons = Array.isArray(data) ? data : (data.icons ?? Object.values(data));
  const titleBySlug = new Map(icons.map((icon) => [icon.slug, icon.title]));
  const bySlug = new Map(icons.map((icon) => [icon.slug, icon]));

  for (const slug of Object.keys(SOURCE_OVERRIDES)) {
    if (!SOURCE_NOTES[slug]) {
      throw new Error(
        `\`${slug}\` has a SOURCE_OVERRIDES entry but no SOURCE_NOTES entry — an ` +
          `attribution that does not match what upstream records has to say so, or ` +
          `the next reader cannot tell a verified correction from a typo`,
      );
    }
  }

  const rows = [];
  for (const slug of [...CURATED].sort()) {
    const file = join(pkg, "icons", `${slug}.svg`);
    if (!existsSync(file)) throw new Error(`simple-icons has no icon \`${slug}\``);
    const svg = readFileSync(file, "utf8");

    // Every icon is a single path with no fill and no id — assert rather than
    // assume, so a future simple-icons release cannot smuggle in a second path
    // or a hardcoded colour that would break theming or collide on ids.
    if ((svg.match(/<path/g) ?? []).length !== 1) throw new Error(`\`${slug}\` is not single-path`);
    if (/\bid="/.test(svg)) throw new Error(`\`${slug}\` carries an id`);
    if (/\b(fill|stroke)="/.test(svg)) throw new Error(`\`${slug}\` hardcodes a colour`);

    const d = svg.match(/<path\s+d="([^"]+)"/)?.[1];
    if (!d) throw new Error(`\`${slug}\` has no path data`);
    if (d.includes("`") || d.includes("\\")) throw new Error(`\`${slug}\` needs escaping`);

    const title = titleBySlug.get(slug) ?? slug;
    if (title.includes('"')) throw new Error(`\`${slug}\` title needs escaping`);

    // The project is CC0, but individual icons may carry their own terms, and a
    // few do. Only licences cairn can pass on under its own Apache-2.0 are
    // allowed through; anything else stops the build rather than shipping
    // quietly. Three distinct reasons, not one: NonCommercial bars the
    // commercial use Apache-2.0 grants downstream, so cairn would be promising a
    // right it does not hold; ShareAlike does permit commercial use but imposes
    // copyleft on adaptations, which cairn cannot discharge for whoever embeds
    // the mark in their own diagram; `custom` here is a trademark policy, which
    // is no copyright grant at all. An icon with no licence field is covered by
    // the project-wide CC0.
    const license = bySlug.get(slug)?.license;
    if (license && PERMITTED_LICENSES.has(license.type) && license.type !== "CC0-1.0") {
      // Permitting a licence is only half of it: its text has to be in
      // `licenses/` or the generated table would cite a file that does not
      // ship, and the attribution it claims to make would be a dead link.
      if (!LICENSE_TEXTS[license.type]) {
        throw new Error(
          `\`${slug}\` is ${license.type}, which is permitted but has no text in ` +
            `licenses/ — add it and register it in LICENSE_TEXTS before vendoring ` +
            `an icon that needs it`,
        );
      }
      // The notice table can cite a relative path because it sits next to
      // `licenses/`. An exported SVG cannot: it travels alone, so the only
      // attribution it can carry is an absolute URL. Missing one would ship a
      // diagram whose attribution names a licence it cannot point at.
      if (!LICENSE_URLS[license.type]) {
        throw new Error(
          `\`${slug}\` is ${license.type}, which is permitted but has no public URL in ` +
            `LICENSE_URLS — an exported SVG has no \`licenses/\` beside it, so register ` +
            `the licence's canonical address before vendoring an icon that needs it`,
        );
      }
    }
    if (license && !PERMITTED_LICENSES.has(license.type)) {
      throw new Error(
        `\`${slug}\` is ${license.type}, which cairn cannot pass on under Apache-2.0 — ` +
          `drop it from CURATED, or add the licence to PERMITTED_LICENSES if it ` +
          `really does allow commercial use and imposes nothing cairn cannot ` +
          `discharge for a user's own diagram`,
      );
    }

    // `source` is the upstream artwork URL simple-icons records — the page the
    // mark actually came from. For an icon whose own licence requires
    // attribution it is the attributable identification of origin, and for one
    // whose rights-holder publishes no copyright line anywhere machine-readable
    // it is the only honest thing to point a reader at. Carried into the notice
    // rather than dropped here.
    const recordedSource = bySlug.get(slug)?.source ?? null;
    // An override replaces a dead URL, so it must not stand in for a missing
    // one: without a recorded source there is nothing to have verified the
    // replacement against, and the check below has to keep failing.
    const source = recordedSource ? (SOURCE_OVERRIDES[slug] ?? recordedSource) : null;
    if (license && license.type !== "CC0-1.0" && !source) {
      // An icon under its own MIT/BSD/CC-BY/Apache terms owes attribution, and
      // attribution has to identify *something*. Without a source there is
      // nothing to name — the generated table would print an em dash and the
      // notice would claim an attribution it does not actually make. Stop, the
      // same way an unpermitted licence stops the build, rather than publish a
      // table with a hole in it.
      throw new Error(
        `\`${slug}\` is ${license.type} but simple-icons records no \`source\` for it — ` +
          `there is no artwork provenance to attribute to. Drop it from CURATED, or ` +
          `get the \`source\` field populated upstream in simple-icons. Adding a ` +
          `SOURCE_NOTES entry will NOT clear this: that map only annotates a source ` +
          `that already exists, so generation would keep failing here`,
      );
    }

    const ownLicense = license && license.type !== "CC0-1.0" ? license.type : null;
    rows.push({
      slug,
      title,
      d,
      license: ownLicense,
      // Upstream's own URL wins when it has one — only `custom` licences carry
      // it today, and none of those get past PERMITTED_LICENSES, but a future
      // simple-icons release populating it should not be second-guessed here.
      licenseUrl: ownLicense ? (license.url ?? LICENSE_URLS[ownLicense]) : null,
      copyright: ownLicense ? copyrightLineOf(ownLicense) : null,
      source,
    });
  }

  // Only the icons that carry their own terms get the extra fields. Emitting
  // `license: null` for the other 31 would cost bytes in every artifact to say
  // nothing — the project-wide CC0-1.0 already covers them, and CC0 asks for no
  // attribution at all.
  const body = rows
    .map((row) => {
      const fields = [`title: "${row.title}"`, `d: "${row.d}"`];
      if (row.license) {
        for (const [name, value] of [
          ["license", row.license],
          ["licenseUrl", row.licenseUrl],
          ["source", row.source],
          ["copyright", row.copyright],
        ]) {
          if (!value) continue;
          if (value.includes('"') || value.includes("\\")) {
            throw new Error(`\`${row.slug}\` ${name} needs escaping: ${value}`);
          }
          fields.push(`${name}: "${value}"`);
        }
      }
      return `  ${row.slug}: { ${fields.join(", ")} },`;
    })
    .join("\n");

  writeFileSync(
    new URL("../src/logos.ts", import.meta.url),
    `/**
 * Built-in tech-stack logos behind \`logo: <name>\` in the DSL.
 *
 * GENERATED by \`scripts/update-logos.mjs\` from simple-icons
 * ${SIMPLE_ICONS_VERSION} (CC0-1.0) — do not edit by hand; change the curated
 * list in that script and re-run it.
 *
 * Each entry is the single \`d\` of a \`0 0 24 24\` path carrying no colour of
 * its own, so the renderer scales it into the logo box and paints it in the
 * node's stroke colour like the kind glyphs.
 *
 * An icon that carries its own licence also carries the attribution data that
 * licence asks for, because a rendered SVG leaves \`licenses/\` behind and has
 * to say for itself what artwork it contains. The full texts stay in
 * THIRD-PARTY-NOTICES.md.
 */

export interface Logo {
  /** Brand name as simple-icons spells it — used by \`did you mean\` and the SVG title. */
  title: string;
  /** Path data in a \`0 0 24 24\` box. */
  d: string;
  /**
   * SPDX id of the artwork's own licence. Absent for most icons, which the
   * project-wide CC0-1.0 covers and which owe no attribution. Present means a
   * diagram drawing this mark redistributes licensed artwork, so the export
   * has to say so — see \`logo-attribution.ts\`.
   */
  license?: string;
  /** Public address of that licence's text, for an SVG that travels alone. */
  licenseUrl?: string;
  /** The artwork's origin, which is what attribution identifies. */
  source?: string;
  /** The rights-holder's own copyright line, where one is published. */
  copyright?: string;
}

export const LOGOS: Record<string, Logo> = {
${body}
};

/** Every built-in name, sorted — for diagnostics and \`did you mean\` suggestions. */
export const LOGO_NAMES: string[] = Object.keys(LOGOS);
`,
  );

  // One entry is written per line above, which biome then reflows. Formatting
  // it here rather than leaving it to `npm run format` is what makes the
  // generated file byte-stable: regenerating at an unchanged pin produces no
  // diff at all. The repo's own pinned biome is used directly — not `npx`,
  // which would reach the network for a version nothing here has agreed to.
  // fileURLToPath, not `.pathname`: the latter keeps percent-encoding, so a
  // checkout under a directory with a space in it yields a path that does not
  // exist, and on Windows it yields a leading-slash `/C:/…` that is not a
  // native path either.
  const root = fileURLToPath(new URL("..", import.meta.url));
  const biome = fileURLToPath(new URL("../node_modules/.bin/biome", import.meta.url));
  if (!existsSync(biome)) {
    throw new Error("node_modules/.bin/biome is missing — run `npm install` first");
  }
  execFileSync(biome, ["format", "--write", "src/logos.ts"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // THIRD-PARTY-NOTICES.md names the version too, and it is the one copy a
  // person edits by hand — so it is the one that can silently disagree with the
  // paths actually vendored. Rewrite it from the same constant that produced
  // them. The line is matched by its simple-icons upstream URL so the elkjs
  // entry above it cannot be hit by accident.
  const noticesUrl = new URL("../THIRD-PARTY-NOTICES.md", import.meta.url);
  const notices = readFileSync(noticesUrl, "utf8");
  const versionLine = /^Version .+, CC0-1\.0\. Upstream: (https:\/\/github\.com\/simple-icons\/simple-icons)$/m;
  const matches = notices.match(new RegExp(versionLine, "gm")) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `THIRD-PARTY-NOTICES.md: expected 1 simple-icons version line, found ${matches.length}`,
    );
  }
  let updated = notices.replace(
    versionLine,
    `Version ${SIMPLE_ICONS_VERSION}, CC0-1.0. Upstream: $1`,
  );

  // The icons that carry their own licence need naming individually — a blanket
  // "CC0-1.0" over the whole set would be false for them, and MIT, BSD-3-Clause,
  // CC-BY-4.0 and Apache-2.0 each ask for attribution that only a per-icon entry
  // discharges. Generated from the same data that gated them above, so the
  // notice cannot drift from what was actually vendored.
  const licensed = rows.filter((row) => row.license && row.license !== "CC0-1.0");
  const table = [
    "<!-- generated by scripts/update-logos.mjs — do not edit by hand -->",
    "",
    `Most of the ${rows.length} vendored icons carry no licence of their own and are`,
    "covered by the project-wide CC0-1.0 above. These declare their own, which",
    "applies to that icon's artwork instead:",
    "",
    "| Icon | Licence | Full text | Artwork source |",
    "| --- | --- | --- | --- |",
    ...licensed.map((row) => {
      const text = LICENSE_TEXTS[row.license];
      const link = text ? `[\`${text.replace("licenses/", "")}\`](./${text})` : "—";
      const source = row.source ? `<${row.source}>` : "—";
      return `| ${row.title} (\`${row.slug}\`) | ${row.license} | ${link} | ${source} |`;
    }),
    "",
    "Each permits commercial redistribution and asks for attribution, which this",
    "table and the shipped licence texts are. **Attribution is to the artwork",
    "source named above.** Where a rights-holder publishes no copyright line at",
    "that source — as is the case for several of these marks — cairn identifies",
    "the origin by that URL rather than assert a copyright holder it cannot",
    "verify. `licenses/BSD-3-Clause.txt` is consequently the SPDX template, with",
    "the `<year> <owner>` fields as upstream left them; see `licenses/README.md`.",
    "",
    ...(() => {
      const noted = licensed.filter((row) => SOURCE_NOTES[row.slug]);
      if (noted.length === 0) return [];
      return [
        "Source notes:",
        "",
        ...noted.map((row) => `- **${row.title} (\`${row.slug}\`)** — ${SOURCE_NOTES[row.slug]}`),
        "",
      ];
    })(),
    "Three kinds of terms are refused by the generator instead, and never reach",
    "`src/logos.ts`, for three different reasons:",
    "",
    "- **NonCommercial** bars the commercial use cairn's own Apache-2.0 grants",
    "  downstream, so cairn would be promising a right it does not hold.",
    "- **ShareAlike** does permit commercial use, but requires adaptations to carry",
    "  the same licence — an obligation cairn cannot discharge on behalf of whoever",
    "  embeds the mark in their own diagram.",
    "- **A trademark policy** in place of a licence is not a copyright grant at all,",
    "  so there is no permission to copy the artwork to rely on.",
    "",
    "<!-- end generated -->",
  ].join("\n");

  const block = /<!-- generated by scripts\/update-logos\.mjs[\s\S]*?<!-- end generated -->/;
  if (!block.test(updated)) {
    throw new Error("THIRD-PARTY-NOTICES.md: per-icon licence block markers are missing");
  }
  updated = updated.replace(block, table);

  if (updated !== notices) {
    writeFileSync(noticesUrl, updated);
    console.log(
      `✓ THIRD-PARTY-NOTICES.md — ${SIMPLE_ICONS_VERSION}, ${licensed.length} per-icon licences`,
    );
  }

  const bytes = rows.reduce((sum, row) => sum + row.d.length, 0);
  console.log(`✓ src/logos.ts — ${rows.length} logos, ${(bytes / 1024).toFixed(1)} KB of path data`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
