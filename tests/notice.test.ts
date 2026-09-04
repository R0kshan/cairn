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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { notice, BUN_VERSION, ELKJS_VERSION, SIMPLE_ICONS_VERSION } from "../src/notice.ts";

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
