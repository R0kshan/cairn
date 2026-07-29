/**
 * Readability sweep: builds every example in every disposition and counts
 * layout defects by kind. Run with `npm run sweep`.
 *
 * Three kinds of gate:
 *
 * - Coverage — every example × disposition cell must actually render. A cell
 *   that fails to validate, lay out or render is reported and fails the run;
 *   skipping it quietly would let the gate pass over drawings it never drew.
 * - `MUST_BE_ZERO` — invariants. A flow slanted off orthogonal, dragged across
 *   a node box, or leaving a band of dead height is a bug, full stop.
 * - `CEILING` — a ratchet over debt that cannot be zero yet. The numbers are
 *   what the corpus carries today; the run fails if any of them grows. Lower a
 *   ceiling whenever a change earns it — never raise one to make a run pass.
 *
 * Per-example spot checks repeatedly missed defects that only a full
 * example × disposition matrix reveals, which is why this exists.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { views } from "../src/views.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DISPOSITIONS = ["wide", "slide", "page", "tall"] as const;

const MUST_BE_ZERO = ["overlaps", "diagonal", "throughBox", "deadBand"] as const;
const CEILING: Record<string, number> = {
  attachShared: 2,
  attachTight: 4,
  coincident: 9,
  "jog<=6": 64,
  "jog<=20": 229,
  nearParallel: 39,
  longDetour: 88,
};

interface Run {
  lo: number;
  hi: number;
  at: number;
  id: string;
}

const totals: Record<string, number> = {};
const examples: string[] = [];
const detail = process.argv.includes("--detail");
const hits: string[] = [];
/**
 * Cells the matrix was meant to cover, and the ones that never produced a
 * scene. A skipped cell is not a clean cell: silently dropping it would let
 * the gate report success over a corpus it never actually drew.
 */
let expected = 0;
const unevaluated: string[] = [];

for (const file of readdirSync(join(ROOT, "examples"))
  .filter((f) => f.endsWith(".cairn") && !f.includes("broken"))
  .sort()) {
  const base = readFileSync(join(ROOT, "examples", file), "utf8").replace(/\r\n/g, "\n");
  for (const disp of DISPOSITIONS) {
    expected++;
    const tag = `${file.replace(".cairn", "")}/${disp}`;
    let scene: Awaited<ReturnType<typeof layout>>;
    let model: ReturnType<typeof parse>["model"];
    let overlaps: number;
    try {
      const parsed = parse(base.replace('"\n', `"\nstyle { disposition: ${disp} }\n`));
      model = parsed.model;
      const errors = validate(model).filter((d) => d.severity === "error");
      if (errors.length) {
        unevaluated.push(`${tag.padEnd(32)} ${errors[0].code} ${errors[0].message}`);
        continue;
      }
      scene = await layout(model, views[model.type!]);
      overlaps = render(model, views[model.type!], scene).overlapsAfter;
    } catch (error) {
      unevaluated.push(`${tag.padEnd(32)} ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    examples.push(tag);
    const leaves = scene.nodes.filter((n) => !n.container);
    const note = (kind: string, msg: string) => {
      totals[kind] = (totals[kind] ?? 0) + 1;
      hits.push(`${kind.padEnd(13)} ${tag.padEnd(32)} ${msg}`);
    };

    if (overlaps > 0) note("overlaps", `${overlaps}`);

    const V: Run[] = [];
    const H: Run[] = [];
    for (const e of scene.edges) {
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i];
        const b = e.pts[i + 1];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx >= 0.5 && dy >= 0.5) note("diagonal", `${e.id}`);
        else if (dx < 0.5 && dy >= 0.5)
          V.push({ id: e.id, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
        else if (dy < 0.5 && dx >= 0.5)
          H.push({ id: e.id, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      }
      for (let i = 1; i + 2 < e.pts.length; i++) {
        const len =
          Math.abs(e.pts[i + 1].x - e.pts[i].x) + Math.abs(e.pts[i + 1].y - e.pts[i].y);
        if (len > 0 && len <= 20) note(len <= 6 ? "jog<=6" : "jog<=20", `${e.id} ${len.toFixed(1)}px`);
      }
    }

    for (const list of [V, H])
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.id === b.id) continue;
          const gap = Math.abs(a.at - b.at);
          const shared = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
          if (gap < 3 && shared > 8) note("coincident", `${a.id}~${b.id} gap=${gap.toFixed(1)}`);
          else if (gap < 10 && shared > 40)
            note("nearParallel", `${a.id}~${b.id} gap=${gap.toFixed(1)} run=${shared.toFixed(0)}`);
        }

    // A run crossing a *leaf* box is a bug; container interiors are routable.
    for (const s of H)
      for (const n of leaves)
        if (s.at > n.y + 1 && s.at < n.y + n.height - 1 && s.lo < n.x + n.width - 1 && s.hi > n.x + 1)
          note("throughBox", `${s.id} through ${n.id}`);
    for (const s of V)
      for (const n of leaves)
        if (s.at > n.x + 1 && s.at < n.x + n.width - 1 && s.lo < n.y + n.height - 1 && s.hi > n.y + 1)
          note("throughBox", `${s.id} through ${n.id}`);

    const seats = new Map<string, { at: number; id: string }[]>();
    for (const e of scene.edges) {
      if (!e.pts.length) continue;
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
        for (const n of leaves) {
          const wx = p.x > n.x - 2 && p.x < n.x + n.width + 2;
          const wy = p.y > n.y - 2 && p.y < n.y + n.height + 2;
          let side: string | null = null;
          if (wx && Math.abs(p.y - n.y) < 2) side = "north";
          else if (wx && Math.abs(p.y - (n.y + n.height)) < 2) side = "south";
          else if (wy && Math.abs(p.x - n.x) < 2) side = "west";
          else if (wy && Math.abs(p.x - (n.x + n.width)) < 2) side = "east";
          if (!side) continue;
          const vert = side === "east" || side === "west";
          const key = `${n.id}|${side}|${vert ? n.height : n.width}`;
          seats.set(key, [...(seats.get(key) ?? []), { at: vert ? p.y : p.x, id: e.id }]);
          break;
        }
      }
    }
    for (const [key, members] of seats) {
      if (members.length < 2) continue;
      const sideLength = Number(key.slice(key.lastIndexOf("|") + 1));
      const need = Math.min(12, (sideLength - 6) / (members.length - 1));
      const sorted = [...members].sort((a, b) => a.at - b.at);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].at - sorted[i - 1].at;
        if (gap < 6) note("attachShared", `${key} ${sorted[i - 1].id}~${sorted[i].id} ${gap.toFixed(1)}px`);
        else if (gap < need * 0.8) note("attachTight", `${key} ${gap.toFixed(1)}px need ${need.toFixed(1)}`);
      }
    }

    const pinned: [number, number][] = scene.nodes.map((n) => [n.y, n.y + n.height]);
    for (const e of scene.edges) for (const l of e.labels) pinned.push([l.y, l.y + l.height]);
    for (const s of H) pinned.push([s.at - 1, s.at + 1]);
    pinned.sort((a, b) => a[0] - b[0]);
    let reach = 0;
    for (const [top, bottom] of pinned) {
      if (top - reach >= 30) note("deadBand", `${Math.round(top - reach)}px at y=${Math.round(reach)}`);
      reach = Math.max(reach, bottom);
    }
    // Dead height below the last pinned band is just as much a defect as a gap
    // between two of them, and only this check can see it.
    if (scene.height - reach >= 30)
      note("deadBand", `${Math.round(scene.height - reach)}px trailing at y=${Math.round(reach)}`);

    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const e of scene.edges) {
      const flow = model.flows.find((f) => f.id === e.id);
      const a = byId.get(flow?.from ?? "");
      const b = byId.get(flow?.to ?? "");
      if (!a || !b) continue;
      let len = 0;
      for (let i = 1; i < e.pts.length; i++)
        len += Math.abs(e.pts[i].x - e.pts[i - 1].x) + Math.abs(e.pts[i].y - e.pts[i - 1].y);
      const direct =
        Math.abs(a.x + a.width / 2 - b.x - b.width / 2) +
        Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
      if (direct > 0 && len > 2.2 * direct && len - direct > 400)
        note("longDetour", `${e.id} ${flow!.from}->${flow!.to} r=${(len / direct).toFixed(1)}`);
    }
  }
}

console.log(
  `swept ${examples.length}/${expected} drawings (${DISPOSITIONS.length} dispositions)\n`,
);
let failed = false;
if (unevaluated.length) {
  console.log(`  ✗ ${"unevaluated".padEnd(13)} ${unevaluated.length}  (every cell must render)`);
  for (const miss of unevaluated) console.log(`      ${miss}`);
  failed = true;
}
for (const kind of MUST_BE_ZERO) {
  const count = totals[kind] ?? 0;
  console.log(`  ${count === 0 ? "✓" : "✗"} ${kind.padEnd(13)} ${count}  (invariant: must be 0)`);
  if (count > 0) failed = true;
}
for (const kind of Object.keys(CEILING).sort()) {
  const count = totals[kind] ?? 0;
  const ok = count <= CEILING[kind];
  const arrow = count < CEILING[kind] ? ` — lower the ceiling to ${count}` : "";
  console.log(`  ${ok ? "✓" : "✗"} ${kind.padEnd(13)} ${count}  (ceiling ${CEILING[kind]})${arrow}`);
  if (!ok) failed = true;
}
if (detail) for (const h of hits) console.log(h);
if (failed) {
  console.error("\nsweep failed — a cell went unevaluated, an invariant broke, or a ceiling rose.");
  process.exit(1);
}
