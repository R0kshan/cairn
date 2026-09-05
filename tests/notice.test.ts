/**
 * Guards the licensing obligations that no other test can see fail.
 *
 * Every check here corresponds to a way the notices have already gone wrong or
 * could silently go wrong again: a bundle shipped with its banner stripped, a
 * deployed playground serving a stale copy of the notice, a `licenses/` file
 * cited by the notice but absent from what the tarball ships, or the reverse.
 * None of these break a build, none change a rendered diagram, and all of them
 * are compliance failures — so they need an assertion or they need luck.
 *
 * Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { notice, BUN_VERSION, ELKJS_VERSION, SIMPLE_ICONS_VERSION } from "../src/notice.ts";
import { compile } from "../src/api.ts";
import { LOGOS } from "../src/logos.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/** The bundles esbuild builds and the repo checks in, each of which must carry the banner. */
const BUNDLES = ["playground/cairn-engine.js", "playground/lib/engine.node.mjs"];

test("committed bundles carry the current notice banner", () => {
  // The banner is the ONLY notice a bundle carries — `--minify` strips elkjs'
  // own plain-comment header, so a bundle rebuilt without the banner ships
  // EPL-2.0 code with nothing attached and looks perfectly fine.
  const expected = notice({ bun: false });
  for (const bundle of BUNDLES) {
    const head = read(bundle).slice(0, 4096);
    assert.ok(head.startsWith("/*!"), `${bundle} does not start with a \`/*!\` legal comment`);
    for (const line of expected.split("\n").filter(Boolean)) {
      assert.ok(
        head.includes(line),
        `${bundle} banner is stale — missing line from src/notice.ts: ${line}`,
      );
    }
  }
});

test("bundle banners do not claim the Bun runtime they don't contain", () => {
  // esbuild bundles run on whatever host the user has; only `bun build
  // --compile` embeds a runtime. Claiming otherwise would misstate what the
  // artifact contains just as surely as omitting a notice.
  for (const bundle of BUNDLES) {
    const head = read(bundle).slice(0, 4096);
    assert.ok(!head.includes("LGPL"), `${bundle} banner claims LGPL content it does not carry`);
  }
});

test("playground serves the same notices as the repo root", () => {
  // playground/ is deployed as static files exactly as committed, so a stale
  // copy here is a stale notice in production — which is what shipped before.
  assert.equal(read("playground/LICENSE"), read("LICENSE"), "playground/LICENSE is stale");
  assert.equal(
    read("playground/THIRD-PARTY-NOTICES.md"),
    read("THIRD-PARTY-NOTICES.md"),
    "playground/THIRD-PARTY-NOTICES.md is stale — run `npm run build:playground`",
  );

  const rootTexts = readdirSync(join(ROOT, "licenses")).sort();
  const servedTexts = readdirSync(join(ROOT, "playground/licenses")).sort();
  assert.deepEqual(servedTexts, rootTexts, "playground/licenses/ is out of step with licenses/");
  for (const file of rootTexts) {
    assert.equal(read("playground", "licenses", file), read("licenses", file), `${file} is stale`);
  }
});

test("every `./licenses/` link in the notices resolves in both trees", () => {
  // A notice whose licence links 404 discharges nothing. These links were broken
  // on the deployed site by a flat copy that ignored the directory structure.
  const links = [...read("THIRD-PARTY-NOTICES.md").matchAll(/\]\(\.\/(licenses\/[^)]+)\)/g)].map(
    (match) => match[1],
  );
  assert.ok(links.length > 0, "THIRD-PARTY-NOTICES.md links no licence texts at all");
  for (const link of new Set(links)) {
    assert.ok(statSync(join(ROOT, link)).isFile(), `dead link in the notices: ./${link}`);
    assert.ok(
      statSync(join(ROOT, "playground", link)).isFile(),
      `dead link on the deployed playground: ./${link}`,
    );
  }
});

test("no licence text ships unexplained, and none is cited without shipping", () => {
  // Both directions matter. A text nobody references is dead weight a reviewer
  // has to account for; a reference with no text is an unmet obligation.
  const notices = read("THIRD-PARTY-NOTICES.md");
  const provenance = read("licenses/README.md");
  for (const file of readdirSync(join(ROOT, "licenses"))) {
    if (file === "README.md") continue;
    assert.ok(
      notices.includes(file) || provenance.includes(file),
      `licenses/${file} is shipped but named in neither THIRD-PARTY-NOTICES.md nor licenses/README.md`,
    );
    assert.ok(provenance.includes(file), `licenses/${file} has no provenance row in licenses/README.md`);
  }
});

test("pinned versions agree across the notice, the lockfile and the workflow", () => {
  // The notice names versions; if it names the wrong one it is worse than
  // silent, because a reader cannot check what they were given.
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(
    lock.packages["node_modules/elkjs"].version,
    ELKJS_VERSION,
    "ELKJS_VERSION in src/notice.ts does not match package-lock.json",
  );
  assert.ok(
    read("scripts/update-logos.mjs").includes(`SIMPLE_ICONS_VERSION = "${SIMPLE_ICONS_VERSION}"`),
    "SIMPLE_ICONS_VERSION in src/notice.ts does not match scripts/update-logos.mjs",
  );
  assert.ok(
    read(".github/workflows/release.yml").includes(`bun-version: ${BUN_VERSION}`),
    "BUN_VERSION in src/notice.ts does not match the pin in release.yml — the binaries would " +
      "embed a runtime the notice cannot name",
  );
});

test("the npm tarball is configured to ship what the notice promises", () => {
  const files: string[] = JSON.parse(read("package.json")).files;
  for (const required of ["LICENSE", "THIRD-PARTY-NOTICES.md", "licenses/"]) {
    assert.ok(files.includes(required), `package.json \`files\` omits ${required}`);
  }
});

/**
 * `cairn version` is the only way a released binary hands a user its notices,
 * so its argument handling is part of the licensing surface rather than a CLI
 * detail. These spawn the real CLI: the parsing lives in module-level code in
 * `cli.ts`, which cannot be imported without running it.
 */
const runCli = (...argv: string[]) => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(ROOT, "src/cli.ts"), ...argv],
    { encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

test("`cairn version` prints exactly one parseable line", () => {
  // scripts/smoke-binary.sh asserts this equals `cairn v<tag>` for a released
  // binary, and the release workflow depends on that. The TTY-only attribution
  // line must never reach a pipe, which is what this spawn is.
  const { status, stdout } = runCli("version");
  assert.equal(status, 0);
  assert.equal(stdout.trimEnd().split("\n").length, 1, `expected one line, got: ${stdout}`);
  assert.match(stdout, /^cairn v.+\n$/);
});

test("`cairn version --licenses` prints the notice, in both spellings", () => {
  for (const flag of ["--licenses", "--licences"]) {
    const { status, stdout } = runCli("version", flag);
    assert.equal(status, 0, `${flag} exited ${status}`);
    for (const line of notice({ bun: false }).split("\n").filter(Boolean)) {
      assert.ok(stdout.includes(line), `${flag} output is missing: ${line}`);
    }
  }
});

test("`cairn version` refuses an unknown flag instead of ignoring it", () => {
  // Silently dropping it prints the bare version and exits 0, which is
  // indistinguishable from the flag being broken — the report that prompted this.
  const { status, stdout, stderr } = runCli("version", "--licens");
  assert.equal(status, 2, "a misspelt flag must not exit 0");
  assert.equal(stdout, "", "a rejected invocation must print no version line");
  assert.match(stderr, /unknown flag/);
});

test("the reader-facing summary agrees with the generated icon table", () => {
  // "What this means for you" restates, in prose, numbers and slugs that
  // scripts/update-logos.mjs owns: the vendored total, how many carry their own
  // terms, and which. That prose sits OUTSIDE the generated markers, so adding
  // or dropping a licensed icon updates the table and silently leaves the
  // summary wrong — a reader would then be told an obligation does not apply to
  // artwork that in fact carries one.
  const notices = read("THIRD-PARTY-NOTICES.md");
  const generated = notices.match(
    /<!-- generated by scripts\/update-logos\.mjs[\s\S]*?<!-- end generated -->/,
  )?.[0];
  assert.ok(generated, "generated icon block is missing");

  const total = Number(generated.match(/Most of the (\d+) vendored icons/)?.[1]);
  assert.ok(Number.isInteger(total), "could not read the vendored total from the generated block");

  const licensedSlugs = [...generated.matchAll(/^\| .+? \(`([a-z0-9]+)`\) \|/gm)].map((m) => m[1]);
  assert.ok(licensedSlugs.length > 0, "generated block lists no licensed icons");

  const summary = notices.slice(
    notices.indexOf("## What this means for you"),
    notices.indexOf("## elkjs"),
  );
  assert.ok(summary, "the reader-facing summary section is missing");

  assert.ok(
    summary.includes(`${total} built-in logos`) || summary.includes(`the ${total} built-in`),
    `summary does not state the vendored total of ${total}`,
  );
  assert.ok(
    summary.includes(`${total - licensedSlugs.length} of the ${total}`),
    `summary should say ${total - licensedSlugs.length} of the ${total} logos are CC0-1.0`,
  );
  for (const slug of licensedSlugs) {
    assert.ok(
      summary.includes(`\`${slug}\``),
      `summary omits \`${slug}\`, which carries its own licence per the generated table`,
    );
  }
});

/**
 * A one-component diagram drawing `logo`, rendered through the public surface
 * the playground and embedders use — the export path the attribution has to
 * survive, not an internal call only the CLI takes.
 */
const renderWithLogo = async (logo: string): Promise<string> => {
  const { svg } = await compile(
    `diagram application "Attribution"\n\napplication A "Alpha" { logo: ${logo} }\n`,
  );
  assert.ok(svg, `compile() rendered no SVG for logo: ${logo}`);
  return svg;
};

/**
 * The attribution comment's lines, trimmed — `[]` when there is no such comment.
 *
 * Tests compare whole lines against `logos.ts` rather than searching the SVG for
 * a URL: a substring test passes on any line merely containing the address, and
 * this keeps the URLs written down in one place — the generated data.
 */
const attributionLines = (svg: string): string[] => {
  const comment = svg.match(/<!--([\s\S]*?)-->/)?.[1];
  if (!comment) return [];
  return comment
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

/** A vendored logo's field, asserted present so a test failure names the gap rather than printing `undefined`. */
const logoField = (slug: string, field: "source" | "licenseUrl" | "copyright"): string => {
  const value = LOGOS[slug]?.[field];
  assert.ok(value, `LOGOS.${slug} has no ${field}`);
  return value;
};

test("a diagram drawing licensed artwork carries its attribution", async () => {
  // `angular` is CC-BY-4.0. A shared SVG is a redistribution of that artwork,
  // and it travels without `licenses/`, so the notice has to be in the file.
  const lines = attributionLines(await renderWithLogo("angular"));
  assert.ok(
    lines.includes(`artwork: ${logoField("angular", "source")}`),
    "no artwork source for angular",
  );
});

test("the attribution links the licence text, which an exported SVG cannot ship", async () => {
  const lines = attributionLines(await renderWithLogo("angular"));
  assert.ok(
    lines.includes(`licence: ${logoField("angular", "licenseUrl")}`),
    "no licence link for angular",
  );
});

test("a rights-holder's own copyright line travels with the mark", async () => {
  // MIT asks for the copyright notice itself, which a link to a licence
  // template does not supply. `javascript` is the one vendored icon that
  // publishes such a line.
  const lines = attributionLines(await renderWithLogo("javascript"));
  assert.ok(
    lines.includes(logoField("javascript", "copyright")),
    "the JavaScript mark lost its copyright line",
  );
});

test("a CC0 mark adds no attribution, because CC0 asks for none", async () => {
  const lines = attributionLines(await renderWithLogo("postgresql"));
  assert.deepEqual(lines, [], "CC0-only diagram carries an attribution block");
});

test("the attribution names only the artwork the diagram actually drew", async () => {
  // The vendored table is not tree-shaken, so an artifact holds all 37 paths.
  // An SVG holds what it painted; naming more would attribute artwork the file
  // does not contain.
  const lines = attributionLines(await renderWithLogo("angular"));
  const named = lines.filter((line) => line.startsWith("Apache Kafka"));
  assert.deepEqual(named, [], "attribution names a mark the diagram never drew");
});

test("every licensed logo can be attributed from the data alone", async () => {
  // `scripts/update-logos.mjs` refuses a licensed icon with no source or public
  // licence URL, but only when someone reruns it — a hand-edit of the generated
  // file would slip past. This is that guard as an assertion.
  const incomplete = Object.entries(LOGOS)
    .filter(([, logo]) => logo.license)
    .filter(([, logo]) => !logo.source || !logo.licenseUrl)
    .map(([slug]) => slug);
  assert.deepEqual(incomplete, [], "licensed logos with nothing to attribute to");
});
