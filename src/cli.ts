#!/usr/bin/env node
// cairn — diagram-as-code CLI (phase 1)
// Commands: validate | build | new | explain

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from './parse.ts';
import { validate } from './validate.ts';
import { renderHuman, renderJson } from './diag.ts';
import { layout } from './layout.ts';
import { render } from './render.ts';
import { matrixCsv, matrixMd, matrixSvg } from './matrix.ts';
import { views, explanations, type Diagnostic } from './model.ts';
import { watchCommand } from './watch.ts';

const TYPE_FLAGS: Record<string, string> = {
  '--logical-architecture': 'logical', '-L': 'logical',
  '--application-architecture': 'application', '-A': 'application',
  '--infrastructure-architecture': 'infrastructure', '-I': 'infrastructure',
  '--security-architecture': 'security', '-S': 'security',
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
USERS   -> FRONT_I : "Web access" (HTTPS/443)
FRONT_I -> CORE_I : "API calls" (HTTPS/8443)
CORE_I  -> DB_I   : "Queries" (TCP/5432)
CORE_I  -> BROKER : "Publish events" (TCP/9092)
CORE_I  -> PARTNER : "Nightly export" (SFTP/22)

# ---- matrice des flux techniques ----
# Export the flow matrix beside the physical diagram (French DA deliverable):
#   cairn matrix this-file.cairn --format csv    # or md | svg
# Add \`style { lang: fr }\` above to get French column headers (N°, Protocole…).
`;

const TEMPLATE_SECURITY = `diagram security "Diagram title"

# A security diagram shows trust zones (each with a sensitivity level), the
# filtering/security nodes between them, and the sensitive assets they protect.
# Zones band left→right in declaration order (most exposed → most protected).
# Levels, least→most trusted: public | internal | restricted | secret.

trust-zone INTERNET "Internet" (public) {
  security-node WAF "WAF / reverse proxy"
}

trust-zone LAN "Internal zone" (internal) {
  asset APP "Business application"
}

trust-zone DATA "Data zone" (restricted) {
  asset DB "Customer database"
}

external USERS "End users"

# ---- security flows (cross-zone flows should be filtered + encrypted) ----
USERS -> WAF : "HTTPS access" (TLS1.3)
WAF   -> APP : "Filtered traffic" (mTLS)
APP   -> DB  : "Read/write" (TLS1.3)

# W0560 warns on any flow entering a more-trusted zone without a security-node.
`;

const TEMPLATES: Record<string, string> = {
  logical: TEMPLATE_LOGICAL, application: TEMPLATE_APPLICATION,
  infrastructure: TEMPLATE_INFRASTRUCTURE, security: TEMPLATE_SECURITY,
};

const args = process.argv.slice(2);
const cmd = args[0];

function usage(): never {
  console.log(`cairn — architecture diagrams as code

Usage:
  cairn new (--logical-architecture|-L|-A|-I|-S) <file.cairn>   scaffold a typed template
                                                      (-L logical, -A application,
                                                       -I infrastructure, -S security)
  cairn validate <file.cairn> [--format json] [--strict]
  cairn build <file.cairn> [-o output.svg]
  cairn matrix <file.cairn> [--format csv|md|svg] [-o out]   matrice des flux techniques
                                                      (default csv; honors style { lang })
  cairn watch <file.cairn> [-o output.svg]             rebuild on save; SVG stays fresh
                                                      (error panel on failure) for an
                                                      editor auto-refresh preview
  cairn explain <code>                                rule rationale (e.g. E0203)
`);
  process.exit(2);
}

function loadAndCheck(file: string): { src: string; model: any; diags: Diagnostic[] } {
  if (!existsSync(file)) { console.error(`error: file not found \`${file}\``); process.exit(2); }
  const src = readFileSync(file, 'utf8');
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  return { src, model, diags };
}

if (cmd === 'validate') {
  const file = args.find(a => !a.startsWith('-') && a !== 'validate');
  if (!file) usage();
  const json = args.includes('--format') && args[args.indexOf('--format') + 1] === 'json';
  const strict = args.includes('--strict');
  const { src, diags } = loadAndCheck(file);
  if (json) console.log(renderJson(file, diags));
  else if (diags.length) console.log(renderHuman(file, src, diags, process.stdout.isTTY ?? false));
  else console.log(`✓ ${file}: no issues found`);
  const errors = diags.filter(d => d.severity === 'error').length;
  const warnings = diags.filter(d => d.severity === 'warning').length;
  process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);

} else if (cmd === 'build') {
  const file = args.find(a => !a.startsWith('-') && a !== 'build');
  if (!file) usage();
  const oIdx = args.indexOf('-o');
  const outFile = oIdx >= 0 ? args[oIdx + 1] : file.replace(/\.cairn$/, '') + '.svg';
  const { src, model, diags } = loadAndCheck(file);
  const errors = diags.filter(d => d.severity === 'error');
  if (errors.length) {
    console.error(renderHuman(file, src, diags, process.stderr.isTTY ?? false));
    process.exit(1);
  }
  const view = views[model.type];
  layout(model, view).then(scene => {
    const { svg, overlapsBefore, overlapsAfter } = render(model, view, scene);
    writeFileSync(outFile, svg);
    const warn = diags.filter(d => d.severity === 'warning');
    if (warn.length) console.error(renderHuman(file, src, warn, process.stderr.isTTY ?? false));
    const disp = model.style.disposition;
    const frames: Record<string, { w: number; h: number; name: string }> = {
      slide: { w: 1280, h: 720, name: '16:9 slide' },
      page: { w: 700, h: 1000, name: 'A4 page' },
    };
    let fitInfo = '';
    if (frames[disp]) {
      const f = frames[disp];
      const scale = Math.min(f.w / scene.width, f.h / scene.height);
      const effFont = 10.5 * scale;
      fitInfo = `, fits ${f.name} at ${(scale * 100).toFixed(0)}% (labels ≈ ${effFont.toFixed(1)}px)`;
      if (effFont < 7) {
        console.error(`warning[W0520]: too dense for a readable single ${f.name} — labels would render at ~${effFont.toFixed(1)}px`);
        console.error(`  = note: ${scene.nodes.filter(n => !n.container).length} elements / ${scene.edges.length} flows exceed what one ${f.name} can show readably`);
        console.error(`help: split the view into sub-diagrams (e.g. one per system), or keep \`wide\`/\`tall\` for full-screen and print use`);
      }
    }
    console.log(`✓ ${outFile} (${scene.width}×${scene.height}${fitInfo}, layout ${scene.layoutMs} ms, label overlaps: ${overlapsAfter}${overlapsBefore !== overlapsAfter ? ` (resolved: ${overlapsBefore - overlapsAfter})` : ''})`);
    process.exit(0);
  }).catch(e => { console.error('layout error:', e.message); process.exit(1); });

} else if (cmd === 'matrix') {
  const file = args.find(a => !a.startsWith('-') && a !== 'matrix');
  if (!file) usage();
  const fIdx = args.indexOf('--format');
  const format = fIdx >= 0 ? args[fIdx + 1] : 'csv';
  if (!['csv', 'md', 'svg'].includes(format)) {
    console.error(`error: unknown --format \`${format}\` (csv | md | svg)`); process.exit(2);
  }
  const { src, model, diags } = loadAndCheck(file);
  const errors = diags.filter(d => d.severity === 'error');
  if (errors.length) {
    console.error(renderHuman(file, src, diags, process.stderr.isTTY ?? false));
    process.exit(1);
  }
  const view = views[model.type];
  if (!model.flows.length) { console.error(`error: \`${file}\` declares no flows — nothing to tabulate`); process.exit(1); }
  const ext = format === 'svg' ? 'svg' : format === 'md' ? 'md' : 'csv';
  const oIdx = args.indexOf('-o');
  const outFile = oIdx >= 0 ? args[oIdx + 1] : file.replace(/\.cairn$/, '') + '.flow.' + ext;
  const lang = model.style.lang;
  const content = format === 'svg' ? matrixSvg(model, view, lang)
    : format === 'md' ? matrixMd(model, view, lang)
    : matrixCsv(model, lang);
  writeFileSync(outFile, content);
  console.log(`✓ ${outFile} (matrice des flux — ${model.flows.length} flows, ${format}, lang: ${lang})`);

} else if (cmd === 'watch') {
  const file = args.find(a => !a.startsWith('-') && a !== 'watch');
  if (!file) usage();
  const oIdx = args.indexOf('-o');
  const outFile = oIdx >= 0 ? args[oIdx + 1] : file.replace(/\.cairn$/, '') + '.svg';
  watchCommand(file, outFile);

} else if (cmd === 'new') {
  const type = args.map(a => TYPE_FLAGS[a]).find(Boolean);
  const file = args.find(a => !a.startsWith('-') && a !== 'new');
  if (!type || !file) usage();
  if (!views[type]) {
    console.error(`error: unknown view \`${type}\` (available: ${Object.keys(views).join(', ')})`);
    process.exit(2);
  }
  if (existsSync(file)) { console.error(`error: \`${file}\` already exists`); process.exit(2); }
  writeFileSync(file, TEMPLATES[type]);
  console.log(`✓ ${file} created (${type} view) — fill in the sections, then run \`cairn validate ${file}\``);

} else if (cmd === 'explain') {
  const code = args[1];
  if (!code) usage();
  const ex = explanations[code.toUpperCase()];
  if (ex) console.log(`${code.toUpperCase()} — ${ex}`);
  else { console.error(`unknown code \`${code}\` (codes: ${Object.keys(explanations).join(', ')})`); process.exit(2); }

} else usage();
