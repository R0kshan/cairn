import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { layout } from "../src/scene-layout.ts";
import { views } from "../src/views.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = readFileSync(join(ROOT, "examples", "application-large-fr.cairn"), "utf8").replace(/\r\n/g, "\n");
const model = parse(base).model;
model.style.disposition = "wide" as typeof model.style.disposition;
const scene = await layout(model, views[model.type!]);

const edge = scene.edges.find((e) => e.id === "F19")!;
console.log("F19 pts:", edge.pts.map((p) => `${p.x},${p.y}`).join(" "));
const a = edge.pts[0];
const b = edge.pts[1];
const run = { vert: Math.abs(a.x - b.x) < 0.5, at: Math.abs(a.x - b.x) < 0.5 ? a.x : a.y, lo: 0, hi: 0 };
run.lo = run.vert ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
run.hi = run.vert ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
console.log("run:", JSON.stringify(run));
for (const n of scene.nodes) {
  const spanLo = run.vert ? n.y : n.x;
  const spanHi = run.vert ? n.y + n.height : n.x + n.width;
  const shared = Math.min(run.hi, spanHi) - Math.max(run.lo, spanLo);
  if (shared <= 24) continue;
  const nearLo = run.vert ? n.x : n.y;
  const nearHi = run.vert ? n.x + n.width : n.y + n.height;
  const gap = Math.min(Math.abs(run.at - nearLo), Math.abs(run.at - nearHi));
  if (gap < 8) console.log(`candidate ${n.id} container=${n.container} shared=${shared.toFixed(1)} gap=${gap.toFixed(1)} side=${run.at < (nearLo + nearHi) / 2 ? "lo" : "hi"}`);
}
