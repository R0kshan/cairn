/**
 * Behavior suite: direct, deep assertions on parsing, validation, layout, rendering,
 * matrix export, i18n, theming, and CLI behavior — including exact SVG geometry,
 * diagnostic codes and determinism.
 * Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout, attachSideDiagnostics, beatsRelayout } from "../src/scene-layout.ts";
import { isLongDetour } from "../src/geometry.ts";
import { render } from "../src/svg-render.ts";
import { buildFlowMatrix, matrixCsv, matrixMd, matrixSvg } from "../src/flow-matrix.ts";
import { views } from "../src/views.ts";
import { compile } from "../src/compile.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EX = join(ROOT, "examples");
// Read a `.cairn` example and normalize to LF — keeps the suite line-ending-agnostic on Windows.
const load = (f: string) => readFileSync(join(EX, f), "utf8").replace(/\r\n/g, "\n");
// Parse and validate `src`, returning the model, diagnostics, and diagnostic codes.
const check = (src: string) => {
  const { model, diags } = parse(src);
  diags.push(...validate(model));
  return { model, diags, codes: diags.map((d) => d.code) };
};
// Build `src` through the full pipeline: parse → validate → layout → render. Asserts zero errors as a precondition.
const build = async (src: string) => {
  const { model, diags } = check(src);
  assert.equal(
    diags.filter((d) => d.severity === "error").length,
    0,
    "build precondition: no errors",
  );
  const view = views[model.type!];
  const scene = await layout(model, view);
  return { model, view, scene, ...render(model, view, scene) };
};

// ---------- logos ----------

const LOGO_SRC =
  'diagram application "t"\napplication APP "App" { logo: spring\n  module M "Public API" { logo: react }\n}\ndatastore DB "Store" { logo: postgresql }\nqueue Q "Events" { logo: apachekafka }\nM -> DB (SQL, JSON)\nM -> Q (MQ, JSON)\n';

test("a built-in `logo:` renders in the node's own stroke colour, never a brand hue", async () => {
  // simple-icons paths carry no fill of their own, which is why they can be
  // vendored at all: the renderer paints them with the node's resolved stroke,
  // so a logo can never introduce a colour the active theme did not choose.
  // Guards against a future icon smuggling in a hardcoded fill.
  const { svg } = await build(LOGO_SRC);
  for (const title of ["Spring", "React", "PostgreSQL", "Apache Kafka"])
    assert.match(svg, new RegExp(`<title>${title}</title>`), `${title} must render`);
  const logoFills = [...svg.matchAll(/<g transform="translate[^"]+" fill="([^"]+)">/g)].map(
    (m) => m[1],
  );
  assert.equal(logoFills.length, 4, "one group per logo");
  // Every logo colour must already be in use as a stroke somewhere in the
  // document — that is what "painted with the node's own stroke" means, and it
  // holds whatever theme is active.
  const strokes = new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => m[1]));
  for (const fill of logoFills)
    assert.ok(strokes.has(fill), `logo fill ${fill} must be a stroke colour, not a brand hue`);
});

test("a logo box sits inside the node it marks, on every shape", async () => {
  // The corner mark is placed from the node's own geometry, and the datastore
  // and queue shapes have curved caps that a naive top-right inset would sit
  // on top of. Assert containment rather than eyeballing a render.
  const { svg, scene } = await build(LOGO_SRC);
  const placements = [
    ...svg.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"/g),
  ];
  assert.equal(placements.length, 4, "every logo is placed");
  for (const [, xs, ys, ss] of placements) {
    const x = Number(xs),
      y = Number(ys),
      side = 24 * Number(ss);
    const host = scene.nodes.find(
      (n) => x >= n.x && y >= n.y && x + side <= n.x + n.width && y + side <= n.y + n.height,
    );
    assert.ok(host, `logo at ${x},${y} must be fully inside some node`);
    // A datastore is a cylinder, not a rectangle: it spans its full width only
    // between the caps, so its bounding box is not its paint. Checking the box
    // alone let a mark overflow the bottom arc by a pixel.
    if (host.kind === "datastore") {
      const ry = 7;
      assert.ok(
        y >= host.y + ry && y + side <= host.y + host.height - ry,
        `datastore logo must stay between the caps (${y}..${y + side} vs ${host.y + ry}..${host.y + host.height - ry})`,
      );
    }
  }
});

test("a logo reserves width, so a long label never runs under it", async () => {
  // The layout adds LOGO_GUTTER for an element that carries one; without it a
  // label wide enough to fill the box would slide beneath the mark.
  const withLogo = await build(
    'diagram application "t"\napplication APP "App" {\n  module M "A fairly long module name" { logo: react }\n  module N "Other" }\nM -> N (API_REST, JSON)\n'.replace(
      'module N "Other" }',
      'module N "Other"\n}',
    ),
  );
  const withoutLogo = await build(
    'diagram application "t"\napplication APP "App" {\n  module M "A fairly long module name"\n  module N "Other"\n}\nM -> N (API_REST, JSON)\n',
  );
  const width = (r: Awaited<ReturnType<typeof build>>) =>
    r.scene.nodes.find((n) => n.id === "M")!.width;
  assert.ok(
    width(withLogo) >= width(withoutLogo) + 26,
    `logo node must reserve the gutter (${width(withLogo)} vs ${width(withoutLogo)})`,
  );
});

test("`logo:` refuses a URL — a diagram must not fetch to render", async () => {
  // The whole point of inlining: a linked logo leaks the reader's IP, can be
  // swapped after the fact, and breaks offline. Rejected in the validator so
  // the playground reports it too, not only the CLI.
  const { codes } = check(
    'diagram application "t"\napplication APP "App" { module M "API" { logo: "https://cdn.example.com/a.svg" } }\n',
  );
  assert.ok(codes.includes("E0105"), `expected E0105, got ${codes.join(", ")}`);
  const protocolRelative = check(
    'diagram application "t"\napplication APP "App" { module M "API" { logo: "//cdn.example.com/a.svg" } }\n',
  );
  assert.ok(protocolRelative.codes.includes("E0105"), "protocol-relative is a URL too");
});

test("an unknown built-in logo suggests the nearest name", async () => {
  const { diags, codes } = check(
    'diagram application "t"\napplication APP "App" { module M "API" { logo: postgres } }\n',
  );
  assert.ok(codes.includes("E0107"), `expected E0107, got ${codes.join(", ")}`);
  assert.match(diags.find((d) => d.code === "E0107")!.help ?? "", /postgresql/);
});

test("only kinds that run software carry a logo", async () => {
  // An actor is a person and a system is a grouping; neither has a tech stack.
  const { codes } = check(
    'diagram application "t"\nactor-group G "G" { actor U "User" { logo: react } }\n',
  );
  assert.ok(codes.includes("E0108"), `expected E0108, got ${codes.join(", ")}`);
});

test("a file logo renders nothing until someone resolves it, keeping the core filesystem-free", async () => {
  // `render()` must never read from disk — the playground has no filesystem.
  // An unresolved file logo degrades to no mark rather than to a broken link.
  const src =
    'diagram application "t"\napplication APP "App" { module M "API" { logo: "./logos/acme.svg" } module N "B" }\nM -> N (API_REST, JSON)\n';
  const { svg } = await build(src);
  assert.doesNotMatch(svg, /<image/, "nothing is emitted without a resolver");

  const { model, view } = await build(src);
  const scene = await layout(model, view);
  const resolved = render(model, view, scene, {
    logos: new Map([["M", "data:image/svg+xml;base64,PHN2Zy8+"]]),
  });
  assert.ok(
    resolved.svg.includes('href="data:image/svg+xml;base64,PHN2Zy8+"'),
    "a resolved file logo is inlined as a data URI",
  );
});

test("`compile()` renders the same logos the CLI does", async () => {
  // INVARIANTS §15's parity rule: an embedder and `cairn build` must not
  // disagree about the same source. Built-ins need nothing; a file logo needs
  // the caller to pass what it resolved, so `CompileOptions` has to carry it.
  const src =
    'diagram application "t"\napplication APP "App" { module M "API" { logo: react } module N "B" { logo: "./a.svg" } }\nM -> N (API_REST, JSON)\n';
  const plain = await compile(src);
  assert.match(plain.svg ?? "", /<title>React<\/title>/, "a built-in needs no help");
  assert.doesNotMatch(plain.svg ?? "", /<image/, "an unresolved file logo draws nothing");

  const resolved = await compile(src, {
    logos: new Map([["N", "data:image/svg+xml;base64,PHN2Zy8+"]]),
  });
  assert.ok(
    (resolved.svg ?? "").includes('href="data:image/svg+xml;base64,PHN2Zy8+"'),
    "a resolved file logo reaches the embedder's SVG",
  );
});

// ---------- diagnostics ----------

test("broken.cairn raises exactly the seeded diagnostic codes", () => {
  const { codes } = check(load("broken.cairn"));
  for (const c of ["E0210", "E0202", "E0201", "E0203", "E0220"]) assert.ok(codes.includes(c), c);
  assert.equal(codes.filter((c) => c === "W0510").length, 2);
});

test("a missing flow target names the arrow the author actually wrote", () => {
  const dashed = check('diagram logical "t"\nsystem S "s"\nS -->\n');
  assert.match(dashed.diags.find((d) => d.severity === "error")!.message, /after `-->`/);
  const dotted = check('diagram logical "t"\nsystem S "s"\nS ..>\n');
  assert.match(dotted.diags.find((d) => d.severity === "error")!.message, /after `\.\.>`/);
});

test("unknown kind suggests the nearest valid kind", () => {
  const { diags } = check('diagram logical "t"\nsytem S "x"\n');
  const d = diags.find((d) => d.code === "E0201")!;
  assert.match(d.help ?? "", /system/);
});

test("infrastructure requires protocol (E0240), application recommends it (W0540, actors exempt)", () => {
  const infra = check(
    'diagram infrastructure "t"\nsite S "s" {\n network-zone Z "z" {\n server V "v" { app-instance A "a" }\n server V2 "v2" { app-instance B "b" }\n }\n}\nA -> B : "x"\n',
  );
  assert.ok(infra.codes.includes("E0240"));

  const app = check(
    'diagram application "t"\nactor-group G "g" { actor U "u" }\napplication P "p" { module M "m" }\ndatastore D "d"\nU -> M : "human"\nM -> D : "sys"\n',
  );
  assert.equal(app.diags.filter((d) => d.code === "W0540").length, 1); // only the system flow
});

test("business objects: unknown ref E0221, unused W0530", () => {
  const { codes } = check(
    'diagram logical "t"\nactor-group G "g" { actor U "u" }\nsystem S "s" { layer L "l" { block B "b" } }\nbusiness-object BO_X "X" "d"\nU -> B : "x" [BO_MISSING]\n',
  );
  assert.ok(codes.includes("E0221"));
  assert.ok(codes.includes("W0530"));
});

// ---------- the non-negotiables (§1.1) ----------

for (const f of [
  "small.cairn",
  "medium.cairn",
  "large.cairn",
  "application-large.cairn",
  "infrastructure-large.cairn",
]) {
  test(`${f}: zero label overlaps after post-pass`, async () => {
    const { overlapsAfter } = await build(load(f));
    assert.equal(overlapsAfter, 0);
  });
}

test("every flow keeps a distinct edge (never merged)", async () => {
  const { model, scene } = await build(load("medium.cairn"));
  const sceneEdgeIds = new Set(scene.edges.map((e) => e.id));
  for (const f of model.flows) assert.ok(sceneEdgeIds.has(f.id), f.id);
});

// Segments of a scene, split by orientation — shared by the routing invariants.
const segmentsOf = (scene: { edges: { id: string; pts: { x: number; y: number }[] }[] }) => {
  const vertical: { id: string; x: number; lo: number; hi: number }[] = [];
  const horizontal: { id: string; y: number; lo: number; hi: number }[] = [];
  for (const e of scene.edges)
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i],
        b = e.pts[i + 1];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5)
        vertical.push({ id: e.id, x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5)
        horizontal.push({ id: e.id, y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  return { vertical, horizontal };
};
const edgesCross = (
  scene: { edges: { id: string; pts: { x: number; y: number }[] }[] },
  idA: string,
  idB: string,
) => {
  const { vertical, horizontal } = segmentsOf(scene);
  for (const [first, second] of [
    [idA, idB],
    [idB, idA],
  ])
    for (const v of vertical.filter((s) => s.id === first))
      for (const h of horizontal.filter((s) => s.id === second))
        if (h.lo + 1 < v.x && v.x < h.hi - 1 && v.lo + 1 < h.y && h.y < v.hi - 1) return true;
  return false;
};

// src/edge-tidy.ts. Two rules that hold whoever routed the flow:
//   * every segment is orthogonal — elk emits the odd 10px-across/1px-down
//     segment, which draws as a slanted hair;
//   * two flows on the same side of a node never share a point, and stand
//     MIN_ATTACH_GAP apart wherever the side is long enough to allow it.
test("flows are orthogonal and never share an attachment point", async () => {
  const MIN_ATTACH_GAP = 12;
  const MIN_SIDE_INSET = 3;
  for (const file of [
    "small.cairn",
    "medium.cairn",
    "logical-archi.cairn",
    "large.cairn",
    "application.cairn",
    "infrastructure.cairn",
  ]) {
    const { scene } = await build(load(file));
    for (const e of scene.edges)
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i],
          b = e.pts[i + 1];
        assert.ok(
          Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5,
          `${file} ${e.id}: segment (${a.x},${a.y})→(${b.x},${b.y}) is not orthogonal`,
        );
      }

    const leaves = scene.nodes.filter((n) => !n.container);
    const seats = new Map<string, { along: number; id: string }[]>();
    for (const e of scene.edges) {
      if (!e.pts.length) continue;
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
        for (const n of leaves) {
          const withinX = p.x > n.x - 2 && p.x < n.x + n.width + 2;
          const withinY = p.y > n.y - 2 && p.y < n.y + n.height + 2;
          let side: string | null = null;
          if (withinX && Math.abs(p.y - n.y) < 2) side = "north";
          else if (withinX && Math.abs(p.y - (n.y + n.height)) < 2) side = "south";
          else if (withinY && Math.abs(p.x - n.x) < 2) side = "west";
          else if (withinY && Math.abs(p.x - (n.x + n.width)) < 2) side = "east";
          if (!side) continue;
          const vertical = side === "east" || side === "west";
          const key = `${n.id}|${side}|${vertical ? n.height : n.width}`;
          seats.set(key, [...(seats.get(key) ?? []), { along: vertical ? p.y : p.x, id: e.id }]);
          break;
        }
      }
    }
    for (const [key, members] of seats) {
      if (members.length < 2) continue;
      const sideLength = Number(key.slice(key.lastIndexOf("|") + 1));
      // Two coupled limits. A side can only offer so much room once it gives
      // up its corner margin — and because flows are kept straight, a flow
      // running between two sides is bound by the tighter of them, so the
      // spacing a side achieves is not decided by that side alone. What must
      // hold everywhere is that no two flows share a point or touch.
      const achievable = (sideLength - 2 * MIN_SIDE_INSET) / (members.length - 1);
      const required = Math.min(MIN_ATTACH_GAP, achievable);
      const sorted = [...members].sort((a, b) => a.along - b.along);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].along - sorted[i - 1].along;
        assert.ok(
          gap >= 6,
          `${file} ${key}: ${sorted[i - 1].id} and ${sorted[i].id} sit ${gap.toFixed(1)}px apart — flows must never share or graze an attachment point`,
        );
        assert.ok(
          gap >= required * 0.8,
          `${file} ${key}: ${sorted[i - 1].id} and ${sorted[i].id} sit ${gap.toFixed(1)}px apart, well under the ${required.toFixed(1)}px this side allows`,
        );
      }
    }
  }
});

// Issue #26, channel ordering: two flows sharing a node side must not cross
// each other. Slot order makes their channel spans nest and lane order gives
// the enclosing span the deeper lane — a nested pair has a crossing-free
// arrangement, so any crossing here is a routing bug, not geometry.
test("flows sharing a node side do not cross each other (logical-archi)", async () => {
  const { model, scene, overlapsAfter } = await build(load("logical-archi.cairn"));
  assert.equal(overlapsAfter, 0);
  const siblings = model.flows.filter((f) => f.from === "COLLECT" && f.to === "SUIV_FLUX");
  assert.equal(siblings.length, 2, "fixture must keep two COLLECT→SUIV_FLUX flows");
  assert.ok(
    !edgesCross(scene, siblings[0].id, siblings[1].id),
    `${siblings[0].id} and ${siblings[1].id} share both endpoints and must nest, not cross`,
  );
  // A channel lane hugs the node content, so it stays inside (below) an elk
  // wrap-around route that loops over the top of the drawing.
  const channel = model.flows.find((f) => f.from === "COORD" && f.to === "OPE")!;
  const wrap = model.flows.find((f) => f.from === "COM_CTR" && f.to === "OBS")!;
  const { horizontal } = segmentsOf(scene);
  const laneY = Math.min(...horizontal.filter((s) => s.id === channel.id).map((s) => s.y));
  const wrapY = Math.min(...horizontal.filter((s) => s.id === wrap.id).map((s) => s.y));
  assert.ok(laneY > wrapY, `COORD→OPE lane (${laneY}) must run below the elk wrap (${wrapY})`);
  assert.ok(!edgesCross(scene, channel.id, wrap.id), "COORD→OPE must not cross COM_CTR→OBS");
});

// Compaction (src/compact.ts): a band crossed by nothing but vertical segments
// is dead height. elk sizes the drawing for routes it planned, so rerouting or
// its own spare corridors leave such bands behind in every disposition.
test("no dead horizontal band survives in any disposition", async () => {
  for (const file of ["small.cairn", "medium.cairn", "logical-archi.cairn", "large.cairn"])
    for (const disp of ["wide", "slide", "page"] as const) {
      const base = load(file);
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      const pinned: [number, number][] = scene.nodes.map((n) => [n.y, n.y + n.height]);
      for (const e of scene.edges) for (const l of e.labels) pinned.push([l.y, l.y + l.height]);
      for (const s of segmentsOf(scene).horizontal) pinned.push([s.y - 1, s.y + 1]);
      pinned.sort((a, b) => a[0] - b[0]);
      let reach = 0;
      for (const [top, bottom] of pinned) {
        assert.ok(
          top - reach < 30,
          `${file} ${disp}: ${Math.round(top - reach)}px dead band at y≈${Math.round(reach)}`,
        );
        reach = Math.max(reach, bottom);
      }
      assert.ok(
        scene.height - reach < 30,
        `${file} ${disp}: ${Math.round(scene.height - reach)}px dead band at the bottom`,
      );
    }
});

// Issue #26: elk wraps backward hierarchical edges around the whole drawing.
// The detour reroute (src/route-detour.ts) must bring the two marked flows of
// logical-fr (CALCUL→RESPONSABLE, DOSSIER→ASSURE) down through a bottom
// channel instead — bounded path length relative to the direct distance.
test("backward flows are rerouted through the bottom channel, not wrapped (logical-fr)", async () => {
  const { model, scene, overlapsAfter } = await build(load("logical-fr.cairn"));
  assert.equal(overlapsAfter, 0);
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
  const pathLen = (pts: { x: number; y: number }[]) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++)
      len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    return len;
  };
  for (const [from, to] of [
    ["CALCUL", "RESPONSABLE"],
    ["DOSSIER", "ASSURE"],
  ]) {
    const flow = model.flows.find((f) => f.from === from && f.to === to)!;
    const edge = scene.edges.find((e) => e.id === flow.id)!;
    const a = nodeById.get(from)!,
      b = nodeById.get(to)!;
    const direct =
      Math.abs(a.x + a.width / 2 - b.x - b.width / 2) +
      Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
    assert.ok(
      pathLen(edge.pts) < 1.75 * direct,
      `${from}→${to} must not wrap around the drawing (len ${Math.round(pathLen(edge.pts))} vs direct ${Math.round(direct)})`,
    );
  }
});

// Issue #26, top channel: when nodes below block the south exit (logical-archi
// COORD→OPE — three blocks stacked under COORD), the reroute must mirror the
// route north instead of leaving elk's wrap in place.
test("south-blocked backward flows use the top channel instead (logical-archi)", async () => {
  const { model, scene, overlapsAfter } = await build(load("logical-archi.cairn"));
  assert.equal(overlapsAfter, 0);
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
  const flow = model.flows.find((f) => f.from === "COORD" && f.to === "OPE")!;
  const edge = scene.edges.find((e) => e.id === flow.id)!;
  let len = 0;
  for (let i = 1; i < edge.pts.length; i++)
    len +=
      Math.abs(edge.pts[i].x - edge.pts[i - 1].x) + Math.abs(edge.pts[i].y - edge.pts[i - 1].y);
  const a = nodeById.get("COORD")!,
    b = nodeById.get("OPE")!;
  const direct =
    Math.abs(a.x + a.width / 2 - b.x - b.width / 2) +
    Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
  assert.ok(
    len < 2.2 * direct,
    `COORD→OPE must route via the top channel (len ${Math.round(len)} vs direct ${Math.round(direct)})`,
  );
});

test("no flow in the corpus wraps around a whole drawing (longDetour is 0 per drawing)", async () => {
  // The sweep ratchets `longDetour` corpus-wide; this checks the two logical
  // fixtures whose backward flows leave a container for a target inside another
  // one, which is the shape the port-constrained relayout exists to keep clean.
  for (const name of ["logical.cairn", "logical-archi.cairn"]) {
    const { model, scene } = await build(load(name));
    const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const edge of scene.edges) {
      const flow = model.flows.find((f) => f.id === edge.id);
      const from = nodeById.get(flow?.from ?? "");
      const to = nodeById.get(flow?.to ?? "");
      if (!from || !to) continue;
      assert.equal(
        isLongDetour(edge.pts, from, to),
        false,
        `${name}: ${flow!.from}→${flow!.to} measures far longer than the distance it covers`,
      );
    }
  }
});

test("a relayout round is chosen by tier first, then by the wraps the verdict cannot weigh", () => {
  const round = (tier: number, detours: number) => ({ scene: `${tier}/${detours}`, tier, detours });
  // Nothing accepted yet: any round that got this far beats nothing.
  assert.equal(beatsRelayout(round(3, 9), null), true);
  // The ladder decides first, in both directions.
  assert.equal(beatsRelayout(round(0, 9), round(2, 0)), true);
  assert.equal(beatsRelayout(round(2, 0), round(0, 9)), false);
  // Same tier: the round leaving fewer flows wrapped around the drawing wins.
  assert.equal(beatsRelayout(round(0, 0), round(0, 2)), true);
  assert.equal(beatsRelayout(round(0, 2), round(0, 0)), false);
  // A dead heat keeps the round already accepted, so the choice cannot depend
  // on how many rounds ran (§2, byte-deterministic output).
  assert.equal(beatsRelayout(round(1, 1), round(1, 1)), false);
});

// ---------- dispositions ----------

test("slide is always landscape, page always portrait (medium)", async () => {
  const base = load("medium.cairn");
  const slide = await build(base.replace('"\n', '"\nstyle { disposition: slide }\n'));
  assert.ok(slide.scene.width >= slide.scene.height);
  const page = await build(base.replace('"\n', '"\nstyle { disposition: page }\n'));
  assert.ok(page.scene.height >= page.scene.width);
});

// Reading-order invariant: actors LEFT for wide/slide, TOP for tall/page.
// This is enforced by locking layout direction per disposition (src/layout.ts),
// so it must hold for every disposition — not just land there by fitness luck.
const actorSide = (scene: {
  nodes: { kind: string; x: number; y: number; width: number; height: number }[];
}) => {
  const actors = scene.nodes.filter((n) => n.kind === "actor-group" || n.kind === "actor");
  const others = scene.nodes.filter((n) => n.kind !== "actor-group" && n.kind !== "actor");
  const acx =
    (Math.min(...actors.map((a) => a.x)) + Math.max(...actors.map((a) => a.x + a.width))) / 2;
  const acy =
    (Math.min(...actors.map((a) => a.y)) + Math.max(...actors.map((a) => a.y + a.height))) / 2;
  const ocx = others.reduce((s, n) => s + n.x + n.width / 2, 0) / others.length;
  const ocy = others.reduce((s, n) => s + n.y + n.height / 2, 0) / others.length;
  return { left: acx < ocx, top: acy < ocy };
};

test("actors are LEFT for wide/slide and TOP for tall/page (all sizes)", async () => {
  for (const f of ["small.cairn", "medium.cairn", "large.cairn", "application-large.cairn"]) {
    const base = load(f);
    for (const disp of ["wide", "slide"] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(actorSide(scene).left, `${f} ${disp}: actors must be on the LEFT`);
    }
    for (const disp of ["tall", "page"] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(actorSide(scene).top, `${f} ${disp}: actors must be on TOP`);
    }
  }
});

// Same reading-order invariant for actor-less views (infrastructure, security):
// user-facing sources sit on the entry side, downstream partners on the exit
// side. In infra, users are `actor` elements; in security they are untrusted
// `external`s. Guards the "Internet visitors on the left" fix.
const nodeSide = (
  scene: {
    nodes: { id: string; kind: string; x: number; y: number; width: number; height: number }[];
  },
  id: string,
) => {
  const n = scene.nodes.find((m) => m.id === id)!;
  const others = scene.nodes.filter((m) => m.kind !== "external" && m.kind !== "actor");
  const ocx = others.reduce((s, m) => s + m.x + m.width / 2, 0) / others.length;
  const ocy = others.reduce((s, m) => s + m.y + m.height / 2, 0) / others.length;
  return { left: n.x + n.width / 2 < ocx, top: n.y + n.height / 2 < ocy };
};

test("user-facing sources sit on the entry side in infra/security views", async () => {
  const cases: [string, string, string][] = [
    ["infrastructure.cairn", "USERS", "EDI"], // actor users vs egress partner
    ["security.cairn", "USERS", "PARTNER"], // untrusted end users vs partner
  ];
  for (const [f, ingress, egress] of cases) {
    const base = load(f);
    for (const disp of ["wide", "slide"] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(nodeSide(scene, ingress).left, `${f} ${disp}: ${ingress} (users) must be LEFT`);
      assert.ok(!nodeSide(scene, egress).left, `${f} ${disp}: ${egress} (partner) must be RIGHT`);
    }
    for (const disp of ["tall", "page"] as const) {
      const { scene } = await build(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      assert.ok(nodeSide(scene, ingress).top, `${f} ${disp}: ${ingress} (users) must be TOP`);
      assert.ok(!nodeSide(scene, egress).top, `${f} ${disp}: ${egress} (partner) must be BOTTOM`);
    }
  }
});

test("infrastructure models users as actor (person glyph + legend key), distinct from external systems", async () => {
  const { model, svg } = await build(load("infrastructure-small.cairn"));
  const visitors = model.index.get("VISITORS")!;
  assert.equal(visitors.kind, "actor", "the user is an actor, not an external");
  // person glyph is rendered (head circle r=7), and the legend keys it
  assert.match(svg, /<circle cx="[\d.]+" cy="[\d.]+" r="7"/);
  assert.match(svg, />User \/ consumer</);
  // `actor` is accepted by the infrastructure view (no E0201)
  const { codes } = check(load("infrastructure-small.cairn"));
  assert.ok(!codes.includes("E0201"));
});

test("compact style yields a smaller canvas with zero overlaps", async () => {
  for (const f of ["small.cairn", "medium.cairn", "application.cairn", "infrastructure.cairn"]) {
    const base = load(f);
    const normal = await build(base);
    const compact = await build(base.replace('"\n', '"\nstyle { compact: on }\n'));
    const aN = normal.scene.width * normal.scene.height;
    const aC = compact.scene.width * compact.scene.height;
    assert.ok(
      aC < aN,
      `${f}: compact (${compact.scene.width}x${compact.scene.height}) must be smaller than normal (${normal.scene.width}x${normal.scene.height})`,
    );
    assert.equal(compact.overlapsAfter, 0, `${f}: compact must keep zero label overlaps`);
  }
  // compact is off by default
  const { model } = await build(load("small.cairn"));
  assert.equal(model.style.compact, false);
});

test("font-size scales the text and is measured into the layout", async () => {
  const base =
    'diagram logical "t"\nSTYLE\nactor-group G "g" { actor A "a" }\nsystem S "s" { block B "Node label" }\nA -> B : "flow"\n';
  const def = await build(base.replace("STYLE\n", ""));
  assert.equal(def.model.style.font.size, 12.5, "default base font is 12.5");
  assert.match(def.svg, /font-size="12.5"[^>]*>Node label/);
  const big = await build(base.replace("STYLE", "style { font-size: 18 }"));
  assert.match(big.svg, /font-size="18"[^>]*>Node label/);
  assert.ok(big.scene.width >= def.scene.width, "larger font is measured into node width");
  assert.equal(big.overlapsAfter, 0);
  const small = await build(base.replace("STYLE", "style { font-size: 9 }"));
  assert.match(small.svg, /font-size="9"[^>]*>Node label/);
});

test("flow readability: endpoint number, larger arrows, color-by-source", async () => {
  const base =
    'diagram logical "t"\nSTYLE\nactor-group G "g" { actor A "a" }\nsystem S "s" { block B "b" block C "c" }\nA -> B : "one"\nB -> C : "two"\n';
  // default: single arrowhead marker, width 7
  const def = await build(base.replace("STYLE\n", ""));
  assert.match(def.svg, /markerWidth="7"/);
  assert.equal((def.svg.match(/<marker /g) ?? []).length, 1);
  // B — arrows: large gives a bigger marker
  const large = await build(base.replace("STYLE", "style { arrows: large }"));
  assert.match(large.svg, /markerWidth="11"/);
  // C — by-source: one marker per source color + colored strokes + legend hint
  const col = await build(base.replace("STYLE", "style { flow-color: by-source }"));
  assert.ok((col.svg.match(/<marker /g) ?? []).length >= 2, "a marker per source color");
  assert.match(col.svg, /stroke="#1f77b4"/); // first source hue
  assert.match(col.svg, /colour = source/); // legend hint
  assert.equal(col.overlapsAfter, 0);
  // A — numbered badge pinned near the target; must still be overlap-free
  const num = await build(base.replace("STYLE", "style { flow-text: numbered }"));
  assert.equal(num.overlapsAfter, 0);
});

// ---------- bands & rendering ----------

test("legend + registry bands render, and legend: off removes the legend only", async () => {
  const on = await build(load("small.cairn"));
  assert.match(on.svg, /LEGEND/);
  assert.match(on.svg, /BUSINESS OBJECTS/);
  const off = await build(load("small.cairn").replace('"\n', '"\nstyle { legend: off }\n'));
  assert.doesNotMatch(off.svg, /LEGEND/);
  assert.match(off.svg, /BUSINESS OBJECTS/);
});

test("flow-text: numbered produces badges + FLUX band", async () => {
  const { svg } = await build(load("large-numbered.cairn"));
  assert.match(svg, />FLOWS</);
});

test("technical tail renders under the label", async () => {
  const { svg } = await build(load("infrastructure-small.cairn"));
  assert.match(svg, /\(HTTPS\/443\)/);
});

test("datastore renders as a cylinder (ellipse cap)", async () => {
  const { svg } = await build(load("application-small.cairn"));
  assert.match(svg, /<ellipse/);
});

test("multi-line container labels are fully rendered", async () => {
  const { svg } = await build(load("infrastructure-large.cairn"));
  assert.match(svg, />front</); // second line of "K8s cluster\nfront"
  assert.match(svg, />business</); // second line of "K8s cluster\nbusiness"
});

// ---------- theming & colors ----------

const THEME_BASE =
  'diagram logical "t"\nSTYLE\nactor-group G "g" { actor A "a" }\n' +
  'system S "s" { layer L "l" { block B "b" } }\nA -> B : "x"\n';

test("dark theme paints a dark background + light chrome; light stays white", async () => {
  const dark = await build(THEME_BASE.replace("STYLE", "style { theme: dark }"));
  assert.match(dark.svg, /<rect width="\d+" height="\d+" fill="#1e2530"\/>/); // dark canvas
  assert.match(dark.svg, /#c2ccd6/); // light band text
  const light = await build(THEME_BASE.replace("STYLE\n", "")); // default = modern light
  assert.match(light.svg, /<rect width="\d+" height="\d+" fill="#ffffff"\/>/);
  assert.doesNotMatch(light.svg, /#1e2530/);
});

test("themes: named themes paint their palette, classic keeps the old look, accent retints flows", async () => {
  const nord = await build(THEME_BASE.replace("STYLE", "style { theme: nord }"));
  assert.match(nord.svg, /fill="#2e3440"/); // nord canvas
  const classic = await build(THEME_BASE.replace("STYLE", "style { theme: classic }"));
  assert.match(classic.svg, /stroke="#b09a6d"/); // original system stroke preserved
  const acc = await build(THEME_BASE.replace("STYLE", "style { accent: #17876b }"));
  assert.match(acc.svg, /stroke="#17876b"/); // accent retints flows
  const { codes } = check(
    'diagram logical "t"\nstyle { theme: bogus }\nactor-group G "g" { actor A "a" }\nsystem S "s" { block B "b" }\nA -> B : "x"\n',
  );
  assert.ok(codes.includes("E0103"), "unknown theme is rejected as an invalid value");
});

test("background: overrides the theme default canvas color", async () => {
  const { svg } = await build(
    THEME_BASE.replace("STYLE", "style {\n theme: dark\n background: #0d1117\n}"),
  );
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#0d1117"\/>/);
});

test("per-element and per-kind colors apply (fill, stroke, text)", async () => {
  const inline =
    'diagram logical "t"\nactor-group G "g" { actor A "a" }\n' +
    'system S "s" { layer L "l" { block B "b" { style { fill: #cc2222  stroke: #ff0000  text: #ffffff } } } }\nA -> B : "x"\n';
  const s1 = await build(inline);
  assert.match(s1.svg, /fill="#cc2222"/); // per-element fill
  assert.match(s1.svg, /stroke="#ff0000"/); // per-element stroke (same line)
  const perKind =
    'diagram logical "t"\nstyle { text block: #eeff00 }\nactor-group G "g" { actor A "a" }\n' +
    'system S "s" { block B "b" }\nA -> B : "x"\n';
  const s2 = await build(perKind);
  assert.match(s2.svg, /fill="#eeff00"/); // per-kind text color
});

test("dark theme keeps zero label overlaps (small)", async () => {
  const { overlapsAfter } = await build(
    load("small.cairn").replace('"\n', '"\nstyle { theme: dark }\n'),
  );
  assert.equal(overlapsAfter, 0);
});

// ---------- i18n (output localization, keywords stay English) ----------

test("lang: fr localizes band titles, legend and kind names", async () => {
  const fr = await build(
    load("infrastructure-small.cairn").replace('"\n', '"\nstyle { lang: fr }\n'),
  );
  assert.match(fr.svg, />LÉGENDE</);
  assert.match(fr.svg, /Zone réseau/);
  assert.doesNotMatch(fr.svg, />LEGEND</);
});

test("lang: en (default) is unchanged — English chrome", async () => {
  const en = await build(load("infrastructure-small.cairn"));
  assert.match(en.svg, />LEGEND</);
  assert.doesNotMatch(en.svg, />LÉGENDE</);
});

// ---------- matrice des flux techniques ----------

test("matrix CSV: header, one row per flow, protocol/port split, zone annotation", () => {
  const { model } = check(load("infrastructure.cairn"));
  const csv = matrixCsv(buildFlowMatrix(model, views[model.type!]));
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, model.flows.length + 1); // header + one row per flow
  assert.match(lines[0], /^No\.,Source,Destination,Protocol,Port,Flow$/);
  assert.doesNotMatch(lines[0], /Business objects/); // no business-object column
  assert.ok(lines.some((l) => /,HTTPS,443,/.test(l))); // (HTTPS/443) split into two columns
  assert.ok(lines.some((l) => /\(DMZ\)/.test(l))); // endpoint annotated with its zone
});

// ---------- security view ----------

test("security.cairn: valid reference builds clean with zero overlaps", async () => {
  const { diags, codes } = check(load("security.cairn"));
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.ok(!codes.includes("W0560"), "reference has no unfiltered crossings");
  assert.ok(!codes.includes("W0561"), "reference states encryption on cross-zone flows");
  const { overlapsAfter } = await build(load("security.cairn"));
  assert.equal(overlapsAfter, 0);
});

test("security: W0560 fires on an unfiltered trust-boundary crossing", () => {
  const src =
    'diagram security "t"\n' +
    'trust-zone Z0 "Edge" (public) { asset A "a" }\n' +
    'trust-zone Z1 "Core" (restricted) { asset B "b" }\n' +
    'A -> B : "direct" (TLS1.3)\n';
  const { codes } = check(src);
  assert.ok(codes.includes("W0560"), "A(public) -> B(restricted) without a security-node");
});

test("security: routing through a security-node clears W0560", () => {
  const src =
    'diagram security "t"\n' +
    'trust-zone Z0 "Edge" (public) { security-node FW "fw" }\n' +
    'trust-zone Z1 "Core" (restricted) { asset B "b" }\n' +
    'FW -> B : "filtered" (TLS1.3)\n';
  const { codes } = check(src);
  assert.ok(!codes.includes("W0560"));
});

test("security: E0250 on a trust-zone without a valid sensitivity level", () => {
  const missing = check('diagram security "t"\ntrust-zone Z "z" { asset A "a" }\n');
  assert.ok(missing.codes.includes("E0250"));
  const bad = check('diagram security "t"\ntrust-zone Z "z" (topsecret) { asset A "a" }\n');
  const d = bad.diags.find((d) => d.code === "E0250")!;
  assert.match(d.note ?? "", /public, internal, restricted, secret/);
});

test("security: trust zones are colored by sensitivity level + tag rendered", async () => {
  const { svg } = await build(load("security.cairn"));
  assert.match(svg, /fill="#fdeceb"/); // public level fill (modern light)
  assert.match(svg, /fill="#e9f2fb"/); // restricted level fill (modern light)
  assert.match(svg, />PUBLIC</);
  assert.match(svg, />RESTRICTED</);
});

// Each view declares its own columns in `views.ts` — the infrastructure table
// is the reference shape, the others drop what their flows cannot carry.
for (const [file, header] of [
  ["application.cairn", "No.,Source,Destination,Protocol,Flow"],
  ["security.cairn", "No.,Source,Destination,Protocol,Flow"],
  ["logical.cairn", "No.,Source,Destination,Flow"],
] as const) {
  test(`matrix columns follow the view: ${file}`, () => {
    const { model } = check(load(file));
    const csv = matrixCsv(buildFlowMatrix(model, views[model.type!]));
    assert.equal(csv.split("\n")[0], header);
  });
}

test("matrix annotates an endpoint with the view's own container kind", () => {
  // Infrastructure says `network-zone`/`site`; security says `trust-zone`.
  const { model } = check(load("security.cairn"));
  const csv = matrixCsv(buildFlowMatrix(model, views[model.type!]));
  assert.ok(csv.includes("(Data zone)"));
});

test("matrix respects lang: fr headers; md renders the French title", () => {
  // The locale is the diagram's own `style { lang }` — the exporters never take
  // a language of their own, so CLI, API and playground cannot disagree.
  const { model } = check(load("infrastructure-fr.cairn"));
  const matrix = buildFlowMatrix(model, views[model.type!]);
  assert.match(
    matrixCsv(matrix).split("\n")[0],
    /^N°,Source,Destination,Protocole,Port,Nature du flux$/,
  );
  assert.match(matrixMd(matrix), /MATRICE DES FLUX TECHNIQUES/);
});

test("matrix svg renders a standalone document with the English title", () => {
  const { model } = check(load("infrastructure.cairn"));
  const svg = matrixSvg(buildFlowMatrix(model, views[model.type!]));
  assert.match(svg, /^<svg/);
  assert.match(svg, /TECHNICAL FLOW MATRIX/);
});

// ---------- security ----------

test("security: a font family cannot break out of the SVG attribute", async () => {
  // A quote in the (user-controlled) font family must be escaped, else it could
  // close the font-family="…" attribute and inject e.g. an onload handler that
  // fires when the SVG is opened standalone.
  const src =
    'diagram logical "t"\nstyle { font: "x\\" onload=\\"alert(1)" 12 }\n' +
    'actor-group G "g" { actor A "a" }\nsystem S "s" { block B "b" }\nA -> B : "x"\n';
  const { svg } = await build(src);
  assert.ok(!/onload="alert/.test(svg), "attribute injection must not appear unescaped");
  assert.match(svg, /font-family="x&quot; onload=&quot;alert\(1\)/);
});

test("glyph-box borders honour the node's own `stroke` line style", async () => {
  // renderGlyphBox draws the same rounded rect as renderPlainBox, so it must
  // resolve `stroke.style` the same way: a dashed or dotted node style reaches
  // it through resolveStyle (kind defaults < `stroke <kind>:` < inline), never
  // through the flow-stroke path. Regression guard for the glyph kinds silently
  // dropping the dash array while every other box kept it.
  const src =
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { gateway GW "Gateway" { style { stroke: #cc2222 dashed 2 } } server SV "Server" { style { stroke: #2222cc dashed 2 } } } }\n';
  const { svg } = await build(src);
  assert.match(
    svg,
    /<rect[^>]*stroke="#cc2222"[^>]*stroke-dasharray="5 3"/,
    "a dashed gateway must render a dashed border like any other box",
  );
  assert.match(
    svg,
    /<rect[^>]*stroke="#2222cc"[^>]*stroke-dasharray="5 3"/,
    "the plain-box control must stay dashed",
  );
});

test("security: fill/stroke/text on gateway/auth/queue are attribute-escaped", async () => {
  // Per-element style values (fill, stroke, text) on the new element kinds must
  // be passed through escAttr() so a quote in a user-supplied colour does not
  // break out of the SVG attribute — even though these values normally look like
  // hex colours, custom themes could propagate untrusted strings into them.
  const src =
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { gateway GW "Gateway" { style { fill: #cc2222 stroke: #ff0000 text: #ffffff } } auth OAUTH2 "OAuth2" { style { fill: #3366cc stroke: #00ff00 text: #ffff00 } } } }\nqueue Q "Queue" { style { fill: #ff00ff stroke: #990099 text: #000000 } }\nactor U "User"\nU -> GW : "Login" (HTTPS/443)\n';
  const { svg } = await build(src);
  assert.match(svg, /fill="#cc2222"/, "gateway fill must be escAttr-escaped");
  assert.match(svg, /fill="#3366cc"/, "auth fill must be escAttr-escaped");
  assert.match(svg, /fill="#ff00ff"/, "queue fill must be escAttr-escaped");
  assert.equal(svg.includes("onload="), false, "no unescaped attribute injection");
});

test("security: a background colour cannot break out of the matrix SVG attribute", () => {
  // The flow-matrix exporter interpolates `style.background` into a fill="…"
  // attribute. The DSL only admits a #hex colour token there, but the playground
  // and the /api/svg handler set style fields programmatically, so the exporter
  // must not depend on the parser having sanitized it — it escapes the value the
  // same way svg-render.ts does. Regression guard for the unescaped interpolation.
  const { model, diags } = check(
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { server A "a" } }\n' +
      'external B "b"\nA -> B : "x" (HTTPS/443)\n',
  );
  assert.equal(diags.filter((d) => d.severity === "error").length, 0, "fixture must build");
  model.style.background = 'x" onload="alert(1)';
  const svg = matrixSvg(buildFlowMatrix(model, views[model.type!]));
  assert.ok(!/onload="alert/.test(svg), "attribute injection must not appear unescaped");
  assert.match(svg, /fill="x&quot; onload=&quot;alert\(1\)"/);
});

test("security: a reserved key cannot be used as a per-kind style target", () => {
  // `fill __proto__: …` must be rejected, not written into the kind map's
  // prototype slot (defence-in-depth against prototype pollution).
  const { diags } = check(
    'diagram logical "t"\nstyle { fill __proto__: #fff }\nactor-group G "g" { actor A "a" }\n',
  );
  assert.ok(diags.some((d) => d.severity === "error" && /reserved/.test(d.message)));
});

test("business objects are logical-only: allowed in logical, E0222 elsewhere", () => {
  const decl = 'business-object BO "Order" "an order"\n';
  // logical: fine
  assert.ok(
    !check(`diagram logical "t"\nsystem S "s" { block B "b" }\n${decl}`).codes.includes("E0222"),
  );
  // application / infrastructure / security: rejected
  assert.ok(
    check(`diagram application "t"\napplication A "a" { module M "m" }\n${decl}`).codes.includes(
      "E0222",
    ),
  );
  assert.ok(
    check(`diagram infrastructure "t"\nsite S "s" { server V "v" }\n${decl}`).codes.includes(
      "E0222",
    ),
  );
  assert.ok(
    check(
      `diagram security "t"\ntrust-zone Z "z" (public) { asset A "a" }\n${decl}`,
    ).codes.includes("E0222"),
  );
});

test("a `[ref]` on a flow in a non-logical view is E0222", () => {
  const src =
    'diagram application "t"\napplication A "a" { module M "m" }\ndatastore D "d"\nM -> D : "x" [BO]\n';
  assert.ok(check(src).codes.includes("E0222"));
});

test("queue is a valid kind in application & infrastructure, unknown in logical", () => {
  assert.ok(
    !check(
      'diagram application "t"\nqueue Q "q"\napplication A "a" { module M "m" }\nM -> Q : "x"\n',
    ).codes.includes("E0201"),
  );
  assert.ok(
    !check(
      'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { queue Q "q" server V "v" { app-instance I "i" } } }\nI -> Q : "x" (TCP/9092)\n',
    ).codes.includes("E0201"),
  );
  // logical does not define `queue`
  assert.ok(check('diagram logical "t"\nqueue Q "q"\n').codes.includes("E0201"));
});

test("queue renders as a horizontal cylinder (path + end-rim ellipse), overlaps 0", async () => {
  const { svg, overlapsAfter } = await build(
    'diagram application "t"\nqueue Q "q"\napplication A "a" { module M "m" }\nM -> Q : "x" (MQ)\n',
  );
  assert.equal(overlapsAfter, 0);
  assert.match(svg, /<path d="M \d+ \d+ h [\d-]+ a 8 /); // capsule body with rx=8 end caps
  assert.match(svg, /<ellipse cx="\d+" cy="\d+" rx="8"/); // end-rim ellipse
});

test("flow labels: required on logical/security (E0203), optional on application/infrastructure", () => {
  // logical + security still require the label
  assert.ok(
    check(
      'diagram logical "t"\nactor-group G "g" { actor A "a" }\nsystem S "s" { block B "b" }\nA -> B\n',
    ).codes.includes("E0203"),
  );
  assert.ok(
    check(
      'diagram security "t"\ntrust-zone Z "z" (public) { asset A "a" asset B "b" }\nA -> B\n',
    ).codes.includes("E0203"),
  );
  // application + infrastructure no longer require it
  assert.ok(
    !check(
      'diagram application "t"\napplication A "a" { module M "m" }\ndatastore D "d"\nM -> D\n',
    ).codes.includes("E0203"),
  );
  assert.ok(
    !check(
      'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { server V "v" { app-instance A "a" } app-instance B "b" } }\nA -> B (TCP/9092)\n',
    ).codes.includes("E0203"),
  );
});

test('flow label after `:` is optional — "text", "", and a bare `:` before the tail all parse', () => {
  const head = 'diagram application "t"\napplication A "a" { module M "m" }\ndatastore D "d"\n';
  const labelled = check(`${head}M -> D : "Payment request" (API_REST, JSON)\n`);
  const emptyStr = check(`${head}M -> D : "" (API_REST, JSON)\n`);
  const noLabel = check(`${head}M -> D : (API_REST, JSON)\n`);
  for (const r of [labelled, emptyStr, noLabel]) {
    assert.equal(r.diags.filter((d) => d.severity === "error").length, 0);
  }
  // empty string and omitted label both mean "no label"
  assert.equal(emptyStr.model.flows[0].label ?? "", "");
  assert.equal(noLabel.model.flows[0].label, undefined);
  // but a stray non-label token after `:` is still an error
  assert.ok(check(`${head}M -> D : foo123\n`).codes.includes("E0101"));
});

test("tail-only flows stay overlap-free on a dense application diagram", async () => {
  // With labels omitted, the protocol tail takes the label's place and is
  // overlap-resolved like a label — a dense example must still reach 0.
  const { overlapsAfter } = await build(load("application-large.cairn"));
  assert.equal(overlapsAfter, 0);
});

test("infrastructure protocol stays mandatory (E0240) even when the label is omitted", () => {
  const src =
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { server V "v" { app-instance A "a" } app-instance B "b" } }\nA -> B\n';
  const { codes } = check(src);
  assert.ok(codes.includes("E0240"));
  assert.ok(!codes.includes("E0203")); // label omission is fine; only the protocol is flagged
});

test("gateway, auth, and idp are valid in infrastructure, unknown in other views", () => {
  const infra =
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { gateway GW "Gateway"\nauth OAUTH2 "Auth"\nidp IDP "IdP" } }\n';
  assert.ok(!check(infra).codes.includes("E0201"));
  // rejected in logical, application, security
  for (const v of ["logical", "application", "security"]) {
    assert.ok(check(`diagram ${v} "t"\ngateway GW "Gateway"\n`).codes.includes("E0201"));
    assert.ok(check(`diagram ${v} "t"\nauth OAUTH2 "Auth"\n`).codes.includes("E0201"));
    assert.ok(check(`diagram ${v} "t"\nidp IDP "IdP"\n`).codes.includes("E0201"));
  }
});

test("gateway renders as a rounded rect with the gate glyph, overlaps 0", async () => {
  const { svg, overlapsAfter } = await build(
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { gateway GW "Gateway" } }\nauth OAUTH2 "OAuth2"\nactor USR "User"\nUSR -> GW : "Login" (HTTPS/443)\n',
  );
  assert.equal(overlapsAfter, 0);
  assert.match(svg, /<rect[^>]*rx="4"/); // rounded rect
  assert.match(svg, /l 3 3 l -3 3/); // the arrow head passing between the gate posts
});

test("firewall is valid in infrastructure only, and renders the brick-wall glyph", async () => {
  const src =
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { firewall FW "Firewall" } }\nactor USR "User"\nUSR -> FW : (HTTPS/443)\n';
  assert.ok(!check(src).codes.includes("E0201"));
  for (const v of ["logical", "application", "security"])
    assert.ok(check(`diagram ${v} "t"\nfirewall FW "Firewall"\n`).codes.includes("E0201"));

  const { svg, overlapsAfter } = await build(src);
  assert.equal(overlapsAfter, 0);
  // three courses of brick: two horizontal joints, four staggered verticals
  assert.match(svg, /<path d="M [\d.]+ [\d.]+ H [\d.]+ M [\d.]+ [\d.]+ H [\d.]+"/);
});

test("each glyph kind draws its own glyph, so none renders as a plain box", async () => {
  const { svg } = await build(
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { gateway GW "Gateway"\nfirewall FW "Firewall"\nauth AU "Auth"\nidp ID "IdP" } }\nactor USR "User"\nUSR -> GW : (HTTPS/443)\nGW -> FW : (HTTPS/443)\nFW -> AU : (HTTPS/443)\nAU -> ID : (LDAPS/636)\n',
  );
  // Three circles in the drawing — padlock keyhole, badge head, actor head —
  // and each appears again in its legend key. An idp drawn as a plain box (as
  // it was before the glyph family) would drop two of the six.
  assert.equal(svg.match(/<circle/g)?.length, 6);
  assert.match(svg, /q 4 -4 8 0/); // the badge's shoulders
});

test("the legend key draws the same glyph as the node it stands for", async () => {
  const { svg } = await build(
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { firewall FW "Firewall" } }\nactor USR "User"\nUSR -> FW : (HTTPS/443)\n',
  );
  const legendIndex = svg.indexOf("LEGEND");
  assert.ok(legendIndex > 0);
  // the brick joints appear twice: once in the node, once in its legend key
  assert.equal(svg.match(/ H [\d.]+ M [\d.]+ [\d.]+ H /g)?.length, 2);
});

test("cairn new: refuses to overwrite an existing file, and never clobbers it", () => {
  // `new` creates with the `wx` flag (O_CREAT|O_EXCL), so "does it exist?" and
  // "create it" are a single atomic syscall. The previous existsSync()-then-write
  // left a TOCTOU window in which the path could be swapped between the two
  // (js/file-system-race, CWE-367). User-visible contract is unchanged: refuse,
  // explain, exit 2 — and, critically, leave the existing content untouched.
  const dir = mkdtempSync(join(tmpdir(), "cairn-new-"));
  try {
    const target = join(dir, "scaffold.cairn");
    const runNew = () =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", join(ROOT, "src", "cli.ts"), "new", "-L", target],
        { encoding: "utf8" },
      );

    const first = runNew();
    assert.equal(first.status, 0, first.stderr);
    const scaffolded = readFileSync(target, "utf8");
    assert.match(scaffolded, /^diagram logical /);

    // Second run hits the pre-existing-file branch — the one that used to race.
    const second = runNew();
    assert.equal(second.status, 2, "must refuse with exit code 2");
    assert.match(second.stderr, /already exists/);
    assert.equal(readFileSync(target, "utf8"), scaffolded, "existing file must be left intact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cairn version / --version / -v all print package.json's version under plain Node", () => {
  // Under plain Node, CAIRN_BUILD_VERSION is never defined (it's only injected by
  // `bun build --define` — see scripts/build-binaries.sh), so all three forms must
  // fall back to package.json's version. The "must match the release tag" half of
  // this contract only exists in a bun-compiled binary and is covered instead by
  // scripts/smoke-binary.sh, which can assert against the actual tag it was built with.
  const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  for (const flag of ["version", "--version", "-v"]) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "src", "cli.ts"), flag],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `cairn v${pkgVersion}`);
  }
});

test("auth renders with a padlock glyph (shackle arc + body rect), overlaps 0", async () => {
  const { svg, overlapsAfter } = await build(
    'diagram infrastructure "t"\nsite S "s" { network-zone Z "z" { auth OAUTH2 "OAuth2"\ngateway GW "Gateway" } }\nactor USR "User"\nUSR -> GW : "Login" (HTTPS/443)\nGW -> OAUTH2 : "Forward" (HTTP/80)\n',
  );
  assert.equal(overlapsAfter, 0);
  // padlock shackle arc + body rect
  assert.match(svg, /v -3 a 3 3 0 0 1 6 0 v 3/);
  assert.match(svg, /<rect[^>]*rx="4"/); // rounded rect
});

// ---------- positioning controls (issue #8) ----------

/** Y of the node with this id, for order assertions across a `wide` drawing. */
const yOf = (scene: { nodes: { id: string; y: number }[] }, id: string) =>
  scene.nodes.find((node) => node.id === id)!.y;

/** X of the node with this id, for order assertions along a `wide` drawing. */
const xOf = (scene: { nodes: { id: string; x: number }[] }, id: string) =>
  scene.nodes.find((node) => node.id === id)!.x;

const ORDER_SRC = (first: string, second: string) =>
  `diagram application "t"
actor-group G "Actors" {
  actor A_ONE "Alpha person" {
    order: ${first}
  }
  actor B_TWO "Bravo person" {
    order: ${second}
  }
}
application APP "App" {
  module M1 "Mod one"
}
A_ONE -> M1 (API_REST, JSON)
B_TWO -> M1 (API_REST, JSON)
`;

test("inside a container, `order:` sorts siblings across the axis, both ways", async () => {
  // The two actors share their actor-group's layer, and elk honors nothing else
  // for a nested element — so `wide` orders them top to bottom.
  const ascending = await build(ORDER_SRC("1", "2"));
  assert.ok(yOf(ascending.scene, "A_ONE") < yOf(ascending.scene, "B_TWO"));
  const descending = await build(ORDER_SRC("2", "1"));
  assert.ok(yOf(descending.scene, "B_TWO") < yOf(descending.scene, "A_ONE"));
});

const READING_SRC = (disposition: string, first: string, second: string) =>
  `diagram application "t"
style { disposition: ${disposition} }
application BACK_ONE "Backend one" {
  order: ${first}
  module MSG_ONE "Messaging one"
}
application BACK_TWO "Backend two" {
  order: ${second}
  module MSG_TWO "Messaging two"
}
queue Q_ONE "Queue one"
MSG_ONE -> Q_ONE (AMQP)
MSG_TWO -> Q_ONE (AMQP)
`;

test("at the diagram root, `order:` reads along the disposition's own direction", async () => {
  // Both backends feed the same queue, so the flows give them equal depth and
  // the engine would draw them side by side. `order:` sequences them instead.
  const wide = await build(READING_SRC("wide", "1", "2"));
  assert.ok(xOf(wide.scene, "BACK_ONE") < xOf(wide.scene, "BACK_TWO"), "wide: left to right");
  const wideReversed = await build(READING_SRC("wide", "2", "1"));
  assert.ok(
    xOf(wideReversed.scene, "BACK_TWO") < xOf(wideReversed.scene, "BACK_ONE"),
    "wide: and the other way round",
  );

  const tall = await build(READING_SRC("tall", "1", "2"));
  assert.ok(yOf(tall.scene, "BACK_ONE") < yOf(tall.scene, "BACK_TWO"), "tall: top to bottom");
  const tallReversed = await build(READING_SRC("tall", "2", "1"));
  assert.ok(
    yOf(tallReversed.scene, "BACK_TWO") < yOf(tallReversed.scene, "BACK_ONE"),
    "tall: and the other way round",
  );
});

test("`order:` never moves an element out of its view partition", async () => {
  // The actor-group is banded ahead of the applications (§9). An order that says
  // otherwise orders it among its own band's members, and nothing more.
  const { scene } = await build(`diagram application "t"
actor-group G "Actors" {
  order: 9
  actor U1 "User one"
}
application APP_ONE "App one" {
  order: 1
  module M1 "Mod one"
}
application APP_TWO "App two" {
  order: 2
  module M2 "Mod two"
}
U1 -> M1 (API_REST, JSON)
M1 -> M2 (API_REST, JSON)
`);
  assert.ok(xOf(scene, "G") < xOf(scene, "APP_ONE"), "actors stay on the entry side");
  assert.ok(xOf(scene, "APP_ONE") < xOf(scene, "APP_TWO"), "…and the applications still order");
});

test("an unordered element follows the flows into a band, not to the front", async () => {
  // Nothing orders the queue; it is fed by the later backend, so it lands with
  // it rather than being dragged into the first band ahead of its own source.
  const { scene } = await build(READING_SRC("wide", "1", "2"));
  assert.ok(xOf(scene, "Q_ONE") >= xOf(scene, "BACK_TWO"), "no backward flow into the queue");
});

test("`order:` rejects a non-integer or negative value (E0106), and stays usable as an id", () => {
  const { codes } = check(
    'diagram application "t"\napplication APP "a" {\n  order: two\n  module M1 "m"\n}\n',
  );
  assert.ok(codes.includes("E0106"));
  // `order` is only a keyword before a `:` — as an id it still parses as a flow.
  const asId = check(`diagram application "t"
application APP "a" {
  module order "Named order"
  module M1 "m"
}
order -> M1 (API_REST, JSON)
`);
  assert.equal(asId.diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(asId.model.flows[0].from, "order");
});

/** Which side of `nodeId` the flow's terminal sits on. */
const sideOfTerminal = (
  scene: {
    nodes: { id: string; x: number; y: number; width: number; height: number }[];
    edges: { id: string; pts: { x: number; y: number }[] }[];
  },
  flowId: string,
  nodeId: string,
  end: "start" | "finish",
) => {
  const edge = scene.edges.find((candidate) => candidate.id === flowId)!;
  const node = scene.nodes.find((candidate) => candidate.id === nodeId)!;
  const p = end === "start" ? edge.pts[0] : edge.pts[edge.pts.length - 1];
  if (Math.abs(p.y - node.y) < 2) return "top";
  if (Math.abs(p.y - (node.y + node.height)) < 2) return "bottom";
  if (Math.abs(p.x - node.x) < 2) return "left";
  if (Math.abs(p.x - (node.x + node.width)) < 2) return "right";
  return "none";
};

test("`ID.side` pins where a flow leaves and arrives, and marks the edge pinned", async () => {
  const { scene, model } = await build(
    'diagram application "t"\nactor-group G "Actors" {\n  actor U1 "User one"\n}\napplication APP "App" {\n  module M1 "Mod one"\n}\ndatastore DB "Store"\nU1 -> M1 (API_REST, JSON)\nM1.bottom -> DB.top (JDBC)\n',
  );
  const pinned = model.flows.find((flow) => flow.from === "M1")!;
  assert.equal(pinned.fromSide?.value, "bottom");
  assert.equal(pinned.toSide?.value, "top");
  assert.equal(sideOfTerminal(scene, pinned.id, "M1", "start"), "bottom");
  assert.equal(sideOfTerminal(scene, pinned.id, "DB", "finish"), "top");
  // Both ends pinned, recorded per end so a half-pinned flow keeps its free end.
  assert.deepEqual(scene.edges.find((edge) => edge.id === pinned.id)!.pinned, {
    start: true,
    end: true,
  });
  // An unpinned flow in the same drawing carries no flag — the exemption is opt-in.
  const free = model.flows.find((flow) => flow.from === "U1")!;
  assert.equal(scene.edges.find((edge) => edge.id === free.id)!.pinned, undefined);
});

test("a half-pinned flow records only the end the author named", async () => {
  const { scene, model } = await build(
    'diagram application "t"\nactor-group G "Actors" {\n  actor U1 "User one"\n}\napplication APP "App" {\n  module M1 "Mod one"\n}\ndatastore DB "Store"\nU1 -> M1 (API_REST, JSON)\nM1 -> DB.left (JDBC)\n',
  );
  const half = model.flows.find((flow) => flow.from === "M1")!;
  assert.equal(half.fromSide, undefined);
  assert.equal(half.toSide?.value, "left");
  assert.deepEqual(scene.edges.find((edge) => edge.id === half.id)!.pinned, {
    start: false,
    end: true,
  });
});

test("a declared id beats the `ID.side` reading (W0571), and an unknown side is E0223 alone", () => {
  const shadowed = check(
    'diagram application "t"\napplication APP "a" {\n  module M1 "m"\n  module M1.right "literal"\n}\ndatastore DB "d"\nM1.right -> DB (JDBC)\n',
  );
  assert.ok(shadowed.codes.includes("W0571"));
  assert.equal(shadowed.model.flows[0].from, "M1.right");
  assert.equal(shadowed.model.flows[0].fromSide, undefined);

  const unknownSide = check(
    'diagram application "t"\napplication APP "a" {\n  module M1 "m"\n}\ndatastore DB "d"\nM1.middle -> DB (JDBC)\n',
  );
  assert.ok(unknownSide.codes.includes("E0223"));
  // The element is still identified, so no `unknown reference` piles on top.
  assert.ok(!unknownSide.codes.includes("E0220"));
});

test("a pin the drawing does show is reported by nothing", async () => {
  // U1 is the leftmost node, so leaving by its left side is the least convenient
  // pin in the drawing — and it is still honored, which is what the silence means.
  const src =
    'diagram application "t"\nactor-group G "Actors" {\n  actor U1 "User one"\n}\napplication APP "App" {\n  module M1 "Mod one"\n}\nU1.left -> M1 (API_REST, JSON)\n';
  const { model, view, scene } = await build(src);
  assert.equal(view.name, "application");
  assert.equal(sideOfTerminal(scene, model.flows[0].id, "U1", "start"), "left");
  assert.deepEqual(attachSideDiagnostics(scene, model), []);
});

test("W0570 reports a pin the finished drawing does not show", async () => {
  // Driven off a scene rather than a source file: the point under test is that
  // a terminal sitting on another side is *reported*, and pinning a real layout
  // into that state would tie the test to whichever geometry pass moved it.
  const src =
    'diagram application "t"\nactor-group G "Actors" {\n  actor U1 "User one"\n}\napplication APP "App" {\n  module M1 "Mod one"\n}\nU1.left -> M1.top (API_REST, JSON)\n';
  const { model, scene } = await build(src);
  const flow = model.flows[0];
  const node = scene.nodes.find((candidate) => candidate.id === "U1")!;
  const edge = scene.edges.find((candidate) => candidate.id === flow.id)!;
  // Move the pinned start onto the right side, leaving the arrival untouched.
  edge.pts[0] = { x: node.x + node.width, y: node.y + node.height / 2 };

  const diags = attachSideDiagnostics(scene, model);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].code, "W0570");
  assert.equal(diags[0].severity, "warning");
  assert.match(diags[0].message, /`left` could not be honored/);
  assert.match(diags[0].note!, /leaves the right side of `U1`/);
  // The span points at the pin the author wrote, not at the whole flow.
  assert.deepEqual(diags[0].span, flow.fromSide!.span);
});

test("arrow glyphs carry the line style, inline `{ stroke: … }` overrides them", async () => {
  const { svg } = await build(
    'diagram application "t"\napplication APP "a" {\n  module M1 "one"\n  module M2 "two"\n  module M3 "three"\n  module M4 "four"\n}\nM1 -> M2 (API_REST, JSON)\nM1 --> M3 (MQ, JSON)\nM1 ..> M4 (MQ, JSON)\nM2 --> M4 (MQ, JSON) { stroke: solid }\n',
  );
  const flowPaths = [...svg.matchAll(/<path[^>]*marker-end[^>]*>/g)].map((match) => match[0]);
  assert.equal(flowPaths.length, 4);
  assert.equal(flowPaths.filter((path) => path.includes('stroke-dasharray="5 3"')).length, 1);
  assert.equal(flowPaths.filter((path) => path.includes('stroke-dasharray="2 2.5"')).length, 1);
  assert.equal(flowPaths.filter((path) => !path.includes("stroke-dasharray")).length, 2);
});

test("`system` is a container kind in the application view and annotates the matrix", () => {
  const src =
    'diagram application "t"\nsystem PLAT "Platform" {\n  application APP "App" {\n    module M1 "Mod one"\n  }\n  datastore DB "Store"\n}\nM1 -> DB (JDBC)\n';
  const { model, diags } = check(src);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.ok(views.application.containerKinds.includes("system"));
  const matrix = buildFlowMatrix(model, views.application);
  const cellOf = (column: string) =>
    matrix.rows[0].cells[matrix.columns.findIndex((c) => c.id === column)];
  // Nearest container wins: the module reads as its application, the datastore
  // as the system that directly holds it.
  assert.match(cellOf("source"), /\(App\)$/);
  assert.match(cellOf("dest"), /\(Platform\)$/);
  // …and `system` stays unknown in a view that does not declare it.
  assert.ok(check('diagram infrastructure "t"\nsystem S "s"\n').codes.includes("E0201"));
});
