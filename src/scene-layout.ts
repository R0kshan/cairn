/**
 * Stage 4: turns the validated `Model` into an absolute-positioned `Scene`
 * (nodes, edges, labels, canvas size) via elkjs layered layout. Builds the ELK
 * graph from measured node sizes, runs several candidate layouts for balanced
 * dispositions (`slide`/`page`) and picks the best fit — optionally deferring to
 * the folded layout (`slide-fold.ts`). `LaidOutNode`/`LaidOutEdge` describe an
 * ELK result after layout (coordinates populated) and are shared with slide-fold.
 */

import type { Model, Element } from "./models/ast.ts";
import type { ElkNode, ElkEdgeSection } from "elkjs/lib/elk.bundled.js";
import type { View } from "./views.ts";
import { measure, wrapText, flowLabelBox, techText, fontSizes } from "./text-metrics.ts";
import { foldedLayout } from "./slide-fold.ts";
import { getElk } from "./elk-engine.ts";
import { rerouteDetours } from "./route-detour.ts";
import { compactVertical } from "./compact.ts";
import { tidyEdges } from "./edge-tidy.ts";
import { subtreeIds, indexElementsById } from "./element-tree.ts";

/**
 * A node/edge as returned by elk *after* layout: every coordinate is populated,
 * unlike the input `ElkNode` where they are optional. Local to the render
 * pipeline; shared with slide-fold so both walk elk results the same way.
 */
export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: LaidOutNode[];
  edges?: LaidOutEdge[];
}
export interface LaidOutLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LaidOutEdge {
  id: string;
  container?: string;
  sections?: ElkEdgeSection[];
  labels?: LaidOutLabel[];
}

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

interface WalkedElkNode {
  id: string;
  x: number;
  y: number;
  node: SceneNode;
}

/**
 * IDs of top-level `external` elements that only ever feed data in (never
 * receive it back) — used by `partitionByOrder` views to place them upstream
 * of everything else instead of wherever elk's layered algorithm lands them.
 */
function computeIngressExternalElements(model: Model): Set<string> {
  const ingressExternalElements = new Set<string>();
  for (const element of model.elements) {
    if (element.kind !== "external") continue;
    const ids = new Set(subtreeIds(element));
    const feedsInto = model.flows.some((flow) => ids.has(flow.from) && !ids.has(flow.to));
    const receivesFrom = model.flows.some((flow) => ids.has(flow.to) && !ids.has(flow.from));
    if (feedsInto && !receivesFrom) ingressExternalElements.add(element.id);
  }
  return ingressExternalElements;
}

/** Converts an `Element` (and its children, recursively) into elk's input node shape. */
function toElkNode(
  element: Element,
  compact: boolean,
  containerFontSize: number,
  nodeFontSize: number,
): ElkNode {
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
      children: element.children.map((child) =>
        toElkNode(child, compact, containerFontSize, nodeFontSize),
      ),
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

/**
 * Recursively resolves every laid-out descendant of `elkNode` to absolute
 * coordinates (elk positions are parent-relative), producing one `SceneNode`
 * per descendant alongside the absolute origin later used to place its edges.
 */
function walkElkNodes(
  elkNode: LaidOutNode,
  offsetX: number,
  offsetY: number,
  kindOf: Map<string, Element>,
): WalkedElkNode[] {
  return (elkNode.children ?? []).flatMap((child) => {
    const absoluteX = offsetX + child.x;
    const absoluteY = offsetY + child.y;
    const element = kindOf.get(child.id)!;
    const node: SceneNode = {
      id: child.id,
      kind: element.kind,
      label: element.label ?? child.id,
      x: absoluteX,
      y: absoluteY,
      width: child.width,
      height: child.height,
      container: !!child.children?.length,
    };
    return [
      { id: child.id, x: absoluteX, y: absoluteY, node },
      ...walkElkNodes(child, absoluteX, absoluteY, kindOf),
    ];
  });
}

/**
 * Recursively collects every edge beneath `elkNode`, resolving its points and
 * labels to absolute coordinates via `origins` (see `walkElkNodes`). Numbered
 * flows additionally nudge their badge off the line, perpendicular to its
 * last segment.
 */
function collectSceneEdges(
  elkNode: LaidOutNode,
  origins: Record<string, { x: number; y: number }>,
  numbered: boolean,
): SceneEdge[] {
  const ownEdges = (elkNode.edges ?? []).map((edge) => {
    const origin = (edge.container && origins[edge.container]) || { x: 0, y: 0 };
    const section = edge.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
          x: point.x + origin.x,
          y: point.y + origin.y,
        }))
      : [];
    const labels: SceneLabel[] = (edge.labels ?? []).map((label) => {
      let labelX = label.x + origin.x,
        labelY = label.y + origin.y;
      if (numbered && points.length >= 2) {
        const last = points[points.length - 1],
          secondLast = points[points.length - 2];
        const segmentLength = Math.hypot(last.x - secondLast.x, last.y - secondLast.y) || 1;
        const unitX = (last.x - secondLast.x) / segmentLength,
          unitY = (last.y - secondLast.y) / segmentLength;
        const rawStepBack = 20 + label.width / 2;
        const stepBack =
          rawStepBack < 0 ? 0 : rawStepBack > segmentLength - 2 ? segmentLength - 2 : rawStepBack;
        let perpX = -unitY,
          perpY = unitX;
        if (perpY > 0) {
          perpX = -perpX;
          perpY = -perpY;
        }
        const offset = label.height / 2 + 2;
        labelX = last.x - unitX * stepBack + perpX * offset - label.width / 2;
        labelY = last.y - unitY * stepBack + perpY * offset - label.height / 2;
      }
      return {
        flowId: edge.id,
        text: label.text,
        x: labelX,
        y: labelY,
        width: label.width,
        height: label.height,
      };
    });
    return { id: edge.id, pts: points, labels };
  });
  const childEdges = (elkNode.children ?? []).flatMap((child) =>
    collectSceneEdges(child, origins, numbered),
  );
  return [...ownEdges, ...childEdges];
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

  const disposition = model.style.disposition;
  const ASPECT_TARGETS: Record<string, number | undefined> = {
    slide: 16 / 9,
    page: 0.71,
  };
  const aspectTarget = ASPECT_TARGETS[disposition];

  const ingressExternalElements = view.partitionByOrder
    ? computeIngressExternalElements(model)
    : new Set<string>();
  const INGRESS_PARTITION = -1,
    EGRESS_PARTITION = 900;

  const makeGraph = (
    direction: "RIGHT" | "DOWN",
    options?: { labelWrap?: number; tight?: boolean; minLayers?: boolean },
  ): ElkNode => ({
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
      const elkNode = toElkNode(element, compact, containerFontSize, nodeFontSize);
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

  const kindOf = new Map(indexElementsById(model.elements));

  const sceneFromResult = (result: LaidOutNode, layoutMs: number): Scene => {
    const origins: Record<string, { x: number; y: number }> = {
      root: { x: 0, y: 0 },
    };
    const walkedNodes = walkElkNodes(result, 0, 0, kindOf);
    const nodes = walkedNodes.map((walked) => walked.node);
    for (const walked of walkedNodes) origins[walked.id] = { x: walked.x, y: walked.y };

    const edges = collectSceneEdges(result, origins, numbered);

    const scene: Scene = {
      width: Math.ceil(result.width),
      height: Math.ceil(result.height),
      nodes,
      edges,
      layoutMs,
    };
    // Wrap-around detours only occur in RIGHT-direction layouts (issue #26);
    // DOWN layouts (page/tall) are left untouched.
    if (disposition !== "page" && disposition !== "tall") rerouteDetours(scene, model, numbered);
    // Straighten routing noise and separate flows sharing a node side, for
    // every edge — elk's as much as the rerouted ones.
    tidyEdges(scene);
    // Reclaim the bands elk sized for routes that no longer run there — every
    // disposition, since page/tall skip the reroute but not elk's spare space.
    compactVertical(scene);
    return scene;
  };

  const startTime = Date.now();
  let result: LaidOutNode;
  if (aspectTarget) {
    const layoutConfigs: ElkNode[] =
      disposition === "slide"
        ? [
            makeGraph("RIGHT"),
            makeGraph("RIGHT", { labelWrap: 16 }),
            makeGraph("RIGHT", { labelWrap: 14, tight: true }),
            makeGraph("RIGHT", { labelWrap: 14, tight: true, minLayers: true }),
          ]
        : [makeGraph("DOWN"), makeGraph("DOWN", { labelWrap: 16 })];
    const candidates = (await Promise.all(
      layoutConfigs.map((graph) => elk.layout(graph)),
    )) as unknown as LaidOutNode[];
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
        compactVertical(folded);
        return folded;
      }
    }
  } else {
    result = (await elk.layout(
      makeGraph(disposition === "tall" ? "DOWN" : "RIGHT"),
    )) as unknown as LaidOutNode;
  }
  const layoutMs = Date.now() - startTime;
  return sceneFromResult(result, layoutMs);
}
