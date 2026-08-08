import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { views } from "../src/views.ts";
import { titleBoxesOf } from "../src/route-detour.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? "large";
const disp = process.argv[3] ?? "slide";
const want = new Set(process.argv.slice(4));
const base = readFileSync(join(ROOT, "examples", `${file}.cairn`), "utf8").replace(/\r\n/g, "\n");
const parsed = parse(base);
const model = parsed.model;
model.style.disposition = disp as typeof model.style.disposition;
const scene = await layout(model, views[model.type!]);
render(model, views[model.type!], scene);
for (const b of titleBoxesOf(scene, model))
  console.log(`TITLE ${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}x${b.height.toFixed(1)}`);

for (const n of scene.nodes) {
  if (n.container) continue;
  console.log(
    `NODE ${n.id} x=${n.x.toFixed(1)} y=${n.y.toFixed(1)} w=${n.width.toFixed(1)} h=${n.height.toFixed(1)}`,
  );
}
const flowById = new Map(model.flows.map((f) => [f.id, f]));
for (const e of scene.edges) {
  const flow = flowById.get(e.id);
  if (!flow) continue;
  if (want.size && !want.has(e.id)) continue;
  console.log(
    `EDGE ${e.id} ${flow.from}->${flow.to}${e.detour ? " DETOUR" : ""} pts=${e.pts
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ")}`,
  );
  if (e.repairedFrom)
    console.log(
      `  REPAIRED_FROM pts=${e.repairedFrom
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ")}`,
    );
  for (const l of e.labels)
    console.log(
      `  LABEL ${flow.label} x=${l.x.toFixed(1)} y=${l.y.toFixed(1)} w=${l.width.toFixed(1)} h=${l.height.toFixed(1)} textH=${l.textH}`,
    );
}
