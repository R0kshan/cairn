import { readFileSync } from "node:fs";
import { getElk } from "../src/elk-engine.ts";

const elk = await getElk();
const g = JSON.parse(readFileSync(".tmp/constrained-graph.json", "utf8"));
const r: any = await elk.layout(g);
const walk = (n: any, ox: number, oy: number) => {
  const x = (n.x ?? 0) + ox;
  const y = (n.y ?? 0) + oy;
  if (["BUS", "JOBS", "API", "CORE"].includes(n.id))
    console.log("NODE", n.id, x.toFixed(1), y.toFixed(1), n.width, n.height);
  for (const p of n.ports ?? [])
    console.log("PORT", p.id, "at", (x + p.x).toFixed(1), (y + p.y).toFixed(1), "size", p.width, p.height);
  for (const e of n.edges ?? []) {
    const s = e.sections?.[0];
    if (s && e.id === "F04")
      console.log(
        "F04",
        [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
          .map((p: any) => `${(p.x + x).toFixed(1)},${(p.y + y).toFixed(1)}`)
          .join(" "),
      );
  }
  for (const c of n.children ?? []) walk(c, x, y);
};
walk(r, 0, 0);
