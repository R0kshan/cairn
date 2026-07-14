// Smoke suite: freezes the behaviors the project's non-negotiables depend on.
// Run: npm test  (node --experimental-strip-types --test tests/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parse.ts';
import { validate } from '../src/validate.ts';
import { layout } from '../src/layout.ts';
import { render } from '../src/render.ts';
import { matrixCsv, matrixMd, matrixSvg } from '../src/matrix.ts';
import { views } from '../src/model.ts';

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const load = (f: string) => readFileSync(join(EX, f), 'utf8');
const check = (src: string) => {
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  return { model, diags, codes: diags.map(d => d.code) };
};
const build = async (src: string) => {
  const { model, diags } = check(src);
  assert.equal(diags.filter(d => d.severity === 'error').length, 0, 'build precondition: no errors');
  const view = views[model.type!];
  const scene = await layout(model, view);
  return { model, view, scene, ...render(model, view, scene) };
};

// ---------- diagnostics ----------

test('broken.cairn raises exactly the seeded diagnostic codes', () => {
  const { codes } = check(load('broken.cairn'));
  for (const c of ['E0210', 'E0202', 'E0201', 'E0203', 'E0220']) assert.ok(codes.includes(c), c);
  assert.equal(codes.filter(c => c === 'W0510').length, 2);
});

test('unknown kind suggests the nearest valid kind', () => {
  const { diags } = check('diagram logical "t"\nsytem S "x"\n');
  const d = diags.find(d => d.code === 'E0201')!;
  assert.match(d.help ?? '', /system/);
});

test('infrastructure requires protocol (E0240), application recommends it (W0540, actors exempt)', () => {
  const infra = check('diagram infrastructure "t"\nsite S "s" {\n network-zone Z "z" {\n server V "v" { app-instance A "a" }\n server V2 "v2" { app-instance B "b" }\n }\n}\nA -> B : "x"\n');
  assert.ok(infra.codes.includes('E0240'));

  const app = check('diagram application "t"\nactor-group G "g" { actor U "u" }\napplication P "p" { module M "m" }\ndatastore D "d"\nU -> M : "human"\nM -> D : "sys"\n');
  assert.equal(app.diags.filter(d => d.code === 'W0540').length, 1); // only the system flow
});

test('business objects: unknown ref E0221, unused W0530', () => {
  const { codes } = check('diagram logical "t"\nactor-group G "g" { actor U "u" }\nsystem S "s" { layer L "l" { block B "b" } }\nbusiness-object BO_X "X" "d"\nU -> B : "x" [BO_MISSING]\n');
  assert.ok(codes.includes('E0221'));
  assert.ok(codes.includes('W0530'));
});

// ---------- the non-negotiables (§1.1) ----------

for (const f of ['small.cairn', 'medium.cairn', 'large.cairn', 'application-large.cairn', 'infrastructure-large.cairn']) {
  test(`${f}: zero label overlaps after post-pass`, async () => {
    const { overlapsAfter } = await build(load(f));
    assert.equal(overlapsAfter, 0);
  });
}

test('every flow keeps a distinct edge (never merged)', async () => {
  const { model, scene } = await build(load('medium.cairn'));
  const sceneEdgeIds = new Set(scene.edges.map(e => e.id));
  for (const f of model.flows) assert.ok(sceneEdgeIds.has(f.id), f.id);
});

// ---------- dispositions ----------

test('slide is always landscape, page always portrait (medium)', async () => {
  const base = load('medium.cairn');
  const slide = await build(base.replace('"\n', '"\nstyle { disposition: slide }\n'));
  assert.ok(slide.scene.width >= slide.scene.height);
  const page = await build(base.replace('"\n', '"\nstyle { disposition: page }\n'));
  assert.ok(page.scene.height >= page.scene.width);
});

// ---------- bands & rendering ----------

test('legend + registry bands render, and legend: off removes the legend only', async () => {
  const on = await build(load('small.cairn'));
  assert.match(on.svg, /LEGEND/);
  assert.match(on.svg, /BUSINESS OBJECTS/);
  const off = await build(load('small.cairn').replace('"\n', '"\nstyle { legend: off }\n'));
  assert.doesNotMatch(off.svg, /LEGEND/);
  assert.match(off.svg, /BUSINESS OBJECTS/);
});

test('flow-text: numbered produces badges + FLUX band', async () => {
  const { svg } = await build(load('large-numbered.cairn'));
  assert.match(svg, />FLOWS</);
});

test('technical tail renders under the label', async () => {
  const { svg } = await build(load('infrastructure-small.cairn'));
  assert.match(svg, /\(HTTPS\/443\)/);
});

test('datastore renders as a cylinder (ellipse cap)', async () => {
  const { svg } = await build(load('application-small.cairn'));
  assert.match(svg, /<ellipse/);
});

test('multi-line container labels are fully rendered', async () => {
  const { svg } = await build(load('infrastructure-large.cairn'));
  assert.match(svg, />front</);  // second line of "K8s cluster\nfront"
  assert.match(svg, />business</);  // second line of "K8s cluster\nbusiness"
});

// ---------- theming & colors ----------

const THEME_BASE =
  'diagram logical "t"\nSTYLE\nactor-group G "g" { actor A "a" }\n' +
  'system S "s" { layer L "l" { block B "b" } }\nA -> B : "x"\n';

test('dark theme paints a dark background + light chrome; light stays white', async () => {
  const dark = await build(THEME_BASE.replace('STYLE', 'style { theme: dark }'));
  assert.match(dark.svg, /<rect width="\d+" height="\d+" fill="#1e2227"\/>/); // dark canvas
  assert.match(dark.svg, /#c2ccd6/);                                          // light band text
  const light = await build(THEME_BASE.replace('STYLE\n', ''));
  assert.match(light.svg, /<rect width="\d+" height="\d+" fill="white"\/>/);
  assert.doesNotMatch(light.svg, /#1e2227/);
});

test('background: overrides the theme default canvas color', async () => {
  const { svg } = await build(THEME_BASE.replace('STYLE', 'style {\n theme: dark\n background: #0d1117\n}'));
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#0d1117"\/>/);
});

test('per-element and per-kind colors apply (fill, stroke, text)', async () => {
  const inline = 'diagram logical "t"\nactor-group G "g" { actor A "a" }\n' +
    'system S "s" { layer L "l" { block B "b" { style { fill: #cc2222  stroke: #ff0000  text: #ffffff } } } }\nA -> B : "x"\n';
  const s1 = await build(inline);
  assert.match(s1.svg, /fill="#cc2222"/);   // per-element fill
  assert.match(s1.svg, /stroke="#ff0000"/); // per-element stroke (same line)
  const perKind = 'diagram logical "t"\nstyle { text block: #eeff00 }\nactor-group G "g" { actor A "a" }\n' +
    'system S "s" { block B "b" }\nA -> B : "x"\n';
  const s2 = await build(perKind);
  assert.match(s2.svg, /fill="#eeff00"/);   // per-kind text color
});

test('dark theme keeps zero label overlaps (small)', async () => {
  const { overlapsAfter } = await build(load('small.cairn').replace('"\n', '"\nstyle { theme: dark }\n'));
  assert.equal(overlapsAfter, 0);
});

// ---------- i18n (output localization, keywords stay English) ----------

test('lang: fr localizes band titles, legend and kind names', async () => {
  const fr = await build(load('infrastructure-small.cairn').replace('"\n', '"\nstyle { lang: fr }\n'));
  assert.match(fr.svg, />LÉGENDE</);
  assert.match(fr.svg, /Zone réseau/);
  assert.doesNotMatch(fr.svg, />LEGEND</);
});

test('lang: en (default) is unchanged — English chrome', async () => {
  const en = await build(load('infrastructure-small.cairn'));
  assert.match(en.svg, />LEGEND</);
  assert.doesNotMatch(en.svg, />LÉGENDE</);
});

// ---------- matrice des flux techniques ----------

test('matrix CSV: header, one row per flow, protocol/port split, zone annotation', () => {
  const { model } = check(load('infrastructure.cairn'));
  const csv = matrixCsv(model, 'en');
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, model.flows.length + 1);            // header + one row per flow
  assert.match(lines[0], /^No\.,Source,Destination,Protocol,Port,Flow$/);
  assert.doesNotMatch(lines[0], /Business objects/);            // no business-object column
  assert.ok(lines.some(l => /,HTTPS,443,/.test(l)));             // (HTTPS/443) split into two columns
  assert.ok(lines.some(l => /\(DMZ\)/.test(l)));                 // endpoint annotated with its zone
});

// ---------- security view ----------

test('security.cairn: valid reference builds clean with zero overlaps', async () => {
  const { diags, codes } = check(load('security.cairn'));
  assert.equal(diags.filter(d => d.severity === 'error').length, 0);
  assert.ok(!codes.includes('W0560'), 'reference has no unfiltered crossings');
  assert.ok(!codes.includes('W0561'), 'reference states encryption on cross-zone flows');
  const { overlapsAfter } = await build(load('security.cairn'));
  assert.equal(overlapsAfter, 0);
});

test('security: W0560 fires on an unfiltered trust-boundary crossing', () => {
  const src = 'diagram security "t"\n' +
    'trust-zone Z0 "Edge" (public) { asset A "a" }\n' +
    'trust-zone Z1 "Core" (restricted) { asset B "b" }\n' +
    'A -> B : "direct" (TLS1.3)\n';
  const { codes } = check(src);
  assert.ok(codes.includes('W0560'), 'A(public) -> B(restricted) without a security-node');
});

test('security: routing through a security-node clears W0560', () => {
  const src = 'diagram security "t"\n' +
    'trust-zone Z0 "Edge" (public) { security-node FW "fw" }\n' +
    'trust-zone Z1 "Core" (restricted) { asset B "b" }\n' +
    'FW -> B : "filtered" (TLS1.3)\n';
  const { codes } = check(src);
  assert.ok(!codes.includes('W0560'));
});

test('security: E0250 on a trust-zone without a valid sensitivity level', () => {
  const missing = check('diagram security "t"\ntrust-zone Z "z" { asset A "a" }\n');
  assert.ok(missing.codes.includes('E0250'));
  const bad = check('diagram security "t"\ntrust-zone Z "z" (topsecret) { asset A "a" }\n');
  const d = bad.diags.find(d => d.code === 'E0250')!;
  assert.match(d.note ?? '', /public, internal, restricted, secret/);
});

test('security: trust zones are colored by sensitivity level + tag rendered', async () => {
  const { svg } = await build(load('security.cairn'));
  assert.match(svg, /fill="#fdecea"/); // public level fill
  assert.match(svg, /fill="#e8f1f8"/); // restricted level fill
  assert.match(svg, />PUBLIC</);
  assert.match(svg, />RESTRICTED</);
});

test('matrix respects lang: fr headers; md + svg render', () => {
  const { model, view } = (() => { const { model } = check(load('infrastructure.cairn')); return { model, view: views[model.type!] }; })();
  assert.match(matrixCsv(model, 'fr').split('\n')[0], /^N°,Source,Destination,Protocole,Port,Nature du flux$/);
  assert.match(matrixMd(model, view, 'fr'), /MATRICE DES FLUX TECHNIQUES/);
  const svg = matrixSvg(model, view, 'en');
  assert.match(svg, /^<svg/);
  assert.match(svg, /TECHNICAL FLOW MATRIX/);
});
