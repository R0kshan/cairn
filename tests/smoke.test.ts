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
// Normalize to LF: tests inject style via `.replace('"\n', …)`, which a CRLF
// checkout (Windows) would silently defeat. Keeps the suite line-ending-agnostic.
const load = (f: string) => readFileSync(join(EX, f), 'utf8').replace(/\r\n/g, '\n');
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

// Reading-order invariant: actors LEFT for wide/slide, TOP for tall/page.
// This is enforced by locking layout direction per disposition (src/layout.ts),
// so it must hold for every disposition — not just land there by fitness luck.
const actorSide = (scene: { nodes: { kind: string; x: number; y: number; w: number; h: number }[] }) => {
  const actors = scene.nodes.filter(n => n.kind === 'actor-group' || n.kind === 'actor');
  const others = scene.nodes.filter(n => n.kind !== 'actor-group' && n.kind !== 'actor');
  const acx = (Math.min(...actors.map(a => a.x)) + Math.max(...actors.map(a => a.x + a.w))) / 2;
  const acy = (Math.min(...actors.map(a => a.y)) + Math.max(...actors.map(a => a.y + a.h))) / 2;
  const ocx = others.reduce((s, n) => s + n.x + n.w / 2, 0) / others.length;
  const ocy = others.reduce((s, n) => s + n.y + n.h / 2, 0) / others.length;
  return { left: acx < ocx, top: acy < ocy };
};

test('actors are LEFT for wide/slide and TOP for tall/page (all sizes)', async () => {
  for (const f of ['small.cairn', 'medium.cairn', 'large.cairn', 'application-large.cairn']) {
    const base = load(f);
    for (const disp of ['wide', 'slide'] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(actorSide(scene).left, `${f} ${disp}: actors must be on the LEFT`);
    }
    for (const disp of ['tall', 'page'] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(actorSide(scene).top, `${f} ${disp}: actors must be on TOP`);
    }
  }
});

// Same reading-order invariant for actor-less views (infrastructure, security):
// user-facing sources sit on the entry side, downstream partners on the exit
// side. In infra, users are `actor` elements; in security they are untrusted
// `external`s. Guards the "Internet visitors on the left" fix.
const nodeSide = (scene: { nodes: { id: string; kind: string; x: number; y: number; w: number; h: number }[] }, id: string) => {
  const n = scene.nodes.find(m => m.id === id)!;
  const others = scene.nodes.filter(m => m.kind !== 'external' && m.kind !== 'actor');
  const ocx = others.reduce((s, m) => s + m.x + m.w / 2, 0) / others.length;
  const ocy = others.reduce((s, m) => s + m.y + m.h / 2, 0) / others.length;
  return { left: n.x + n.w / 2 < ocx, top: n.y + n.h / 2 < ocy };
};

test('user-facing sources sit on the entry side in infra/security views', async () => {
  const cases: [string, string, string][] = [
    ['infrastructure.cairn', 'USERS', 'EDI'],       // actor users vs egress partner
    ['security.cairn', 'USERS', 'PARTNER'],         // untrusted end users vs partner
  ];
  for (const [f, ingress, egress] of cases) {
    const base = load(f);
    for (const disp of ['wide', 'slide'] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(nodeSide(scene, ingress).left, `${f} ${disp}: ${ingress} (users) must be LEFT`);
      assert.ok(!nodeSide(scene, egress).left, `${f} ${disp}: ${egress} (partner) must be RIGHT`);
    }
    for (const disp of ['tall', 'page'] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(nodeSide(scene, ingress).top, `${f} ${disp}: ${ingress} (users) must be TOP`);
      assert.ok(!nodeSide(scene, egress).top, `${f} ${disp}: ${egress} (partner) must be BOTTOM`);
    }
  }
});

test('infrastructure models users as actor (person glyph + legend key), distinct from external systems', async () => {
  const { model, svg } = await build(load('infrastructure-small.cairn'));
  const visitors = model.index.get('VISITORS')!;
  assert.equal(visitors.kind, 'actor', 'the user is an actor, not an external');
  // person glyph is rendered (head circle r=7), and the legend keys it
  assert.match(svg, /<circle cx="[\d.]+" cy="[\d.]+" r="7"/);
  assert.match(svg, />User \/ consumer</);
  // `actor` is accepted by the infrastructure view (no E0201)
  const { codes } = check(load('infrastructure-small.cairn'));
  assert.ok(!codes.includes('E0201'));
});

test('compact style yields a smaller canvas with zero overlaps', async () => {
  for (const f of ['small.cairn', 'medium.cairn', 'application.cairn', 'infrastructure.cairn']) {
    const base = load(f);
    const normal = await build(base);
    const compact = await build(base.replace('"\n', '"\nstyle { compact: on }\n'));
    const aN = normal.scene.width * normal.scene.height;
    const aC = compact.scene.width * compact.scene.height;
    assert.ok(aC < aN, `${f}: compact (${compact.scene.width}x${compact.scene.height}) must be smaller than normal (${normal.scene.width}x${normal.scene.height})`);
    assert.equal(compact.overlapsAfter, 0, `${f}: compact must keep zero label overlaps`);
  }
  // compact is off by default
  const { model } = await build(load('small.cairn'));
  assert.equal(model.style.compact, false);
});

test('font-size scales the text and is measured into the layout', async () => {
  const base = 'diagram logical "t"\nSTYLE\nactor-group G "g" { actor A "a" }\nsystem S "s" { block B "Node label" }\nA -> B : "flow"\n';
  const def = await build(base.replace('STYLE\n', ''));
  assert.equal(def.model.style.font.size, 12.5, 'default base font is 12.5');
  assert.match(def.svg, /font-size="12.5"[^>]*>Node label/);
  const big = await build(base.replace('STYLE', 'style { font-size: 18 }'));
  assert.match(big.svg, /font-size="18"[^>]*>Node label/);
  assert.ok(big.scene.width >= def.scene.width, 'larger font is measured into node width');
  assert.equal(big.overlapsAfter, 0);
  const small = await build(base.replace('STYLE', 'style { font-size: 9 }'));
  assert.match(small.svg, /font-size="9"[^>]*>Node label/);
});

test('flow readability: endpoint number, larger arrows, color-by-source', async () => {
  const base = 'diagram logical "t"\nSTYLE\nactor-group G "g" { actor A "a" }\nsystem S "s" { block B "b" block C "c" }\nA -> B : "one"\nB -> C : "two"\n';
  // default: single arrowhead marker, width 7
  const def = await build(base.replace('STYLE\n', ''));
  assert.match(def.svg, /markerWidth="7"/);
  assert.equal((def.svg.match(/<marker /g) ?? []).length, 1);
  // B — arrows: large gives a bigger marker
  const large = await build(base.replace('STYLE', 'style { arrows: large }'));
  assert.match(large.svg, /markerWidth="11"/);
  // C — by-source: one marker per source color + colored strokes + legend hint
  const col = await build(base.replace('STYLE', 'style { flow-color: by-source }'));
  assert.ok((col.svg.match(/<marker /g) ?? []).length >= 2, 'a marker per source color');
  assert.match(col.svg, /stroke="#1f77b4"/);           // first source hue
  assert.match(col.svg, /colour = source/);            // legend hint
  assert.equal(col.overlapsAfter, 0);
  // A — numbered badge pinned near the target; must still be overlap-free
  const num = await build(base.replace('STYLE', 'style { flow-text: numbered }'));
  assert.equal(num.overlapsAfter, 0);
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
