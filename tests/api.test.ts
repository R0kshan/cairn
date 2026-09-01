/**
 * Public API suite: `compile()` and the flow-matrix formatters as an embedder
 * calls them. The other suites drive the stages directly, so nothing else here
 * covers the one-call surface `dist/cairn.mjs` publishes.
 * Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, matrixCsv, matrixSvg, resolveThemeSpec, ThemeSpecError } from "../src/api.ts";
import { themeNames } from "../src/themes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EX = join(ROOT, "examples");
const load = (f: string) => readFileSync(join(EX, f), "utf8").replace(/\r\n/g, "\n");

test("compile() leaves the matrix out unless it is asked for", async () => {
  const result = await compile(load("infrastructure.cairn"));
  assert.equal(result.matrix, null);
});

test("compile({ matrix: true }) tabulates every flow", async () => {
  const result = await compile(load("infrastructure.cairn"), { matrix: true });
  // infrastructure.cairn declares 13 flows; the matrix is one row per flow.
  assert.equal(result.matrix?.rows.length, 13);
});

test("the API and the CLI produce the same matrix bytes", async () => {
  // The committed companion is written by `cairn matrix` (scripts/render-examples.mjs).
  // If the two paths ever diverge, an embedder's table stops matching the dossier.
  const result = await compile(load("infrastructure.cairn"), { matrix: true });
  assert.equal(matrixCsv(result.matrix!), load("infrastructure.flow.csv"));
});

test("the matrix locale follows the diagram's style { lang }", async () => {
  const result = await compile(load("infrastructure-fr.cairn"), { matrix: true });
  assert.equal(result.matrix?.lang, "fr");
});

test("a source with errors returns no matrix rather than throwing", async () => {
  const result = await compile(load("broken.cairn"), { matrix: true });
  assert.equal(result.matrix, null);
});

test("a valid diagram with no flows returns an empty matrix, not an error", async () => {
  const result = await compile('diagram logical "t"\nsystem S "s" { block B "b" }\n', {
    matrix: true,
  });
  assert.deepEqual(result.matrix?.rows, []);
});

test("compile() still returns the svg when the matrix is requested", async () => {
  const result = await compile(load("infrastructure.cairn"), { matrix: true });
  assert.ok(result.svg?.startsWith("<svg"));
});

// ---------- custom themes through the public API (issue #21) ----------

const THEMED = 'diagram application "t"\napplication A "App" { module M "M" }\n';
const background = (svg: string | null) => svg?.match(/<rect[^>]*fill="([^"]+)"/)?.[1];

test("compile() takes a palette of its own, not just a built-in name", async () => {
  // The CLI reads a theme file; an embedder has no file and no CLI, so the
  // object has to be a first-class input or the npm package cannot be themed
  // at all beyond the seven built-ins.
  const named = await compile(THEMED, { theme: "nord" });
  const custom = await compile(THEMED, { theme: { extends: "dark", pal: { bg: "#123456" } } });

  assert.equal(background(custom.svg), "#123456", "the spec's background is painted");
  assert.notEqual(background(named.svg), background(custom.svg));
  assert.equal(custom.diagnostics.filter((d) => d.severity === "error").length, 0);
});

test("a spec passed to compile() is used and forgotten", async () => {
  // The whole reason compile() takes an object rather than asking callers to
  // register a name: an embedder renders for many callers in one process. A
  // theme that outlived its call would leak into the next one and let two
  // callers collide on a name.
  const before = [...themeNames];
  const plain = background((await compile(THEMED)).svg);

  await compile(THEMED, { theme: { extends: "dark", pal: { bg: "#abcdef" } } });

  assert.deepEqual(themeNames, before, "no theme is registered as a side effect");
  assert.equal(background((await compile(THEMED)).svg), plain, "the next call is unaffected");
});

test("a spec inherits every colour it does not name, and declares its own darkness", async () => {
  // `extends` is what makes a two-key theme viable, and `dark` cannot be
  // inferred from the colours — it selects the flow palette.
  const inherited = await compile(THEMED, { theme: { extends: "solarized" } });
  const builtin = await compile(THEMED, { theme: "solarized" });
  assert.equal(inherited.svg, builtin.svg, "an override-nothing spec matches its base exactly");

  const flows =
    'diagram application "t"\nstyle { flow-color: by-source }\n' +
    'application A "A" { module M "M" }\ndatastore DB "DB"\nM -> DB (SQL)\n';
  const strokes = (svg: string | null) =>
    new Set([...(svg ?? "").matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => m[1]));
  assert.notDeepEqual(
    strokes((await compile(flows, { theme: { extends: "light" } })).svg),
    strokes((await compile(flows, { theme: { extends: "light", dark: true } })).svg),
    "`dark: true` must change the flow colours",
  );
});

test("compile() rejects a malformed palette instead of falling back", async () => {
  // Silently rendering the default would look like success for something the
  // caller asked for explicitly.
  await assert.rejects(
    () => compile(THEMED, { theme: { pal: { bg: "not a colour" } } }),
    (error: unknown) =>
      error instanceof ThemeSpecError && /`pal\.bg`/.test((error as Error).message),
  );
  await assert.rejects(() => compile(THEMED, { theme: { extends: "ghost" } }), ThemeSpecError);
  assert.throws(() => resolveThemeSpec({ dark: "yes" }), ThemeSpecError);
  assert.throws(() => resolveThemeSpec("light"), ThemeSpecError);
});

test("the matrix is themed by the same value as the diagram beside it", async () => {
  // A diagram and its flow matrix are two halves of one deliverable; a caller
  // who themes one and gets the other in default light has been given a broken
  // pair. The matrix resolves colours by theme *name*, and a spec is
  // deliberately never registered under one, so it has to be passed through.
  const src =
    'diagram application "t"\napplication A "App" { module M "M" }\ndatastore DB "DB"\nM -> DB (SQL)\n';
  const theme = { extends: "dark", dark: true, pal: { bg: "#123456" } };

  const custom = await compile(src, { theme, matrix: true });
  assert.equal(background(custom.svg), "#123456", "the diagram uses the spec");
  assert.equal(
    background(matrixSvg(custom.matrix!, { theme })),
    "#123456",
    "and so does its matrix",
  );

  // A built-in name works the same way, whether it reaches the matrix through
  // the diagram's own style or through the option.
  const named = await compile(src, { theme: "nord", matrix: true });
  assert.equal(background(matrixSvg(named.matrix!)), background(named.svg));
  assert.equal(background(matrixSvg(named.matrix!, { theme: "nord" })), background(named.svg));
});

test("every built-in themes the matrix, not just light and dark", async () => {
  // Colours used to be looked up in a map holding only `light` and `dark`, so
  // `nord`, `slate`, `sand` and `solarized` matrices all came out light while
  // their diagrams rendered correctly. The invariant is that a matrix matches
  // the diagram it belongs to — not that it differs from light, since
  // `contrast` is a light theme and shares its white canvas.
  const src = 'diagram application "t"\napplication A "App"\ndatastore DB "DB"\nA -> DB (SQL)\n';
  for (const theme of ["light", "nord", "slate", "sand", "contrast", "solarized"]) {
    const result = await compile(src, { theme, matrix: true });
    assert.equal(
      background(matrixSvg(result.matrix!)),
      background(result.svg),
      `\`${theme}\`'s matrix must match its diagram`,
    );
  }

  // And at least one must actually be non-light, or the loop above would pass
  // just as well with every theme silently falling back.
  const nord = await compile(src, { theme: "nord", matrix: true });
  const light = await compile(src, { matrix: true });
  assert.notEqual(background(matrixSvg(nord.matrix!)), background(matrixSvg(light.matrix!)));
});
