import { readFileSync } from "node:fs";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { views } from "../src/views.ts";

const file = process.argv[2];
const disp = process.argv[3] ?? "wide";
const base = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const parsed = parse(base);
const model = parsed.model;
model.style.disposition = disp as any;
validate(model);
const scene = await layout(model, views[model.type!]);
render(model, views[model.type!], scene);
for (const n of scene.nodes) console.log(`NODE ${n.id} ${n.container?"[C]":"   "} x=${n.x.toFixed(0)} y=${n.y.toFixed(0)} w=${n.width.toFixed(0)} h=${n.height.toFixed(0)}`);
for (const e of scene.edges) {
  console.log(`EDGE ${e.id} ${e.source}->${e.target}  ${e.pts.map((p:any)=>`(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(" ")}`);
  for (const l of e.labels) {
    console.log(`    label "${l.text.replace(/\n/g," ")}" box=[${l.x.toFixed(0)},${l.y.toFixed(0)} ${l.width.toFixed(0)}x${l.height.toFixed(0)}] textH=${l.textH}`);
  }
}
