import { getElk } from "../src/elk-engine.ts";

const elk = await getElk();

const base = (variant: string): any => {
  const portSize = variant === "size1" ? 1 : 0;
  const busPorts =
    variant === "noNested"
      ? [{ id: "BUS#out", width: portSize, height: portSize, layoutOptions: { "elk.port.side": "SOUTH" } }]
      : [
          { id: "F04#out", width: portSize, height: portSize, layoutOptions: { "elk.port.side": "SOUTH" } },
          { id: "F03#in", width: portSize, height: portSize, layoutOptions: { "elk.port.side": "WEST" } },
        ];
  const jobsPorts =
    variant === "noNested" || variant === "topOnly"
      ? []
      : [
          { id: "F04#in", width: portSize, height: portSize, layoutOptions: { "elk.port.side": "NORTH" } },
          { id: "F06#in", width: portSize, height: portSize, layoutOptions: { "elk.port.side": "WEST" } },
          { id: "F07#out", width: portSize, height: portSize, layoutOptions: { "elk.port.side": "EAST" } },
        ];
  const constrain = (node: any, ports: any[]) => {
    if (!ports.length) return;
    node.layoutOptions = { ...node.layoutOptions, "elk.portConstraints": "FIXED_SIDE" };
    node.ports = ports;
  };
  const bus: any = { id: "BUS", width: 100, height: 50 };
  constrain(bus, busPorts);
  const jobs: any = { id: "JOBS", width: 100, height: 50 };
  constrain(jobs, jobsPorts);
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.feedbackEdges": "true",
      "elk.partitioning.activate": "true",
    },
    children: [
      {
        id: "TEAM",
        layoutOptions: { "elk.padding": "[top=20,left=8,bottom=8,right=8]" },
        children: [
          { id: "DEV", width: 100, height: 50 },
          { id: "OPS", width: 100, height: 50 },
        ],
      },
      {
        id: "CORE",
        layoutOptions: { "elk.padding": "[top=20,left=8,bottom=8,right=8]" },
        children: [{ id: "API", width: 100, height: 50 }, jobs],
      },
      bus,
      { id: "DB", width: 100, height: 50 },
      { id: "PAY", width: 100, height: 50 },
    ],
    edges: [
      { id: "F01", sources: ["DEV"], targets: ["API"] },
      { id: "F02", sources: ["API"], targets: ["DB"] },
      { id: "F03", sources: ["API"], targets: [variant === "noNested" || variant === "topOnly" ? "BUS" : "F03#in"] },
      { id: "F04", sources: [variant === "noNested" || variant === "topOnly" ? "BUS" : "F04#out"], targets: [variant === "noNested" || variant === "topOnly" ? "JOBS" : "F04#in"] },
      { id: "F05", sources: ["API"], targets: ["PAY"] },
      { id: "F06", sources: ["OPS"], targets: [variant === "noNested" || variant === "topOnly" ? "JOBS" : "F06#in"] },
      { id: "F07", sources: [variant === "noNested" || variant === "topOnly" ? "JOBS" : "F07#out"], targets: ["DB"] },
    ],
  };
};

for (const variant of ["plain", "ports", "size1", "topOnly"]) {
  try {
    const result: any = await elk.layout(base(variant === "plain" ? "none" : variant));
    console.log(`${variant}: OK ${result.width.toFixed(0)}x${result.height.toFixed(0)}`);
  } catch (error) {
    console.log(`${variant}: CRASH ${String(error).slice(0, 90)}`);
  }
}
