import { readFileSync } from "node:fs";
import { getElk } from "../src/elk-engine.ts";

const elk = await getElk();
const graph = JSON.parse(readFileSync(".tmp/constrained-graph.json", "utf8"));

const variants: Record<string, (g: any) => any> = {
  asIs: (g) => g,
  noPartition: (g) => {
    delete g.layoutOptions["elk.partitioning.activate"];
    for (const c of g.children) if (c.layoutOptions) delete c.layoutOptions["elk.partitioning.partition"];
    return g;
  },
  noFeedback: (g) => {
    delete g.layoutOptions["elk.layered.feedbackEdges"];
    return g;
  },
  size1: (g) => {
    const walk = (n: any) => {
      for (const p of n.ports ?? []) {
        p.width = 1;
        p.height = 1;
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(g);
    return g;
  },
  orderOnly: (g) => {
    const walk = (n: any) => {
      if (n.layoutOptions?.["elk.portConstraints"] === "FIXED_SIDE")
        n.layoutOptions["elk.portConstraints"] = "FIXED_ORDER";
      for (const c of n.children ?? []) walk(c);
    };
    walk(g);
    return g;
  },
  ratio: (g) => {
    const walk = (n: any) => {
      if (n.layoutOptions?.["elk.portConstraints"] === "FIXED_SIDE")
        n.layoutOptions["elk.portConstraints"] = "FIXED_RATIO";
      for (const c of n.children ?? []) walk(c);
    };
    walk(g);
    return g;
  },
};

for (const [name, mutate] of Object.entries(variants)) {
  const g = mutate(JSON.parse(JSON.stringify(graph)));
  try {
    const result: any = await elk.layout(g);
    console.log(`${name}: OK ${result.width.toFixed(0)}x${result.height.toFixed(0)}`);
  } catch (error) {
    console.log(`${name}: CRASH ${String(error).slice(0, 90)}`);
  }
}
