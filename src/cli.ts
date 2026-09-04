#!/usr/bin/env node

/**
 * CLI entry point and command dispatch. Wires the pipeline together for each
 * verb — `validate`, `build`, `matrix`, `watch`, `new`, `explain` — parses argv
 * (flags + positional file), resolves output paths, prints diagnostics, and sets
 * process exit codes. Also holds the `cairn new` scaffold templates per view.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };
import { parse } from "./parser.ts";
import { validate } from "./validator.ts";
import { renderHuman, renderJson } from "./diagnostics.ts";
import { layout, attachSideDiagnostics } from "./scene-layout.ts";
import type { Scene } from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { buildFlowMatrix, matrixCsv, matrixMd, matrixSvg } from "./flow-matrix.ts";
import { views } from "./views.ts";
import { explanations } from "./models/ast.ts";
import type { Model, Span } from "./models/ast.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import { watchCommand } from "./watch.ts";
import { resolveLogoFiles } from "./logo-files.ts";
import { loadThemeFile } from "./theme-file.ts";
import { registerTheme, themeNames } from "./themes.ts";
import { LOGO_NAMES } from "./logos.ts";
import { notice } from "./notice.ts";

const TYPE_FLAGS: Record<string, string> = {
  "--logical-architecture": "logical",
  "-L": "logical",
  "--application-architecture": "application",
  "-A": "application",
  "--infrastructure-architecture": "infrastructure",
  "-I": "infrastructure",
};

const TEMPLATE_LOGICAL = `diagram logical "Diagram title"

# A logical diagram shows: actors, systems, layers, functional blocks and
# labelled functional flows. No infrastructure (rule of the logical view).

actor-group ACTORS "Role group" {
  actor ACT1 "Main actor"
}

system SYS "Main system" {
  layer L1 "Layer 1" {
    block B1 "Functional block 1"
  }
}

external EXT "External systems" {
  block EXT1 "Partner system"
}

# ---- business objects (optional) ----
business-object BO1 "Business object" "what this object represents"

# ---- flows (every flow MUST be labelled; [BO1] = objects carried) ----
ACT1 -> B1  : "What the actor does"
B1   -> EXT1 : "Data sent" [BO1]

# ---- legend (auto-generated; add free entries here, or "legend: off" in style) ----
# legend {
#   note "Free-text note shown under the legend"
# }

# ---- style (optional — view defaults apply) ----
# style {
#   disposition: wide          # wide | tall | slide | page
#   flow-text: full            # full | numbered (numbered = FLUX table below)
#   legend: auto               # auto | off
#   crossing-hops: on
#   theme: light               # light | dark | slate | sand | contrast | nord | solarized | classic | classic-dark
#   accent: #1f77b4            # optional: retints flows on top of the chosen theme
#   compact: off               # on = denser layout (tighter spacing + wrapped flow labels)
#   font-size: 12.5            # base text size (edge labels = base-1, container titles = base+0.5)
#   arrows: normal             # normal | large (larger arrowheads so endpoints stand out)
#   flow-color: none           # none | by-source (tint each flow + its arrowhead by origin)
#   flow-label: on-line
#   lang: en                   # en | fr (localizes rendered labels; keywords stay English)
# }
`;

const TEMPLATE_APPLICATION = `diagram application "Diagram title"

# An application diagram shows: applications and their modules, data stores,
# message queues/brokers (\`queue\`) and application flows. A (protocol, format)
# tail is recommended on system-to-system flows; labels are optional.

actor-group ACTORS "Role group" {
  actor ACT1 "Main actor"
}

application APP1 "Main application" {
  module M1 "Module 1"
}

queue Q1 "Message broker"

datastore DB1 "Reference database"

external EXT1 "Partner system"

# ---- flows : "label" (protocol, format) — label optional ----
ACT1 -> M1  : "What the actor does"
M1   -> Q1  : "Publish events" (MQ, JSON)
Q1   -> DB1 : "Persist events" (JDBC)
M1   -> EXT1 : "Data sent" (SFTP, XML)
`;

const TEMPLATE_INFRASTRUCTURE = `diagram infrastructure "Diagram title"

# An infrastructure diagram shows: users (\\\`actor\\\` — the consumers, on the entry
# side), sites, network zones (banded in declaration order), servers/VMs and
# deployed applications, and external systems (partners, on the exit side).
# Every flow MUST carry its protocol (and port): \\\`A -> B : "…" (HTTPS/443)\\\`.

# Users of the infrastructure — rendered as people, placed on the entry side.
actor USERS "End users"

site DC1 "Main datacenter" {
  network-zone DMZ "DMZ" {
    server RP1 "Reverse proxy" {
      app-instance FRONT_I "Front web"
    }
  }
  network-zone LAN "Internal zone" {
    gateway AUTH_GW "Auth proxy"
    auth OAUTH2 "OAuth2 proxy"
    idp IDP "LDAP / IdP"
    server APP1 "Application server" {
      app-instance CORE_I "Core application"
    }
    server DB1 "Database server" {
      app-instance DB_I "Database"
    }
    queue BROKER "Message broker"
  }
}

external PARTNER "Partner platform"

# ---- technical flows: protocol REQUIRED (E0240); the label is optional ----
USERS    -> FRONT_I : "Web access" (HTTPS/443)
FRONT_I  -> CORE_I  : "API calls" (HTTPS/8443)
CORE_I   -> AUTH_GW : "Auth check" (HTTPS/8443)
AUTH_GW  -> OAUTH2  : "Authorize request" (HTTPS/8443)
OAUTH2   -> IDP     : "Validate tokens" (LDAPS/636)
CORE_I   -> DB_I    : "Queries" (TCP/5432)
CORE_I   -> BROKER  : "Publish events" (TCP/9092)
CORE_I   -> PARTNER : "Nightly export" (SFTP/22)

# ---- matrice des flux techniques ----
# Export the flow matrix beside the physical diagram (French DA deliverable):
#   cairn matrix this-file.cairn --format csv    # or md | svg
# Add \`style { lang: fr }\` above to get French column headers (N°, Protocole…).
`;

const TEMPLATES: Record<string, string> = {
  logical: TEMPLATE_LOGICAL,
  application: TEMPLATE_APPLICATION,
  infrastructure: TEMPLATE_INFRASTRUCTURE,
};

const args = process.argv.slice(2);
const command = args[0];

/**
 * Injected at compile time for release binaries via `bun build --define`
 * (see scripts/build-binaries.sh), set to the exact tag the release workflow
 * built from — the single source of truth for a released binary's version,
 * since package.json isn't guaranteed to have been bumped before tagging.
 * Under plain `node src/cli.ts` (dev, npm install) this identifier was never
 * defined by any bundler, so `typeof` — safe on an undeclared identifier —
 * falls through to package.json.
 */
declare const CAIRN_BUILD_VERSION: string | undefined;
const version = typeof CAIRN_BUILD_VERSION !== "undefined" ? CAIRN_BUILD_VERSION : pkg.version;

const VALUE_FLAGS = new Set(["-o", "--format", "--theme"]);
const positionalFile = (): string | undefined => {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-") || arg === command) continue;
    return arg;
  }
  return undefined;
};

function usage(): never {
  console.log(`cairn — architecture diagrams as code

Usage:
  cairn new (--logical-architecture|-L|-A|-I) <file.cairn>      scaffold a typed template
                                                      (-L logical, -A application,
                                                       -I infrastructure)
  cairn validate <file.cairn> [--format json] [--strict]
  cairn build <file.cairn> [-o output.svg] [--theme <name|file.json>]
  cairn matrix <file.cairn> [--format csv|md|svg] [-o out] [--theme <name|file.json>]
                                                      matrice des flux techniques
                                                      (default csv; honors style { lang })
  cairn watch <file.cairn> [-o output.svg] [--theme <name|file.json>]
                                                      rebuild on save; SVG stays fresh
                                                      (error panel on failure) for an
                                                      editor auto-refresh preview
  cairn explain <code>                                rule rationale (e.g. E0203)
  cairn logos                                         list the built-in \`logo:\` names
  cairn themes                                        list the built-in theme names
  cairn licenses                                      third-party notices this build carries
  cairn version | --version | -v                      print the installed version
`);
  process.exit(2);
}

function loadAndCheck(file: string): {
  src: string;
  model: Model;
  diagnostics: Diagnostic[];
} {
  if (!existsSync(file)) {
    console.error(`error: file not found \`${file}\``);
    process.exit(2);
  }
  const src = readFileSync(file, "utf8");
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  return { src, model, diagnostics: diags };
}

function resolveOutputPath(file: string, suffix: string): string {
  const optionIndex = args.indexOf("-o");
  if (optionIndex < 0) return file.replace(/\.cairn$/, "") + suffix;
  const out = args[optionIndex + 1];
  if (!out || out.startsWith("-")) usage();
  return out;
}

const PRINT_FRAMES: Record<string, { width: number; height: number; name: string }> = {
  slide: { width: 1280, height: 720, name: "16:9 slide" },
  page: { width: 700, height: 1000, name: "A4 page" },
};

/**
 * Describes how well `scene` fits the given disposition's print frame, warning
 * (W0520) when labels would render smaller than 7px. Returns the `, fits …`
 * suffix for the build success log, or "" when the disposition isn't framed.
 */
function densityReport(
  disposition: string,
  scene: Scene,
  typeSpan: Span,
): { fitInfo: string; diagnostic?: Diagnostic } {
  const frame = PRINT_FRAMES[disposition];
  if (!frame) return { fitInfo: "" };
  const scale = Math.min(frame.width / scene.width, frame.height / scene.height);
  const effectiveFont = 10.5 * scale;
  const fitInfo = `, fits ${frame.name} at ${(scale * 100).toFixed(0)}% (labels ≈ ${effectiveFont.toFixed(1)}px)`;
  if (effectiveFont >= 7) return { fitInfo };
  return {
    fitInfo,
    diagnostic: {
      code: "W0520",
      severity: "warning",
      message: `too dense for a readable single ${frame.name} — labels would render at ~${effectiveFont.toFixed(1)}px`,
      span: typeSpan,
      note: `${scene.nodes.filter((node) => !node.container).length} elements / ${scene.edges.length} flows exceed what one ${frame.name} can show readably`,
      help: "split the view into sub-diagrams (e.g. one per system), or keep `wide`/`tall` for full-screen and print use",
    },
  };
}

/**
 * Resolves `--theme <name|path>` once, for every verb that renders.
 *
 * A value ending in `.json` is a file; anything else is a built-in name. The
 * file is registered under its basename so the renderer, which resolves themes
 * by name, can find it — and the name is what callers then put in
 * `model.style.theme`.
 *
 * Applied after parsing, never before: the parser validates `theme:` against a
 * closed set, so a custom name written in the DSL would be rejected. The flag
 * overrides whatever the diagram declared, which is the point of having it.
 */
function themeFromArgs(): string | undefined {
  const index = args.indexOf("--theme");
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    console.error("error: `--theme` needs a theme name or a path to a .json theme file");
    process.exit(2);
  }
  if (!value.toLowerCase().endsWith(".json")) {
    if (!themeNames.includes(value)) {
      console.error(
        `error: unknown theme \`${value}\`\n  available: ${themeNames.join(", ")}\n` +
          "  or pass a path to a .json theme file",
      );
      process.exit(2);
    }
    return value;
  }
  try {
    const { name, spec } = loadThemeFile(value);
    registerTheme(name, spec);
    return name;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

function exitIfErrors(file: string, src: string, diagnostics: Diagnostic[]): void {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    console.error(renderHuman(file, src, diagnostics, process.stderr.isTTY ?? false));
    process.exit(1);
  }
}

if (command === "version" || command === "--version" || command === "-v") {
  console.log(`cairn v${version}`);
} else if (command === "validate") {
  const file = positionalFile();
  if (!file) usage();
  const json = args.includes("--format") && args[args.indexOf("--format") + 1] === "json";
  const strict = args.includes("--strict");
  const { src, diagnostics } = loadAndCheck(file);
  if (json) console.log(renderJson(file, diagnostics));
  else if (diagnostics.length)
    console.log(renderHuman(file, src, diagnostics, process.stdout.isTTY ?? false));
  else console.log(`\u2713 ${file}: no issues found`);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);
} else if (command === "build") {
  const file = positionalFile();
  if (!file) usage();
  const themeOverride = themeFromArgs();
  const outFile = resolveOutputPath(file, ".svg");
  const { src, model, diagnostics } = loadAndCheck(file);
  exitIfErrors(file, src, diagnostics);
  if (themeOverride) model.style.theme = themeOverride;
  const view = views[model.type!];
  layout(model, view)
    .then((scene) => {
      const { logos, diagnostics: logoDiagnostics } = resolveLogoFiles(model, file);
      diagnostics.push(...logoDiagnostics);
      const { svg, overlapsBefore, overlapsAfter } = render(model, view, scene, { logos });
      writeFileSync(outFile, svg);
      const { fitInfo, diagnostic } = densityReport(
        model.style.disposition,
        scene,
        model.typeSpan ?? { line: 1, col: 1, len: 7 },
      );
      if (diagnostic) diagnostics.push(diagnostic);
      diagnostics.push(...attachSideDiagnostics(scene, model));
      const warnings = diagnostics.filter((d) => d.severity === "warning");
      if (warnings.length)
        console.error(renderHuman(file, src, warnings, process.stderr.isTTY ?? false));
      console.log(
        `\u2713 ${outFile} (${scene.width}\u00d7${scene.height}${fitInfo}, layout ${scene.layoutMs} ms, label overlaps: ${overlapsAfter}${overlapsBefore !== overlapsAfter ? ` (resolved: ${overlapsBefore - overlapsAfter})` : ""})`,
      );
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("layout error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
} else if (command === "matrix") {
  const file = positionalFile();
  if (!file) usage();
  const themeOverride = themeFromArgs();
  const formatIndex = args.indexOf("--format");
  const format = formatIndex >= 0 ? args[formatIndex + 1] : "csv";
  if (!["csv", "md", "svg"].includes(format)) {
    console.error(`error: unknown --format \`${format}\` (csv | md | svg)`);
    process.exit(2);
  }
  const { src, model, diagnostics } = loadAndCheck(file);
  exitIfErrors(file, src, diagnostics);
  if (!model.flows.length) {
    console.error(`error: \`${file}\` declares no flows — nothing to tabulate`);
    process.exit(1);
  }
  if (themeOverride) model.style.theme = themeOverride;
  const ext = format === "svg" ? "svg" : format === "md" ? "md" : "csv";
  const outFile = resolveOutputPath(file, ".flow." + ext);
  const lang = model.style.lang;
  const matrix = buildFlowMatrix(model, views[model.type!]);
  const content =
    format === "svg" ? matrixSvg(matrix) : format === "md" ? matrixMd(matrix) : matrixCsv(matrix);
  writeFileSync(outFile, content);
  console.log(
    `\u2713 ${outFile} (matrice des flux — ${model.flows.length} flows, ${format}, lang: ${lang})`,
  );
} else if (command === "watch") {
  const file = positionalFile();
  if (!file) usage();
  watchCommand(file, resolveOutputPath(file, ".svg"), themeFromArgs());
} else if (command === "new") {
  const type = args.map((arg) => TYPE_FLAGS[arg]).find(Boolean);
  const file = positionalFile();
  if (!type || !file) usage();
  if (!views[type]) {
    console.error(`error: unknown view \`${type}\` (available: ${Object.keys(views).join(", ")})`);
    process.exit(2);
  }
  // Create exclusively rather than checking-then-writing: the `wx` flag is
  // O_CREAT|O_EXCL, so "does it exist?" and "create it" are one atomic syscall.
  // A separate existsSync() left a TOCTOU window in which the path could be
  // swapped between check and write — e.g. for a symlink pointing at a file the
  // scaffold would then clobber (js/file-system-race, CWE-367).
  try {
    writeFileSync(file, TEMPLATES[type], { flag: "wx" });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`error: \`${file}\` already exists`);
      process.exit(2);
    }
    console.error(
      `error: cannot create \`${file}\`: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  console.log(
    `\u2713 ${file} created (${type} view) — fill in the sections, then run \`cairn validate ${file}\``,
  );
} else if (command === "logos") {
  // Printed in columns because the list is browsed, not parsed — a caller that
  // wants the names one per line can still pipe this through `tr`.
  const width = LOGO_NAMES.reduce((widest, name) => Math.max(widest, name.length), 0) + 2;
  const perLine = Math.max(1, Math.floor(78 / width));
  console.log(`${LOGO_NAMES.length} built-in logos — use as \`logo: <name>\` on an element:\n`);
  for (let index = 0; index < LOGO_NAMES.length; index += perLine)
    console.log(
      "  " +
        LOGO_NAMES.slice(index, index + perLine)
          .map((n) => n.padEnd(width))
          .join("")
          .trimEnd(),
    );
  console.log('\nAnything else: point at a file — `logo: "./logos/name.svg"`.');
} else if (command === "licenses") {
  // A compiled binary has nowhere to put a notice a user can read: there is no
  // tarball to browse and no banner comment survives `bun build --compile
  // --minify`. So the notice is source, embedded like any other string, and
  // this is where it surfaces. `src/notice.ts` tailors it to what the running
  // artifact actually contains — the binaries also embed the Bun runtime, the
  // npm bundles do not.
  console.log(notice());
} else if (command === "themes") {
  // The counterpart of `cairn logos`: you cannot pass `--theme` sensibly
  // without knowing what the names are, and they live in source, not in a doc
  // that can fall behind.
  console.log(
    `${themeNames.length} built-in themes — \`--theme <name>\`, or \`style { theme: … }\`:\n`,
  );
  for (const name of themeNames) console.log(`  ${name}`);
  console.log(
    "\nFor your own colours, pass a JSON file instead — `--theme ./my-theme.json`.\n" +
      "It extends a built-in and overrides only what it names:\n" +
      '\n  { "extends": "dark", "pal": { "bg": "#0d1117" } }\n',
  );
} else if (command === "explain") {
  const code = args[1];
  if (!code) usage();
  const explanation = explanations[code.toUpperCase()];
  if (explanation) console.log(`${code.toUpperCase()} — ${explanation}`);
  else {
    console.error(`unknown code \`${code}\` (codes: ${Object.keys(explanations).join(", ")})`);
    process.exit(2);
  }
} else usage();
