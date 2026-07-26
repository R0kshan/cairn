import type { Model, Element, View } from "./model.ts";
import { measure, wrapText, flowLabelBox, techText, fontSizes } from "./text-metrics.ts";
import { foldedLayout } from "./slide-fold.ts";
import { getElk } from "./elk-engine.ts";

export interface SceneNode {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  container: boolean;
}
export interface SceneLabel {
  flowId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SceneEdge {
  id: string;
  pts: { x: number; y: number }[];
  labels: SceneLabel[];
}
export interface Scene {
  width: number;
  height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  layoutMs: number;
}

export async function layout(model: Model, view: View): Promise<Scene> {
  const elk = await getElk();
  const businessObjectName = new Map(model.businessObjects.map((bo) => [bo.id, bo.name]));
  const numbered = model.style.flowText === "numbered";
  const compact = model.style.compact;
  const COMPACT_WRAP = 10;
  const {
    edge: edgeFontSize,
    node: nodeFontSize,
    cont: containerFontSize,
    scale: fontScale,
  } = fontSizes(model.style.font.size);

  function toElkNode(element: Element): any {
    if (element.children.length) {
      const lineCount = (element.label ?? element.id).split("\n").length;
      return {
        id: element.id,
        layoutOptions: {
          "elk.padding": `[top=${(compact ? 11 : 13) + lineCount * 14},left=${compact ? 7 : 9},bottom=${compact ? 7 : 9},right=${compact ? 7 : 9}]`,
        },
        labels: [
          {
            text: element.label ?? element.id,
            ...measure(element.label ?? element.id, containerFontSize),
          },
        ],
        children: element.children.map(toElkNode),
      };
    }
    const measured = measure(element.label ?? element.id, nodeFontSize);
    const isActor = element.kind === "actor";
    return {
      id: element.id,
      width: isActor
        ? Math.max(64, measure(element.label ?? element.id, nodeFontSize - 1.5).width + 8)
        : Math.max(compact ? 98 : 108, measured.width + (compact ? 10 : 12)),
      height: isActor
        ? 54 + ((element.label ?? element.id).split("\n").length - 1) * 11
        : Math.max(compact ? 36 : 38, measured.height + (compact ? 10 : 12)),
    };
  }

  const disposition = model.style.disposition;
  const ASPECT_TARGETS: Record<string, number | undefined> = {
    slide: 16 / 9,
    page: 0.71,
  };
  const aspectTarget = ASPECT_TARGETS[disposition];

  const ingressExternalElements = new Set<string>();
  if (view.partitionByOrder) {
    for (const element of model.elements) {
      if (element.kind !== "external") continue;
      const ids = new Set<string>();
      (function collect(child: Element) {
        ids.add(child.id);
        child.children.forEach(collect);
      })(element);
      const feedsInto = model.flows.some((flow) => ids.has(flow.from) && !ids.has(flow.to));
      const receivesFrom = model.flows.some((flow) => ids.has(flow.to) && !ids.has(flow.from));
      if (feedsInto && !receivesFrom) ingressExternalElements.add(element.id);
    }
  }
  const INGRESS_PARTITION = -1,
    EGRESS_PARTITION = 900;

  const makeGraph = (
    direction: "RIGHT" | "DOWN",
    options?: { labelWrap?: number; tight?: boolean; minLayers?: boolean },
  ) => ({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      ...(options?.tight
        ? {
            "elk.layered.spacing.nodeNodeBetweenLayers": "14",
            "elk.spacing.nodeNode": "10",
            "elk.spacing.edgeEdge": "8",
            "elk.spacing.edgeNode": "9",
          }
        : {}),
      ...(options?.minLayers ? { "elk.layered.layering.strategy": "LONGEST_PATH" } : {}),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.partitioning.activate": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.layered.feedbackEdges": "true",
      "elk.layered.thoroughness": "30",
      "elk.separateConnectedComponents": "false",
      "elk.layered.spacing.nodeNodeBetweenLayers": compact ? "10" : "16",
      "elk.spacing.nodeNode": compact ? "8" : "11",
      "elk.spacing.edgeEdge": compact ? "7" : "9",
      "elk.spacing.edgeNode": compact ? "8" : "10",
      "elk.spacing.edgeLabel": "2",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.edgeLabels.placement": "CENTER",
      "elk.padding": "[top=22,left=10,bottom=10,right=10]",
      ...(numbered && !options?.tight
        ? {
            "elk.spacing.nodeNode": "26",
            "elk.layered.spacing.nodeNodeBetweenLayers": "64",
            "elk.spacing.edgeEdge": "14",
            "elk.spacing.edgeNode": "18",
            "elk.layered.thoroughness": "80",
            "elk.layered.nodePlacement.favorStraightEdges": "true",
          }
        : {}),
    },
    children: model.elements.map((element, index) => {
      const elkNode = toElkNode(element);
      const partition = view.partitionByOrder
        ? element.kind === "actor" || element.kind === "actor-group"
          ? INGRESS_PARTITION
          : element.kind === "external"
            ? ingressExternalElements.has(element.id)
              ? INGRESS_PARTITION
              : EGRESS_PARTITION
            : view.partitions[element.kind] !== undefined
              ? 90 + view.partitions[element.kind]
              : index
        : (view.partitions[element.kind] ?? 1);
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        "elk.partitioning.partition": String(partition),
      };
      return elkNode;
    }),
    edges: model.flows.map((flow) => {
      if (numbered) {
        return {
          id: flow.id,
          sources: [flow.from],
          targets: [flow.to],
          labels: [
            {
              text: String(parseInt(flow.id.slice(1), 10)),
              width: Math.round(26 * fontScale),
              height: Math.round(17 * fontScale),
            },
          ],
        };
      }
      const wrap = options?.labelWrap ?? (compact ? COMPACT_WRAP : undefined);
      const raw = flow.label && wrap ? wrapText(flow.label, wrap) : flow.label;
      const chips = (flow.objects ?? []).map(
        (objectRef) => businessObjectName.get(objectRef.id) ?? objectRef.id,
      );
      const tech = techText(flow.tech);
      const text = raw || (tech ? tech : "");
      const subTitle = raw ? tech : undefined;
      return {
        id: flow.id,
        sources: [flow.from],
        targets: [flow.to],
        labels:
          text || chips.length
            ? [
                {
                  text,
                  ...flowLabelBox(text, chips, edgeFontSize, subTitle, fontScale),
                },
              ]
            : [],
      };
    }),
  });

  const kindOf = new Map<string, Element>();
  (function indexElements(elements: Element[]) {
    for (const element of elements) {
      kindOf.set(element.id, element);
      indexElements(element.children);
    }
  })(model.elements);

  const sceneFromResult = (result: any, layoutMs: number): Scene => {
    const origins: Record<string, { x: number; y: number }> = {
      root: { x: 0, y: 0 },
    };
    const nodes: SceneNode[] = [];
    (function walk(elkNode: any, offsetX: number, offsetY: number) {
      for (const child of elkNode.children ?? []) {
        const absoluteX = offsetX + child.x,
          absoluteY = offsetY + child.y;
        origins[child.id] = { x: absoluteX, y: absoluteY };
        const element = kindOf.get(child.id)!;
        nodes.push({
          id: child.id,
          kind: element.kind,
          label: element.label ?? child.id,
          x: absoluteX,
          y: absoluteY,
          width: child.width,
          height: child.height,
          container: !!child.children?.length,
        });
        walk(child, absoluteX, absoluteY);
      }
    })(result, 0, 0);

    const edges: SceneEdge[] = [];
    (function collect(elkNode: any) {
      for (const edge of elkNode.edges ?? []) {
        const origin = origins[edge.container] ?? { x: 0, y: 0 };
        const section = edge.sections?.[0];
        const points = section
          ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
              (point: any) => ({
                x: point.x + origin.x,
                y: point.y + origin.y,
              }),
            )
          : [];
        const labels: SceneLabel[] = (edge.labels ?? []).map((label: any) => {
          let x = label.x + origin.x,
            y = label.y + origin.y;
          if (numbered && points.length >= 2) {
            const last = points[points.length - 1],
              secondLast = points[points.length - 2];
            const segmentLength = Math.hypot(last.x - secondLast.x, last.y - secondLast.y) || 1;
            const unitX = (last.x - secondLast.x) / segmentLength,
              unitY = (last.y - secondLast.y) / segmentLength;
            const stepBack = Math.min(segmentLength - 2, 20 + label.width / 2);
            let perpX = -unitY,
              perpY = unitX;
            if (perpY > 0) {
              perpX = -perpX;
              perpY = -perpY;
            }
            const offset = label.height / 2 + 2;
            x = last.x - unitX * stepBack + perpX * offset - label.width / 2;
            y = last.y - unitY * stepBack + perpY * offset - label.height / 2;
          }
          return {
            flowId: edge.id,
            text: label.text,
            x,
            y,
            width: label.width,
            height: label.height,
          };
        });
        edges.push({ id: edge.id, pts: points, labels });
      }
      (elkNode.children ?? []).forEach(collect);
    })(result);

    return {
      width: Math.ceil(result.width),
      height: Math.ceil(result.height),
      nodes,
      edges,
      layoutMs,
    };
  };

  const startTime = Date.now();
  let result: any;
  if (aspectTarget) {
    const layoutConfigs: any[] =
      disposition === "slide"
        ? [
            makeGraph("RIGHT"),
            makeGraph("RIGHT", { labelWrap: 16 }),
            makeGraph("RIGHT", { labelWrap: 14, tight: true }),
            makeGraph("RIGHT", { labelWrap: 14, tight: true, minLayers: true }),
          ]
        : [makeGraph("DOWN"), makeGraph("DOWN", { labelWrap: 16 })];
    const candidates = await Promise.all(layoutConfigs.map((graph) => elk.layout(graph)));
    const preferWide = disposition === "slide";
    const orientedLayouts = candidates.filter((layoutResult) =>
      preferWide
        ? layoutResult.width >= layoutResult.height
        : layoutResult.height >= layoutResult.width,
    );
    const viableLayouts = orientedLayouts.length ? orientedLayouts : candidates;
    const frameSize =
      disposition === "slide" ? { width: 1280, height: 720 } : { width: 700, height: 1000 };
    const fitScore = (layoutResult: { width: number; height: number }) =>
      -Math.min(frameSize.width / layoutResult.width, frameSize.height / layoutResult.height);
    result = viableLayouts.reduce((candidateA, candidateB) =>
      fitScore(candidateA) <= fitScore(candidateB) ? candidateA : candidateB,
    );
    if (disposition === "slide") {
      const folded = await foldedLayout(model, view, elk);
      if (folded && fitScore(result) >= fitScore(folded) * 1.1) {
        folded.layoutMs = Date.now() - startTime;
        return folded;
      }
    }
  } else {
    result = await elk.layout(makeGraph(disposition === "tall" ? "DOWN" : "RIGHT"));
  }
  const layoutMs = Date.now() - startTime;
  return sceneFromResult(result, layoutMs);
}
