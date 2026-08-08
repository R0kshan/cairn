import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { layout } from "../src/scene-layout.ts";
import { views } from "../src/views.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? "application-compact";
const disp = process.argv[3] ?? "page";
const base = readFileSync(join(ROOT, "examples", `${file}.cairn`), "utf8").replace(/\r\n/g, "\n");
const model = parse(base).model;
model.style.disposition = disp as typeof model.style.disposition;
const scene = await layout(model, views[model.type!]);

const ATTACH_AWAY_TOL = 24;
const byId = new Map(scene.nodes.map((n) => [n.id, n]));
for (const e of scene.edges) {
  if (e.pts.length < 2 || e.detour) continue;
  const flow = model.flows.find((f) => f.id === e.id);
  const from = byId.get(flow?.from ?? "");
  const to = byId.get(flow?.to ?? "");
  if (!from || !to) continue;
  const centerOf = (n: typeof from) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  const away = (seg: { x: number; y: number }, target: { x: number; y: number }): boolean =>
    (Math.abs(seg.x) >= 0.5 && Math.abs(target.x) > ATTACH_AWAY_TOL && seg.x * target.x < 0) ||
    (Math.abs(seg.y) >= 0.5 && Math.abs(target.y) > ATTACH_AWAY_TOL && seg.y * target.y < 0);
  const p0 = e.pts[0];
  const p1 = e.pts[1];
  const pn = e.pts[e.pts.length - 1];
  const pm = e.pts[e.pts.length - 2];
  const toCenter = centerOf(to);
  const fromCenter = centerOf(from);
  if (away({ x: p1.x - p0.x, y: p1.y - p0.y }, { x: toCenter.x - p0.x, y: toCenter.y - p0.y }))
    console.log(
      `DEPART ${e.id} ${flow!.from}->${flow!.to} pts=${e.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}`,
    );
  if (away({ x: pn.x - pm.x, y: pn.y - pm.y }, { x: pn.x - fromCenter.x, y: pn.y - fromCenter.y }))
    console.log(
      `ARRIVE ${e.id} ${flow!.from}->${flow!.to} pts=${e.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}`,
    );
}
