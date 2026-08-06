/**
 * Documentation integrity gate. Run with `npm run check:docs`.
 *
 * Deterministic, filesystem/source-of-truth checks only — no prose review:
 *
 * - Link integrity — every relative markdown/image link in every tracked
 *   `.md` file must resolve to a file on disk.
 * - Diagnostic parity — every `E0xxx`/`W0xxx` code used in `src/**` must be
 *   covered by `documentation/DIAGNOSTICS.md`'s code table (range- and
 *   slash-aware: `E0210–E0218` and `E0200 / E0201` both count).
 * - File-map parity — every top-level `src/*.ts` file must be named
 *   (literally, or via a `*` glob like `elk-*.ts`) in AGENTS.md or
 *   ARCHITECTURE.md, so the entry-point docs can't silently go stale again.
 * - Command parity — every `npm run <x>` mentioned in the docs must exist in
 *   `package.json`'s `scripts`.
 *
 * This exists because documentation is the only invariant in this repo with
 * no CI gate — see AGENTS.md's "Non-negotiable invariants" for the others.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".crush"]);

let failures = 0;

function fail(message: string): void {
  console.error(`FAIL: ${message}`);
  failures++;
}

function walk(dir: string, matches: (path: string) => boolean, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || (entry.startsWith(".") && entry !== ".agents")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, matches, out);
    else if (matches(full)) out.push(full);
  }
}

const markdownFiles: string[] = [];
walk(ROOT, (p) => extname(p) === ".md", markdownFiles);

const sourceFiles: string[] = [];
walk(join(ROOT, "src"), (p) => extname(p) === ".ts", sourceFiles);

// ---- 1. Link integrity ----

const LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(LINK_RE)) {
      let target = match[1].trim();
      if (/^(https?:|mailto:|tel:)/.test(target)) continue;
      if (target.startsWith("#")) continue; // same-file anchor, not checked
      const hashIndex = target.indexOf("#");
      if (hashIndex !== -1) target = target.slice(0, hashIndex);
      if (target === "") continue;
      const resolved = target.startsWith("/")
        ? join(ROOT, target.slice(1))
        : join(dirname(file), target);
      try {
        statSync(resolved);
      } catch {
        fail(`${relative(ROOT, file)}:${i + 1}: broken link "${target}" → ${relative(ROOT, resolved)}`);
      }
    }
  }
}

// ---- 2. Diagnostic parity ----

const CODE_RE = /\b([EW]0\d{3})\b/g;

const sourceCodes = new Set<string>();
for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/["']([EW]0\d{3})["']/g)) sourceCodes.add(match[1]);
}

const diagnosticsPath = join(ROOT, "documentation/DIAGNOSTICS.md");
const diagnosticsText = readFileSync(diagnosticsPath, "utf8");
const tableSection = diagnosticsText.split("## Code table")[1]?.split("## Exit codes")[0] ?? "";

const documentedCodes = new Set<string>();
// Ranges first: "E0210–E0218" or "E0210-E0218" — same-letter inclusive range.
const RANGE_RE = /([EW])(\d{4})[–-]([EW])?(\d{4})/g;
const withoutRanges = tableSection.replace(RANGE_RE, (_whole, letter1, num1, _letter2, num2) => {
  const start = Number.parseInt(num1, 10);
  const end = Number.parseInt(num2, 10);
  for (let n = start; n <= end; n++) documentedCodes.add(`${letter1}${String(n).padStart(4, "0")}`);
  return "";
});
for (const match of withoutRanges.matchAll(CODE_RE)) documentedCodes.add(match[1]);

const undocumented = [...sourceCodes].filter((c) => !documentedCodes.has(c)).sort();
if (undocumented.length > 0) {
  fail(`diagnostic code(s) used in src/ but missing from documentation/DIAGNOSTICS.md: ${undocumented.join(", ")}`);
}

// ---- 3. File-map parity ----

const agentsText = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
const architectureText = readFileSync(join(ROOT, "ARCHITECTURE.md"), "utf8");
// Strip fenced code blocks first — an unbalanced count of single backticks
// inside a ``` fence would otherwise desync the inline-span pairing below.
const stripFences = (s: string) => s.replace(/```[\s\S]*?```/g, "");
const fileMapText = stripFences(agentsText) + "\n" + stripFences(architectureText);

const backtickSpans = [...fileMapText.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const literalNames = new Set(backtickSpans.filter((s) => /^[\w.-]+\.ts$/.test(s)));
const globPatterns = backtickSpans
  .filter((s) => /^[\w.-]*\*[\w.-]*\.ts$/.test(s))
  .map((s) => new RegExp(`^${s.replace(/[.]/g, "\\.").replace(/\*/g, ".*")}$`));

const topLevelSrcFiles = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts"));

for (const name of topLevelSrcFiles) {
  const covered = literalNames.has(name) || globPatterns.some((re) => re.test(name));
  if (!covered) fail(`src/${name} is not named in AGENTS.md or ARCHITECTURE.md (add it to the file map)`);
}

// ---- 4. Command parity ----

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));

const mentionedCommands = new Set<string>();
for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/npm run ([\w:-]+)/g)) mentionedCommands.add(match[1]);
}

for (const command of mentionedCommands) {
  if (!scripts.has(command)) fail(`docs reference "npm run ${command}" but package.json has no such script`);
}

// ---- Report ----

if (failures > 0) {
  console.error(`\ncheck-docs: ${failures} failure(s).`);
  process.exit(1);
}
console.log("check-docs: OK");
