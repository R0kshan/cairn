import { getElk } from "../src/elk-engine.ts";

const elk = await getElk();
const graph: any = {
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.feedbackEdges": "true",
  },
  children: [
    {
      id: "A",
      width: 100,
      height: 50,
      layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
      ports: [{ id: "A_out", width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } }],
    },
    { id: "B", width: 100, height: 50 },
    {
      id: "C",
      width: 100,
      height: 50,
      layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
      ports: [{ id: "C_in", width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } }],
    },
  ],
  edges: [
    { id: "e1", sources: ["A"], targets: ["B"] },
    { id: "e2", sources: ["B"], targets: ["C"] },
    // backward edge C->A, constrained: out C EAST? no — toward A (west) => WEST? test both
    { id: "e3", sources: ["C_in"], targets: ["A_out"] },
  ],
};
const result: any = await elk.layout(graph);
const dump = (node: any, ox = 0, oy = 0) => {
  const x = (node.x ?? 0) + ox;
  const y = (node.y ?? 0) + oy;
  console.log(`NODE ${node.id} x=${x} y=${y} w=${node.width} h=${node.height}`);
  for (const p of node.ports ?? []) console.log(`  PORT ${p.id} x=${x + (p.x ?? 0)} y=${y + (p.y ?? 0)}`);
  for (const e of node.edges ?? []) {
    const s = e.sections?.[0];
    if (!s) continue;
    console.log(
      `EDGE ${e.id} ${[s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: any) => `${(p.x + x).toFixed(0)},${(p.y + y).toFixed(0)}`).join(" ")}`,
    );
  }
  for (const c of node.children ?? []) dump(c, x, y);
};
dump(result);
