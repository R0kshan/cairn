import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.ts";
import { validate } from "../src/validator.ts";
import { layout } from "../src/scene-layout.ts";
import { render } from "../src/svg-render.ts";
import { views } from "../src/views.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DISPOSITIONS = ["wide", "slide", "page", "tall"] as const;
const [SI, SN] = process.argv.find(a=>a.startsWith("--shard="))!.slice(8).split("/").map(Number);
type Box = { x: number; y: number; width: number; height: number };
type P = { x: number; y: number };
const segSq = (b: Box, a: P, c: P) => {
  const dx = Math.max(0, b.x - Math.max(a.x, c.x), Math.min(a.x, c.x) - (b.x + b.width));
  const dy = Math.max(0, b.y - Math.max(a.y, c.y), Math.min(a.y, c.y) - (b.y + b.height));
  return dx * dx + dy * dy;
};
const polySq = (b: Box, pts: P[]) => { let best = Infinity; for (let i=0;i+1<pts.length;i++) best = Math.min(best, segSq(b, pts[i], pts[i+1])); return best; };
const SLACK = 1;
let A = 0, B = 0, C = 0, flows = 0, drawings = 0;
const hitsA: string[] = [], hitsB: string[] = [], hitsC: string[] = [];

for (const file of readdirSync(join(ROOT, "examples"), { recursive: true, encoding: "utf8" })
  .map(f => f.replace(/\\/g, "/")).filter(f => f.endsWith(".cairn") && !f.includes("broken")).sort()
  .filter((_,i)=>i%SN===SI-1)) {
  const base = readFileSync(join(ROOT, "examples", file), "utf8").replace(/\r\n/g, "\n");
  for (const disp of DISPOSITIONS) {
    const tag = `${file.replace(".cairn","")}/${disp}`;
    let scene: any, model: any;
    try {
      const parsed = parse(base); model = parsed.model; model.style.disposition = disp;
      if ([...parsed.diags, ...validate(model)].some(d => d.severity === "error")) continue;
      scene = await layout(model, views[model.type!]);
      render(model, views[model.type!], scene);
    } catch { continue; }
    drawings++; flows += model.flows.length;
    for (const e of scene.edges) {
      if (e.pts.length < 2) continue;
      for (const l of e.labels) {
        if (!l.width || !l.height) continue;
        const box: Box = { x: l.x, y: l.y, width: l.width, height: l.height };
        const centre = { x: l.x + l.width/2, y: l.y + (l.textH>0 ? l.textH/2 : l.height/2) };
        const dot: Box = { x: centre.x, y: centre.y, width: 0, height: 0 };
        // the own segment the TEXT CENTRE sits on (the §4d run)
        let hostVert: boolean | null = null, bestD = Infinity;
        for (let i=0;i+1<e.pts.length;i++) {
          const d = segSq(dot, e.pts[i], e.pts[i+1]);
          if (d < bestD) { bestD = d; hostVert = Math.abs(e.pts[i].x - e.pts[i+1].x) < 0.5; }
        }
        const onLine = bestD <= 4; // ON_LINE_SLACK^2
        let anyF = "", parF = "", parInside = "";
        for (const o of scene.edges) {
          if (o.id === e.id || o.pts.length < 2) continue;
          if (polySq(box, o.pts) > SLACK) continue;
          if (!anyF) anyF = o.id;
          for (let i=0;i+1<o.pts.length;i++) {
            if (segSq(box, o.pts[i], o.pts[i+1]) > SLACK) continue;
            const vert = Math.abs(o.pts[i].x - o.pts[i+1].x) < 0.5;
            const horiz = Math.abs(o.pts[i].y - o.pts[i+1].y) < 0.5;
            if (!vert && !horiz) continue;
            if (vert !== hostVert) continue;
            parF = o.id;
            const at = vert ? o.pts[i].x : o.pts[i].y;
            const lo = vert ? box.x : box.y, hi = vert ? box.x+box.width : box.y+box.height;
            if (at > lo + 1 && at < hi - 1) parInside = o.id;
          }
        }
        const txt = l.text.replace(/\n/g," ");
        if (anyF) { B++; hitsB.push(`${tag} ${e.id} "${txt}" <- ${anyF}`); }
        if (parF && onLine) { A++; hitsA.push(`${tag} ${e.id} "${txt}" <- ${parF}`); }
        if (parInside && onLine) { C++; hitsC.push(`${tag} ${e.id} "${txt}" <- ${parInside}`); }
      }
    }
  }
}
writeFileSync(`/tmp/part-${SI}.json`, JSON.stringify({drawings,flows,A,B,C,hitsA,hitsB,hitsC}));
console.log(`shard ${SI}: drawings=${drawings} flows=${flows} A=${A} B=${B} C=${C}`);
