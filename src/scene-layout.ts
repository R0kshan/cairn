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
import { rerouteDetours, titleBoxesOf, type TitleBox } from "./route-detour.ts";
import { compactVertical } from "./compact.ts";
import { optimiseRoutes, tidyEdges } from "./edge-tidy.ts";
import { anchorFlowLabels } from "./label-anchor.ts";
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
  /**
   * Height of the *text* rows inside the box, which sit at its top; a
   * protocol line and business-object chips fill the rest below them. Seating a
   * label on its run means centring this, not the box — centre the box and the
   * run lands between the text and the chip, which is neither on the line nor
   * under it. 0 when the label is chips only.
   */
  textH: number;
}
export interface SceneEdge {
  id: string;
  pts: { x: number; y: number }[];
  labels: SceneLabel[];
  /**
   * Set by `route-detour` on edges it sent through a top/bottom channel.
   * Those wrap around by design (invariant §11), so the attachment-direction
   * rule (§4c) and its `attachAway` gate exempt them.
   */
  detour?: boolean;
  /**
   * The route this flow had before `optimiseRoutes` moved it. Kept so the
   * renderer can undo a repair that cost some label its seat — that verdict is
   * only reachable after label settling, which happens during rendering.
   */
  repairedFrom?: { x: number; y: number }[];
}
export interface Scene {
  width: number;
  height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  layoutMs: number;
  /**
   * Best (lowest) tier `optimiseRoutes` paid at across the repairs it kept.
   *
   * The renderer audits those repairs for label collateral the router could not
   * see, and the ladder's rule for that is "a loss at tier T is payable only by
   * a gain at a tier strictly better than T" — so the audit has to know what
   * the repair bought. Absent when nothing was repaired.
   */
  repairTier?: number;
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
  edgeFontSize: number,
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
        // Mirrors `measure()` in text-metrics, which is what sized the box.
        textH: label.text ? label.text.split("\n").length * (edgeFontSize + 3) + 4 : 0,
      };
    });
    return { id: edge.id, pts: points, labels };
  });
  const childEdges = (elkNode.children ?? []).flatMap((child) =>
    collectSceneEdges(child, origins, numbered, edgeFontSize),
  );
  return [...ownEdges, ...childEdges];
}

/**
 * Mirrors a scene across the diagonal. `route-detour` reasons in one
 * orientation — flows run right-to-left and channels sit above or below. A
 * DOWN layout is the same problem rotated: its backward flows run bottom-to-top
 * and want channels to the left or right. Transposing in and out lets it run
 * through the very same rules (and the same gated invariants) instead of a
 * second, parallel implementation.
 *
 * Label boxes swap with everything else on the way in, so lane spacing budgets
 * a label's width where the drawing needs width; the text itself is never
 * rotated, which is why title bands are computed before transposing.
 */
function transpose(scene: Scene, titleBoxes: TitleBox[]): void {
  for (const node of scene.nodes) {
    [node.x, node.y] = [node.y, node.x];
    [node.width, node.height] = [node.height, node.width];
  }
  for (const edge of scene.edges) {
    for (const point of edge.pts) [point.x, point.y] = [point.y, point.x];
    for (const label of edge.labels) {
      [label.x, label.y] = [label.y, label.x];
      [label.width, label.height] = [label.height, label.width];
    }
  }
  for (const box of titleBoxes) {
    [box.x, box.y] = [box.y, box.x];
    [box.width, box.height] = [box.height, box.width];
  }
  [scene.width, scene.height] = [scene.height, scene.width];
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

    const edges = collectSceneEdges(result, origins, numbered, edgeFontSize);

    const scene: Scene = {
      width: Math.ceil(result.width),
      height: Math.ceil(result.height),
      nodes,
      edges,
      layoutMs,
    };
    // Issue #26 applies to every disposition. A DOWN layout wraps its backward
    // flows around the sides rather than the top, so it is routed through the
    // same pass with the scene mirrored across the diagonal.
    const titleBoxes = titleBoxesOf(scene, model);
    const sideways = disposition === "page" || disposition === "tall";
    if (sideways) transpose(scene, titleBoxes);
    rerouteDetours(scene, model, numbered, titleBoxes);
    if (sideways) transpose(scene, titleBoxes);
    // Straighten routing noise and separate flows sharing a node side, for
    // every edge — elk's as much as the rerouted ones.
    tidyEdges(scene, titleBoxes);
    // Every pass above moves routes without moving the labels that name them.
    // Put each label back on its own flow before anything measures where labels
    // are — `compact` below is the first thing that does.
    anchorFlowLabels(scene, titleBoxes);
    // Reclaim the bands elk sized for routes that no longer run there — every
    // disposition, since elk leaves spare corridors whether or not the reroute
    // above moved anything.
    compactVertical(scene);
    // Route repair runs *after* compaction, not before it. `compact` shifts
    // every y through a monotone map, which shrinks the gaps a route was judged
    // on — so an optimiser placed above it validates geometry that compaction
    // then narrows into near-parallel runs, tight attachments and micro-jogs.
    // Nothing below this line may move edge geometry.
    //
    // Title boxes are re-derived here, not reused. The set captured above was
    // measured before `compactVertical`, which shifts every y through a monotone
    // map and therefore moves the containers whose names those boxes describe.
    // Handing the stale set to a pass that runs *after* compaction makes it
    // dodge the bands where they used to be and strike them where they now are —
    // which is exactly what `titleStruck` reported on 17 drawings, all of them
    // tier 0 regressions the router believed it was refusing.
    //
    // A route change can cost a *different* flow's label its seat: the anchorer
    // resolves the collisions a move creates by taking some label off its run,
    // and which one it picks cannot be predicted from the moved edge alone. So
    // the repair is allowed to try, and then audited — any flow whose label was
    // on its run before and is not after has its route put back. That keeps the
    // ladder's rule (a Tier 1 loss is only ever bought by a Tier 0 gain)
    // without refusing every move that merely *might* cost a label.
    // Deep copy: `optimiseRoutes` finishes by squaring every edge, which mutates
    // Point objects in place, so a shallow snapshot is not a snapshot.
    const routesBefore = new Map(
      scene.edges.map((edge) => [edge.id, edge.pts.map((point) => ({ ...point }))]),
    );
    const settledTitles = titleBoxesOf(scene, model);
    optimiseRoutes(scene, settledTitles);
    anchorFlowLabels(scene, settledTitles);
    // Record *every* edge the repair moved. Restricting this to edges whose
    // label was seated beforehand made the rollback partial — the renderer put
    // some flows back while leaving the rest where the optimiser had moved them,
    // and a drawing that is half repaired is not a drawing either pass ever
    // evaluated. That mixture is what produced `coincident` runs, a must-be-zero
    // breach. Whether the repair was worth keeping is judged whole-drawing in
    // the renderer; this only has to make the undo complete.
    for (const edge of scene.edges) {
      const original = routesBefore.get(edge.id);
      if (!original) continue;
      const moved =
        original.length !== edge.pts.length ||
        original.some(
          (point, index) =>
            Math.abs(point.x - edge.pts[index].x) > 0.01 ||
            Math.abs(point.y - edge.pts[index].y) > 0.01,
        );
      if (moved) edge.repairedFrom = original;
    }
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
        // The folded layout hand-routes its own connectors, so it keeps them —
        // but the endpoint invariants apply to it like everything else.
        tidyEdges(folded, titleBoxesOf(folded, model), true);
        anchorFlowLabels(folded, titleBoxesOf(folded, model));
        compactVertical(folded);
        // The folded layout hand-routes its connectors, so the optimiser is a
        // no-op on it by design (`folded`), but the call keeps the two pipelines
        // structurally identical.
        optimiseRoutes(folded, titleBoxesOf(folded, model), true);
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
