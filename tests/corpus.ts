// Shared corpus tooling for the full-corpus regression gate.
//
// Every buildable example is reduced to a one-line "digest" that splits its
// rendered output into three independent fingerprints:
//
//   geom  — the shape: all coordinates, sizes, path data, structure
//   color — the palette: every fill / stroke / stop-color value
//   text  — the words: the content of every <text> element
//
// plus scalars (node/edge/overlap counts, dimensions). The whole corpus lives
// in ONE committed file (tests/__snapshots__/corpus.digest), so a change shows
// up as a small, readable diff instead of dozens of regenerated SVGs — and,
// crucially, `snapshots:report` can tell you WHICH fingerprint moved:
//
//   • only `color` changed  → almost always an intended theme/palette edit
//   • `geom` changed        → a layout shift — the dangerous kind, review it
//   • only `text` changed   → a label / i18n edit
//
// That geom-vs-color split is the whole point: it makes "is this my feature or a
// regression?" answerable at a glance.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parse.ts';
import { validate } from '../src/validate.ts';
import { layout } from '../src/layout.ts';
import { render } from '../src/render.ts';
import { views } from '../src/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const EXAMPLES_DIR = join(ROOT, 'examples');
export const DIGEST_PATH = join(HERE, '__snapshots__', 'corpus.digest');

// Every example we can build (each subdir + the top level), minus the
// deliberately-broken fixtures. Sorted for a stable digest order.
export function corpusFiles(): string[] {
  const dirs = [EXAMPLES_DIR, join(EXAMPLES_DIR, 'dispositions'), join(EXAMPLES_DIR, 'themes')];
  const out: string[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (f.endsWith('.cairn') && !f.includes('broken')) out.push(join(d, f));
    }
  }
  return out.sort((a, b) => relName(a).localeCompare(relName(b)));
}

// Path relative to examples/ (e.g. "themes/nord.cairn") — the digest key.
export const relName = (file: string): string =>
  file.slice(EXAMPLES_DIR.length + 1);

const h = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

// Round every decimal to 1dp — absorbs the one cross-platform wobble
// (Math.hypot in numbered-flow label placement) so the digest is stable across
// OSes / Node versions. Integers (the bulk of the output) are untouched.
export const normalize = (svg: string): string =>
  svg.replace(/-?\d+\.\d+/g, (m) => (Math.round(parseFloat(m) * 10) / 10).toString());

// geom fingerprint: the normalized SVG with colour values and text content
// blanked out — i.e. everything positional/structural, nothing else.
const geomHash = (svg: string): string =>
  h(normalize(svg)
    .replace(/(fill|stroke|stop-color|color)="[^"]*"/g, '$1=""')
    .replace(/>[^<]*</g, '><'));

// colour fingerprint: the sorted set of every colour value emitted.
const colorHash = (svg: string): string => {
  const colors = [...svg.matchAll(/(?:fill|stroke|stop-color|color)="([^"]*)"/g)].map((m) => m[1]);
  return h(colors.sort().join('\n'));
};

// text fingerprint: the content of every <text> element, in document order.
const textHash = (svg: string): string => {
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  return h(texts.join(''));
};

export interface Digest {
  name: string; geom: string; color: string; text: string;
  n: number; e: number; ov: number; dim: string;
  svg: string; // kept in-memory for the fidelity (README-SVG) check; not serialized
}

export async function digestOf(file: string): Promise<Digest> {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  const errors = diags.filter((d) => d.severity === 'error');
  if (errors.length || !model.type || !views[model.type]) {
    throw new Error(`${relName(file)}: build error(s) [${errors.map((d) => d.code).join(', ')}]`);
  }
  const view = views[model.type];
  const scene = await layout(model, view);
  const { svg, overlapsAfter } = render(model, view, scene);
  return {
    name: relName(file), geom: geomHash(svg), color: colorHash(svg), text: textHash(svg),
    n: scene.nodes.length, e: scene.edges.length, ov: overlapsAfter,
    dim: `${scene.width}x${scene.height}`, svg,
  };
}

export async function computeCorpus(): Promise<Digest[]> {
  return Promise.all(corpusFiles().map(digestOf));
}

// One line per example. Human-skimmable, greppable, and a small git diff.
const line = (d: Digest): string =>
  `${d.name}  dim:${d.dim} n:${d.n} e:${d.e} ov:${d.ov}  geom:${d.geom} color:${d.color} text:${d.text}`;

export const serialize = (ds: Digest[]): string =>
  ds.map(line).sort().join('\n') + '\n';

// ---- change categorization (used by the test message and snapshots:report) ----

export interface Row { dim: string; n: string; e: string; ov: string; geom: string; color: string; text: string; }

export function parseDigest(text: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const l of text.split('\n')) {
    const m = l.match(/^(.+?) {2}dim:(\S+) n:(\S+) e:(\S+) ov:(\S+) {2}geom:(\S+) color:(\S+) text:(\S+)$/);
    if (m) rows.set(m[1], { dim: m[2], n: m[3], e: m[4], ov: m[5], geom: m[6], color: m[7], text: m[8] });
  }
  return rows;
}

const rowOf = (d: Digest): Row =>
  ({ dim: d.dim, n: String(d.n), e: String(d.e), ov: String(d.ov), geom: d.geom, color: d.color, text: d.text });

export interface Categorized {
  geometry: string[]; colour: string[]; text: string[]; scalars: string[];
  added: string[]; removed: string[]; unchanged: number; changed: number;
}

// Compare freshly-computed digests against the committed digest and bucket every
// change by WHAT moved. Geometry is called out first: it's the risky kind.
export function categorize(committed: Map<string, Row>, current: Digest[]): Categorized {
  const c: Categorized = { geometry: [], colour: [], text: [], scalars: [], added: [], removed: [], unchanged: 0, changed: 0 };
  const seen = new Set<string>();
  for (const d of current) {
    seen.add(d.name);
    const was = committed.get(d.name);
    const now = rowOf(d);
    if (!was) { c.added.push(d.name); c.changed++; continue; }
    const kinds: string[] = [];
    if (was.geom !== now.geom) { c.geometry.push(d.name); kinds.push('geom'); }
    if (was.color !== now.color) { c.colour.push(d.name); kinds.push('color'); }
    if (was.text !== now.text) { c.text.push(d.name); kinds.push('text'); }
    if (was.dim !== now.dim || was.n !== now.n || was.e !== now.e || was.ov !== now.ov) {
      c.scalars.push(d.name); kinds.push('scalar');
    }
    if (kinds.length) c.changed++; else c.unchanged++;
  }
  for (const name of committed.keys()) if (!seen.has(name)) { c.removed.push(name); c.changed++; }
  return c;
}

// Pretty, grouped report — shared by the failing test and snapshots:report.
export function formatReport(cat: Categorized): string {
  if (cat.changed === 0) return `✓ corpus unchanged (${cat.unchanged} examples)`;
  const L: string[] = [];
  const group = (label: string, names: string[]) => {
    if (names.length) L.push(`  ${label} (${names.length}): ${names.join(', ')}`);
  };
  L.push(`${cat.changed} example(s) changed, ${cat.unchanged} unchanged:`);
  group('⚠ GEOMETRY moved  — layout shift, review these', cat.geometry);
  group('· colour only     — usually an intended theme edit', cat.colour);
  group('· text only       — label / i18n edit', cat.text);
  group('· counts/size      — nodes/edges/overlaps/dim', cat.scalars);
  group('+ new example', cat.added);
  group('- removed example', cat.removed);
  return L.join('\n');
}
