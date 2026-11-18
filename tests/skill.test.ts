/**
 * The agent skill (`skills/cairn/`) restates the DSL for AI agents, so it can
 * drift from the engine without anything else noticing. This suite pins it:
 *
 * - every complete ```cairn example in the skill compiles with no diagnostic
 *   at all (errors *and* warnings) and with zero label overlaps — the bar the
 *   skill tells agents to reach;
 * - the "Kinds per view" table lists exactly the kinds of each view in the
 *   `views` registry, so a kind added or renamed fails here first;
 * - every diagnostic code the skill names is a real one (DIAGNOSTICS.md or
 *   `cairn explain`);
 * - SKILL.md's front matter is valid for the Agent Skills format, and its
 *   `cairn-version` is not newer than package.json.
 *
 * Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../src/api.ts";
import { setElkFactory } from "../src/elk-engine.ts";
import { nodeElkFactory } from "../src/elk-worker.ts";
import { views } from "../src/views.ts";
import { explanations } from "../src/models/ast.ts";

setElkFactory(nodeElkFactory);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(ROOT, "skills", "cairn");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

const files = markdownFiles(SKILL).map((path) => ({
  name: relative(ROOT, path),
  text: readFileSync(path, "utf8").replace(/\r\n/g, "\n"),
}));

/** Fenced blocks tagged `cairn` that are whole diagrams (start with `diagram`). */
const examples = files.flatMap(({ name, text }) =>
  [...text.matchAll(/```cairn\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .filter((source) => /^\s*diagram\s/.test(source))
    .map((source, index) => ({ name: `${name} #${index + 1}`, source })),
);

test("the skill ships an example for every view", () => {
  const shown = new Set(examples.map(({ source }) => /^\s*diagram\s+(\S+)/.exec(source)?.[1]));
  assert.deepEqual([...shown].sort(), Object.keys(views).sort());
});

for (const { name, source } of examples) {
  test(`skill example compiles clean with no overlaps: ${name}`, async () => {
    const result = await compile(source);
    assert.deepEqual(
      result.diagnostics.map((d) => `${d.code} ${d.message}`),
      [],
      "the skill tells agents to fix every warning, so its examples carry none",
    );
    assert.equal(result.metrics?.overlaps, 0);
  });
}

test("the skill's kind table matches the views registry", () => {
  const dsl = files.find(({ name }) => name.endsWith(join("references", "dsl.md")));
  assert.ok(dsl, "references/dsl.md exists");
  const section = dsl.text.split("## Kinds per view")[1]?.split("\n## ")[0] ?? "";
  const listed: Record<string, string[]> = {};
  for (const match of section.matchAll(/^\| `([a-z-]+)` \| ([^|]+) \|$/gm)) {
    listed[match[1]] = match[2].split(",").map((kind) => kind.trim());
  }
  const registry = Object.fromEntries(
    Object.entries(views).map(([name, view]) => [name, [...view.kinds].sort()]),
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(listed).map(([name, kinds]) => [name, kinds.sort()])),
    registry,
  );
});

test("every diagnostic code the skill names exists", () => {
  const catalog = readFileSync(join(ROOT, "documentation", "DIAGNOSTICS.md"), "utf8");
  // A code is real if the catalogue lists it or `cairn explain` knows it.
  const known = new Set<string>(Object.keys(explanations));
  for (const [, first, last] of catalog.matchAll(/\b([EW]\d{4})(?:\s*[–-]\s*([EW]\d{4}))?\b/g)) {
    if (!last) {
      known.add(first);
      continue;
    }
    const prefix = first[0];
    for (let n = Number(first.slice(1)); n <= Number(last.slice(1)); n++) {
      known.add(`${prefix}${String(n).padStart(4, "0")}`);
    }
  }
  const named = new Set(files.flatMap(({ text }) => text.match(/\b[EW]0\d{3}\b/g) ?? []));
  const unknown = [...named].filter((code) => !known.has(code));
  assert.deepEqual(unknown, []);
});

test("SKILL.md front matter is a valid Agent Skill and its version is released", () => {
  const skill = files.find(({ name }) => name.endsWith("SKILL.md"));
  assert.ok(skill, "SKILL.md exists");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill.text)?.[1] ?? "";
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front)?.[1]?.trim();

  const name = field("name");
  assert.equal(name, "cairn", "name matches the skill's directory");
  assert.match(name ?? "", /^[a-z0-9]+(-[a-z0-9]+)*$/);

  const description = field("description") ?? "";
  assert.ok(description.length > 0 && description.length <= 1024, "description is 1–1024 chars");
  assert.ok(!/[<>]/.test(description), "description has no angle brackets");

  assert.ok(skill.text.split("\n").length < 500, "SKILL.md stays under 500 lines");

  // The minimum cairn the skill needs: never ahead of what this tree ships.
  const pinned = /cairn-version:\s*"([^"]+)"/.exec(front)?.[1] ?? "";
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const rank = (v: string) => {
    const [core, pre] = v.split("-");
    const parts = core.split(".").map(Number);
    // A release outranks every prerelease of the same core version.
    const preRank = pre ? Number(/\d+$/.exec(pre)?.[0] ?? 0) : Number.POSITIVE_INFINITY;
    return [...parts, preRank];
  };
  const [a, b] = [rank(pinned), rank(version)];
  const cmp = a.map((n, i) => Math.sign(n - b[i])).find((s) => s !== 0) ?? 0;
  assert.match(pinned, /^\d+\.\d+\.\d+(-[A-Za-z]+\d+)?$/);
  assert.ok(cmp <= 0, `cairn-version ${pinned} is not newer than package.json ${version}`);
});

test("every relative link in the skill resolves inside it", () => {
  for (const { name, text } of files) {
    for (const [, target] of text.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)) {
      const from = dirname(join(ROOT, name));
      assert.doesNotThrow(() => readFileSync(join(from, target)), `${name} → ${target}`);
    }
  }
});
