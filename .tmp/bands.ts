import { readFileSync } from "node:fs";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { views } from "../src/views.ts";
import { titleBoxesOf } from "../src/route-detour.ts";
const base = readFileSync(process.argv[2], "utf8").replace(/\r\n/g, "\n");
const parsed = parse(base); const model = parsed.model;
model.style.disposition = (process.argv[3] ?? "page") as any;
validate(model);
const scene = await layout(model, views[model.type!]);
render(model, views[model.type!], scene);
for (const b of titleBoxesOf(scene, model))
  console.log(`BAND x=${b.x.toFixed(0)}..${(b.x+b.width).toFixed(0)} y=${b.y.toFixed(0)}..${(b.y+b.height).toFixed(0)}`);
console.log(`SCENE ${scene.width.toFixed(0)} x ${scene.height.toFixed(0)}`);
