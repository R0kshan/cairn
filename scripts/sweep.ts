/**
 * Readability sweep: builds every example in every disposition and counts
 * layout defects by kind. Run with `npm run sweep`.
 *
 * Two kinds of gate:
 *
 * - `MUST_BE_ZERO` — invariants. A flow slanted off orthogonal, dragged across
 *   a node box, or leaving a band of dead height is a bug, full stop.
 * - `CEILING_RATE` — a ratchet over debt that cannot be zero yet, expressed as
 *   defects per swept flow-instance (edge × disposition) rather than a raw
 *   count. These defects scale with how many flows the corpus contains, so a
 *   rate is what stays comparable as examples/fixtures are added — a raw
 *   count would spuriously fail every time the corpus grows even though
 *   nothing got worse per drawing. Lower a rate whenever a change earns it —
 *   never raise one to make a run pass.
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

const MUST_BE_ZERO = ["overlaps", "diagonal", "throughBox", "deadBand", "coincident", "attachShared"] as const;
// Calibrated against the corpus at the time recursive discovery started
// covering examples/dispositions and examples/themes (4352 flow-instances,
// 288 drawings): rate = count / totalFlows, rounded up slightly for stability.
const CEILING_RATE: Record<string, number> = {
  attachTight: 0.0018382,
  "jog<=6": 0.0294117,
  "jog<=20": 0.1360294,
  nearParallel: 0.0167738,
  longDetour: 0.0500919,
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
const failures: string[] = [];
let totalFlows = 0;

for (const file of readdirSync(join(ROOT, "examples"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".cairn") && !f.includes("broken"))
  .sort()) {
  const base = readFileSync(join(ROOT, "examples", file), "utf8").replace(/\r\n/g, "\n");
  for (const disp of DISPOSITIONS) {
    let scene: Awaited<ReturnType<typeof layout>>;
    let model: ReturnType<typeof parse>["model"];
    let overlaps: number;
    try {
      // Parse first, then force the disposition post-parse — some fixtures
      // (examples/dispositions/*) carry their own `style { disposition }`,
      // and a source style must never win over the one this matrix cell tests.
      const parsed = parse(base);
      model = parsed.model;
      model.style.disposition = disp;
      const errors = [...parsed.diags, ...validate(model)].filter((d) => d.severity === "error");
      if (errors.length) {
        failures.push(`${file.replace(".cairn", "")}/${disp}: ${errors.length} validation error(s) — ${errors.map((d) => d.code).join(", ")}`);
        continue;
      }
      scene = await layout(model, views[model.type!]);
      overlaps = render(model, views[model.type!], scene).overlapsAfter;
    } catch (e) {
      failures.push(`${file.replace(".cairn", "")}/${disp}: exception — ${(e as Error).message}`);
      continue;
    }
    const tag = `${file.replace(".cairn", "")}/${disp}`;
    examples.push(tag);
    totalFlows += model.flows.length;
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
    let sceneBot = 0;
    for (const [top, bottom] of pinned) {
      if (top - reach >= 30) note("deadBand", `${Math.round(top - reach)}px at y=${Math.round(reach)}`);
      reach = Math.max(reach, bottom);
      if (bottom > sceneBot) sceneBot = bottom;
    }
    const remain = sceneBot - reach;
    if (remain >= 30) note("deadBand", `${Math.round(remain)}px trailing at y=${Math.round(reach)}`);

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
  `swept ${examples.length} drawings (${DISPOSITIONS.length} dispositions, ${totalFlows} flow-instances)\n`,
);
let failed = false;
for (const kind of MUST_BE_ZERO) {
  const count = totals[kind] ?? 0;
  console.log(`  ${count === 0 ? "✓" : "✗"} ${kind.padEnd(13)} ${count}  (invariant: must be 0)`);
  if (count > 0) failed = true;
}
for (const kind of Object.keys(CEILING_RATE).sort()) {
  const count = totals[kind] ?? 0;
  const rate = totalFlows > 0 ? count / totalFlows : 0;
  const ceiling = Math.ceil(CEILING_RATE[kind] * totalFlows);
  const ok = count <= ceiling;
  const arrow = count < ceiling ? ` — lower the rate to ${rate.toFixed(5)}` : "";
  console.log(
    `  ${ok ? "✓" : "✗"} ${kind.padEnd(13)} ${count}  (rate ${rate.toFixed(5)}/flow, ceiling ${ceiling} @ ${CEILING_RATE[kind]}/flow)${arrow}`,
  );
  if (!ok) failed = true;
}
if (detail) for (const h of hits) console.log(h);
if (failures.length) {
  console.log(`\nfailures (${failures.length}):`);
  for (const f of failures) console.log(`  ${f}`);
  failed = true;
}
if (failed) {
  console.error("\nsweep failed");
  process.exit(1);
}
