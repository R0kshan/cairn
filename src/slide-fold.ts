/**
 * Alternative "folded" layout for `slide` disposition: arranges source / middle
 * / sink partitions into columns with hand-routed orthogonal connectors through
 * left/right gutters, so wide source→sink diagrams fit a 16:9 frame better than
 * the default flow. Lays out each middle group with ELK, then places columns and
 * routes inter-group flows itself. `LaneAllocator` assigns non-overlapping lanes
 * to parallel connectors. Returns `null` when folding doesn't apply.
 *
 * `foldedLayout` runs its phases in a fixed order, and each one depends on the
 * frame the previous fixed: lay the middle groups out with elk, size the source
 * and sink columns, classify the inter-group flows, derive the coordinate frame
 * from what those demand, place the nodes in it, then route the connectors.
 */

import type { Model, Element } from "./models/ast.ts";
import type { ELK, ElkNode } from "elkjs/lib/elk.bundled.js";
import type { View } from "./views.ts";
import type { Scene, SceneNode, SceneEdge, SceneLabel, LaidOutNode } from "./scene-layout.ts";
import {
  measure,
  wrapText,
  nodeSize,
  flowLabelBox,
  techText,
  fontSizes,
  GLYPH_GUTTER,
} from "./text-metrics.ts";
import type { Box, Point } from "./geometry.ts";
import { subtreeElements, indexElementsById } from "./element-tree.ts";

const PAD_TOP = 30,
  PAD = 12;
const LANE_STEP = 10;
const LANE_V = 11;
const LABEL_WRAP = 16;

type Flow = Model["flows"][number];

class LaneAllocator {
  lanes: { rangeStart: number; rangeEnd: number }[][] = [];
  alloc(intervalStart: number, intervalEnd: number): number {
    const rangeStart = Math.min(intervalStart, intervalEnd) - 4;
    const rangeEnd = Math.max(intervalStart, intervalEnd) + 4;
    for (let laneIndex = 0; laneIndex < this.lanes.length; laneIndex++) {
      const hasOverlap = this.lanes[laneIndex].some(
        (existingInterval) =>
          existingInterval.rangeStart < rangeEnd && rangeStart < existingInterval.rangeEnd,
      );
      if (hasOverlap) continue;
      this.lanes[laneIndex].push({ rangeStart, rangeEnd });
      return laneIndex;
    }
    this.lanes.push([{ rangeStart, rangeEnd }]);
    return this.lanes.length - 1;
  }
}

interface WalkedFoldNode {
  id: string;
  origin: Point;
  isPort: boolean;
  node?: SceneNode;
  box?: Box;
}

interface CollectedFoldEdges {
  edges: SceneEdge[];
  edgePoints: [string, Point[]][];
}

interface ColGroup {
  element: Element;
  width: number;
  height: number;
  blocks: {
    element: Element;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

type Cls = "A" | "B" | "C" | "D" | "E" | "X";

/** Font sizes and label helpers derived from the model's style, resolved once. */
interface FoldStyle {
  numbered: boolean;
  edge: number;
  node: number;
  cont: number;
  scale: number;
  chipsOf: (flow: { objects?: { id: string }[] }) => string[];
  numLabel: (flow: { id: string }) => { text: string; width: number; height: number };
  /** Kinds drawn with a corner glyph — see `View.glyphKinds`. */
  glyphKinds: ReadonlySet<string>;
}

function foldStyle(model: Model, view: View): FoldStyle {
  const businessObjectNames = new Map(model.businessObjects.map((bo) => [bo.id, bo.name]));
  const numbered = model.style.flowText === "numbered";
  const { edge, node, cont, scale } = fontSizes(model.style.font.size);
  return {
    numbered,
    glyphKinds: new Set(view.glyphKinds ?? []),
    edge,
    node,
    cont,
    scale,
    chipsOf: (flow) =>
      numbered
        ? []
        : (flow.objects ?? []).map(
            (objectRef) => businessObjectNames.get(objectRef.id) ?? objectRef.id,
          ),
    numLabel: (flow) => ({
      text: String(parseInt(flow.id.slice(1), 10)),
      width: Math.round(26 * scale),
      height: Math.round(17 * scale),
    }),
  };
}

/**
 * The size of one leaf box. Every leaf in the folded layout is measured here so
 * a glyph kind reserves its gutter on this path too — the main layout does the
 * same in `scene-layout.ts`, and the two must agree or a glyph would be drawn
 * over a label the folded path had sized without room for it.
 */
function leafSize(element: Element, style: FoldStyle) {
  return nodeSize(
    element.kind,
    element.label ?? element.id,
    style.node,
    style.glyphKinds.has(element.kind) ? GLYPH_GUTTER : 0,
  );
}

/** Converts an `Element` (and its children, recursively) into elk's input node shape. */
function toElkNode(element: Element, style: FoldStyle): ElkNode {
  if (element.children.length) {
    const lineCount = (element.label ?? element.id).split("\n").length;
    return {
      id: element.id,
      layoutOptions: {
        "elk.padding": `[top=${17 + lineCount * 13},left=${PAD},bottom=${PAD},right=${PAD}]`,
      },
      labels: [
        {
          text: element.label ?? element.id,
          ...measure(element.label ?? element.id, style.cont),
        },
      ],
      children: element.children.map((child) => toElkNode(child, style)),
    };
  }
  const size = leafSize(element, style);
  return { id: element.id, width: size.width, height: size.height };
}

/**
 * Recursively resolves every descendant of `elkNode` to an absolute origin
 * (elk positions are parent-relative). Synthetic `_in`/`_out` port nodes
 * (added for cross-group flow routing) come back as ports with no scene node;
 * everything else comes back with a `SceneNode` + `Box` ready to place.
 */
function walkFoldedNodes(
  elkNode: LaidOutNode,
  offset: Point,
  elementById: Map<string, Element>,
  syntheticIds: Set<string>,
): WalkedFoldNode[] {
  return (elkNode.children ?? []).flatMap((child) => {
    const origin = { x: offset.x + child.x, y: offset.y + child.y };
    if (syntheticIds.has(child.id)) return [{ id: child.id, origin, isPort: true }];
    const element = elementById.get(child.id)!;
    const box: Box = { x: origin.x, y: origin.y, width: child.width, height: child.height };
    const node: SceneNode = {
      id: child.id,
      kind: element.kind,
      label: element.label ?? child.id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      container: !!child.children?.length,
    };
    return [
      { id: child.id, origin, isPort: false, node, box },
      ...walkFoldedNodes(child, origin, elementById, syntheticIds),
    ];
  });
}

/** What resolving an elk edge to absolute coordinates needs. */
interface EdgeCollectContext {
  origins: Map<string, Point>;
  syntheticIds: Set<string>;
  edgeFontSize: number;
}

/**
 * Recursively collects every edge beneath `elkNode`, resolving its points and
 * labels to absolute coordinates. Synthetic `_oe`/`_ie` port edges (the stubs
 * connecting a group's boundary port to its real source/target) are set aside
 * in `edgePoints` rather than pushed as scene edges — the caller stitches them
 * onto the matching inter-group connector.
 */
function collectFoldedEdges(
  elkNode: LaidOutNode,
  rootOffset: Point,
  ctx: EdgeCollectContext,
): CollectedFoldEdges {
  const edges: SceneEdge[] = [];
  const edgePoints: [string, Point[]][] = [];
  for (const edge of elkNode.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const origin = (edge.container && ctx.origins.get(edge.container)) || rootOffset;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
      (point) => ({
        x: point.x + origin.x,
        y: point.y + origin.y,
      }),
    );
    if (ctx.syntheticIds.has(edge.id)) {
      edgePoints.push([edge.id, points]);
      continue;
    }
    const labels = (edge.labels ?? []).map((label) => ({
      flowId: edge.id,
      text: label.text,
      x: label.x + origin.x,
      y: label.y + origin.y,
      width: label.width,
      height: label.height,
      textH: label.text ? label.text.split("\n").length * (ctx.edgeFontSize + 3) + 4 : 0,
    }));
    edges.push({ id: edge.id, pts: points, labels });
  }
  for (const child of elkNode.children ?? []) {
    const childResult = collectFoldedEdges(child, rootOffset, ctx);
    edges.push(...childResult.edges);
    edgePoints.push(...childResult.edgePoints);
  }
  return { edges, edgePoints };
}

// ---- phase 1: laying each middle group out with elk ---------------------------

/** The flow partition of the model, and the synthetic ids the port stubs use. */
interface FoldGraph {
  rootOf: Map<string, Element>;
  interFlows: Flow[];
  internalFlows: Flow[];
  syntheticIds: Set<string>;
}

/** The elk label list for an internal flow — numbered views carry just the index. */
function internalFlowLabels(flow: Flow, style: FoldStyle) {
  if (style.numbered) return [style.numLabel(flow)];
  const text = flow.label ? wrapText(flow.label, LABEL_WRAP + 4) : techText(flow.tech);
  const chips = style.chipsOf(flow);
  if (!text && !chips.length) return [];
  return [
    {
      text,
      ...flowLabelBox({
        text,
        chipNames: chips,
        fontSize: style.edge,
        tech: flow.label ? techText(flow.tech) : undefined,
        scale: style.scale,
      }),
    },
  ];
}

/**
 * One middle group as an elk graph. Inter-group flows cannot cross the group
 * boundary, so each is represented inside it by a 1x1 port node pinned to the
 * first or last layer, plus a stub edge to the real endpoint; the caller
 * stitches those stubs onto the connector it routes by hand.
 */
function buildGroupGraph(group: Element, style: FoldStyle, fg: FoldGraph): ElkNode {
  const node = toElkNode(group, style);
  const nodeChildren = (node.children ??= []);
  for (const flow of fg.interFlows) {
    if (fg.rootOf.get(flow.from) === group) {
      fg.syntheticIds.add(`${flow.id}_out`);
      nodeChildren.push({
        id: `${flow.id}_out`,
        width: 1,
        height: 1,
        layoutOptions: { "elk.layered.layering.layerConstraint": "LAST" },
      });
    }
    if (fg.rootOf.get(flow.to) === group) {
      fg.syntheticIds.add(`${flow.id}_in`);
      nodeChildren.push({
        id: `${flow.id}_in`,
        width: 1,
        height: 1,
        layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" },
      });
    }
  }
  const internal = fg.internalFlows
    .filter((flow) => fg.rootOf.get(flow.from) === group)
    .map((flow) => ({
      id: flow.id,
      sources: [flow.from],
      targets: [flow.to],
      labels: internalFlowLabels(flow, style),
    }));
  const outStubs = fg.interFlows
    .filter((flow) => fg.rootOf.get(flow.from) === group)
    .map((flow) => {
      fg.syntheticIds.add(`${flow.id}_oe`);
      return { id: `${flow.id}_oe`, sources: [flow.from], targets: [`${flow.id}_out`] };
    });
  const inStubs = fg.interFlows
    .filter((flow) => fg.rootOf.get(flow.to) === group)
    .map((flow) => {
      fg.syntheticIds.add(`${flow.id}_ie`);
      return { id: `${flow.id}_ie`, sources: [`${flow.id}_in`], targets: [flow.to] };
    });
  return {
    id: `fold_${group.id}`,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "36",
      "elk.spacing.nodeNode": "14",
      "elk.spacing.edgeEdge": "10",
      "elk.spacing.edgeNode": "11",
      "elk.spacing.edgeLabel": "3",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.edgeLabels.placement": "CENTER",
    },
    children: [node],
    edges: [...internal, ...outStubs, ...inStubs],
  };
}

// ---- phase 2: sizing the source and sink columns ------------------------------

/** Stacks a partition's groups into fixed-width columns of centred blocks. */
function layoutColumn(elements: Element[], style: FoldStyle): ColGroup[] {
  return elements.map((group) => {
    const blocks = group.children.map((child) => {
      const size = leafSize(child, style);
      return { element: child, width: size.width, height: size.height, x: 0, y: 0 };
    });
    const columnWidth =
      Math.max(
        measure(group.label ?? group.id, style.cont).width + 20,
        ...blocks.map((block) => block.width),
      ) +
      2 * PAD;
    let blockY = PAD_TOP;
    for (const block of blocks) {
      block.x = PAD + (columnWidth - 2 * PAD - block.width) / 2;
      block.y = blockY;
      blockY += block.height + 14;
    }
    return { element: group, width: columnWidth, height: blockY - 14 + PAD, blocks };
  });
}

// ---- phase 3: classifying the inter-group flows -------------------------------

/**
 * Which gutter an inter-group flow belongs in. A/B are the straight
 * source→middle and middle→sink hops; C/D/E double back through a horizontal
 * gutter between two middle rows, so they also carry which gutter that is.
 */
function classifyFlow(
  flow: Flow,
  ctx: {
    partitionOf: (element: Element) => number;
    rootOf: Map<string, Element>;
    rowIndex: Map<string, number>;
  },
): { cls: Cls; gutter?: number } {
  const { partitionOf, rootOf, rowIndex } = ctx;
  const sourcePartition = partitionOf(rootOf.get(flow.from)!);
  const destPartition = partitionOf(rootOf.get(flow.to)!);
  if (sourcePartition === 0 && destPartition === 1) return { cls: "A" };
  if (sourcePartition === 1 && destPartition === 2) return { cls: "B" };
  if (sourcePartition === 1 && destPartition === 1) {
    const sourceRowIndex = rowIndex.get(rootOf.get(flow.from)!.id)!;
    const destRowIndex = rowIndex.get(rootOf.get(flow.to)!.id)!;
    return { cls: "C", gutter: destRowIndex > sourceRowIndex ? destRowIndex : destRowIndex + 1 };
  }
  if (sourcePartition === 2 && destPartition === 1)
    return { cls: "D", gutter: rowIndex.get(rootOf.get(flow.to)!.id)! };
  if (sourcePartition === 1 && destPartition === 0)
    return { cls: "E", gutter: rowIndex.get(rootOf.get(flow.from)!.id)! };
  return { cls: "X" };
}

// ---- phase 4: the coordinate frame --------------------------------------------

interface FoldRow {
  element: Element;
  box: Box;
  result: LaidOutNode | null;
}

/**
 * Stacks the middle groups top to bottom, leaving each gutter as much room as
 * the flows routed through it demand.
 */
function layoutMiddleRows(
  middles: Element[],
  middleResults: Map<string, LaidOutNode>,
  geom: { xMiddle: number; gutterHeight: (gutterIndex: number) => number },
  style: FoldStyle,
): { rows: FoldRow[]; middleHeight: number } {
  const rows: FoldRow[] = [];
  let yCursor = 16 + geom.gutterHeight(0);
  middles.forEach((element, index) => {
    const result = middleResults.get(element.id) ?? null;
    const size = result
      ? { width: result.children![0].width, height: result.children![0].height }
      : leafSize(element, style);
    rows.push({
      element,
      box: { x: geom.xMiddle, y: yCursor, width: size.width, height: size.height },
      result,
    });
    yCursor += size.height + Math.max(40, geom.gutterHeight(index + 1));
  });
  return { rows, middleHeight: yCursor - Math.max(40, geom.gutterHeight(middles.length)) };
}

/** Centres a partition's columns against the middle stack. */
function placeCol(
  cols: ColGroup[],
  x: number,
  middleHeight: number,
): { group: ColGroup; box: Box }[] {
  const total = cols.reduce((sum, col) => sum + col.height, 0) + (cols.length - 1) * 30;
  let colY = Math.max(20, 20 + (middleHeight - total) / 2);
  return cols.map((col) => {
    const box = { x, y: colY, width: col.width, height: col.height };
    colY += col.height + 30;
    return { group: col, box };
  });
}

// ---- phase 5: placing the nodes -----------------------------------------------

/** The scene under construction: what every placement phase writes into. */
interface FoldScene {
  nodes: SceneNode[];
  absoluteBoxes: Map<string, Box>;
  absolutePorts: Map<string, Point>;
  origins: Map<string, Point>;
}

function pushCol(placed: { group: ColGroup; box: Box }[], scene: FoldScene): void {
  for (const { group, box } of placed) {
    scene.nodes.push({
      id: group.element.id,
      kind: group.element.kind,
      label: group.element.label ?? group.element.id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      container: true,
    });
    scene.absoluteBoxes.set(group.element.id, box);
    for (const block of group.blocks) {
      const nodeBox = {
        x: box.x + block.x,
        y: box.y + block.y,
        width: block.width,
        height: block.height,
      };
      scene.nodes.push({
        id: block.element.id,
        kind: block.element.kind,
        label: block.element.label ?? block.element.id,
        x: nodeBox.x,
        y: nodeBox.y,
        width: nodeBox.width,
        height: nodeBox.height,
        container: false,
      });
      scene.absoluteBoxes.set(block.element.id, nodeBox);
    }
  }
}

/** Where a laid-out group's elk coordinates sit in the assembled scene. */
const rowOffset = (row: FoldRow): Point => ({
  x: row.box.x - row.result!.children![0].x,
  y: row.box.y - row.result!.children![0].y,
});

function pushMiddleRows(
  rows: FoldRow[],
  scene: FoldScene,
  elementById: Map<string, Element>,
  syntheticIds: Set<string>,
): void {
  for (const row of rows) {
    const { element, box, result } = row;
    if (!result) {
      scene.nodes.push({
        id: element.id,
        kind: element.kind,
        label: element.label ?? element.id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        container: false,
      });
      scene.absoluteBoxes.set(element.id, box);
      continue;
    }
    const offset = rowOffset(row);
    scene.origins.set(result.id, offset);
    for (const walked of walkFoldedNodes(result, offset, elementById, syntheticIds)) {
      scene.origins.set(walked.id, walked.origin);
      if (walked.isPort) {
        scene.absolutePorts.set(walked.id, walked.origin);
        continue;
      }
      scene.nodes.push(walked.node!);
      scene.absoluteBoxes.set(walked.id, walked.box!);
    }
  }
}

// ---- phase 6: routing the connectors ------------------------------------------

/** The gutter lanes a connector may claim, in the frame already fixed. */
interface Gutters {
  laneLeftX: (y1: number, y2: number) => number;
  laneRightX: (y1: number, y2: number) => number;
  gutterInfo: (
    gutterIndex: number,
    x1: number,
    x2: number,
  ) => { y: number; laneIndex: number; labelY: number };
  xLeftGutter: number;
  xRightGutter: number;
  xSink: number;
}

interface RoutedConnector {
  points: Point[];
  laneIndex: number;
  labelY: number;
}

/**
 * The hand-routed polyline for one inter-group flow. Allocation order matters:
 * each lane call claims a slot, so the branches must ask in the same sequence
 * they always have or parallel connectors change lanes.
 */
function routeConnector(
  entry: { cls: Cls; gutter?: number },
  ends: { source: Point; dest: Point; sourceBox: Box },
  gut: Gutters,
): RoutedConnector {
  const { cls } = entry;
  const { dest } = ends;
  if (cls === "C" || cls === "D" || cls === "E") {
    // Only a sink→middle flow starts on the source's left; the others leave the
    // right side, so the left seat is never resolved for them.
    const start = cls === "D" ? sideMid(ends.sourceBox, "left") : ends.source;
    const info = gut.gutterInfo(
      entry.gutter!,
      gut.xLeftGutter,
      cls === "D" ? gut.xSink : gut.xRightGutter + 120,
    );
    const rightX = gut.laneRightX(start.y, info.y);
    const leftX = gut.laneLeftX(info.y, dest.y);
    return {
      points: [
        start,
        { x: rightX, y: start.y },
        { x: rightX, y: info.y },
        { x: leftX, y: info.y },
        { x: leftX, y: dest.y },
        dest,
      ],
      laneIndex: info.laneIndex,
      labelY: info.labelY,
    };
  }
  // B crosses the right gutter; A and the X fallback both take the left.
  const laneX =
    cls === "B" ? gut.laneRightX(ends.source.y, dest.y) : gut.laneLeftX(ends.source.y, dest.y);
  return {
    points: [ends.source, { x: laneX, y: ends.source.y }, { x: laneX, y: dest.y }, dest],
    laneIndex: 0,
    labelY: 0,
  };
}

/**
 * A connector's label: parked in its gutter's label zone when it has one (the
 * six-point routes), otherwise tucked above the final approach.
 */
function connectorLabel(
  flow: Flow,
  routed: RoutedConnector,
  style: FoldStyle,
): SceneLabel | undefined {
  const chips = style.chipsOf(flow);
  const text = style.numbered
    ? style.numLabel(flow).text
    : flow.label
      ? wrapText(flow.label, LABEL_WRAP)
      : techText(flow.tech) || (chips.length ? "" : undefined);
  if (text === undefined) return undefined;
  const measured = style.numbered
    ? { width: Math.round(26 * style.scale), height: Math.round(17 * style.scale) }
    : flowLabelBox({
        text,
        chipNames: chips,
        fontSize: style.edge,
        tech: flow.label ? techText(flow.tech) : undefined,
        scale: style.scale,
      });
  const textH = text ? text.split("\n").length * (style.edge + 3) + 4 : 0;
  const { points } = routed;
  if (points.length >= 6) {
    const segmentLeft = Math.min(points[2].x, points[3].x);
    const segmentRight = Math.max(points[2].x, points[3].x);
    const availableSpan = Math.max(40, segmentRight - segmentLeft - measured.width - 20);
    return {
      flowId: flow.id,
      text,
      x: segmentLeft + 10 + ((routed.laneIndex * 173) % availableSpan),
      y: routed.labelY,
      width: measured.width,
      height: measured.height,
      textH,
    };
  }
  const secondLast = points[points.length - 2];
  const last = points[points.length - 1];
  return {
    flowId: flow.id,
    text,
    x: (secondLast.x + last.x) / 2 - measured.width / 2,
    y: last.y - measured.height - 4,
    width: measured.width,
    height: measured.height,
    textH,
  };
}

const sideMid = (box: Box, side: "left" | "right"): Point => ({
  x: side === "left" ? box.x : box.x + box.width,
  y: box.y + box.height / 2,
});

export async function foldedLayout(model: Model, view: View, elk: ELK): Promise<Scene | null> {
  const roots = model.elements;
  const style = foldStyle(model, view);
  const partitionOf = (element: Element) => view.partitions[element.kind] ?? 1;
  const sources = roots.filter((element) => partitionOf(element) === 0);
  const middles = roots.filter((element) => partitionOf(element) === 1);
  const sinks = roots.filter((element) => partitionOf(element) === 2);
  if (view.partitionByOrder) return null;
  const middleGroups = middles.filter((middle) => middle.children.length > 0);
  if (middleGroups.length < 2) return null;

  const rootOf = new Map<string, Element>();
  for (const root of roots) {
    for (const element of subtreeElements(root)) rootOf.set(element.id, root);
  }
  const fg: FoldGraph = {
    rootOf,
    interFlows: model.flows.filter((flow) => {
      const sourceRoot = rootOf.get(flow.from);
      const destRoot = rootOf.get(flow.to);
      return sourceRoot && destRoot && sourceRoot !== destRoot;
    }),
    internalFlows: model.flows.filter(
      (flow) => rootOf.get(flow.from) && rootOf.get(flow.from) === rootOf.get(flow.to),
    ),
    syntheticIds: new Set<string>(),
  };
  const elementById = new Map(indexElementsById(roots));

  const middleResults = new Map<string, LaidOutNode>();
  for (const group of middleGroups) {
    const laid = await elk.layout(buildGroupGraph(group, style, fg));
    middleResults.set(group.id, laid as unknown as LaidOutNode);
  }

  const sourceColumns = layoutColumn(sources, style);
  const sinkColumns = layoutColumn(sinks, style);

  const rowIndex = new Map(middles.map((middle, middleIndex) => [middle.id, middleIndex]));
  const classified = fg.interFlows.map((flow) => ({
    flow,
    ...classifyFlow(flow, { partitionOf, rootOf, rowIndex }),
  }));

  const gutterDemand: number[] = Array(middles.length + 1).fill(0);
  for (const entry of classified) if (entry.gutter !== undefined) gutterDemand[entry.gutter]++;

  const leftGutterFlowCount = classified.filter((entry) => "ACDE".includes(entry.cls)).length;
  const rightGutterFlowCount = classified.filter((entry) => "BCDE".includes(entry.cls)).length;
  const LABEL_W = 118;
  const widthLeftGutter =
    28 + Math.min(Math.ceil(leftGutterFlowCount / 2), 10) * LANE_STEP + LABEL_W;
  const widthRightGutter =
    28 + Math.min(Math.ceil(rightGutterFlowCount / 2), 10) * LANE_STEP + LABEL_W;

  const widthSource = Math.max(0, ...sourceColumns.map((col) => col.width));
  const widthMiddle = Math.max(
    ...middles.map((element) =>
      element.children.length
        ? middleResults.get(element.id)!.children![0].width
        : leafSize(element, style).width,
    ),
  );
  const widthSink = Math.max(0, ...sinkColumns.map((col) => col.width));

  const xSource = 10;
  const xLeftGutter = xSource + widthSource + 10;
  const xMiddle = xLeftGutter + widthLeftGutter;
  const xRightGutter = xMiddle + widthMiddle + 10;
  const xSink = xRightGutter + widthRightGutter;

  const hasChips = fg.interFlows.some((flow) => flow.objects?.length);
  const LABEL_ROW = hasChips ? 48 : 29;
  const LABEL_ZONE = 4 + 2 * LABEL_ROW;
  const gutterHeight = (gutterIndex: number) =>
    14 + gutterDemand[gutterIndex] * LANE_V + (gutterDemand[gutterIndex] ? LABEL_ZONE : 0);
  const { rows, middleHeight } = layoutMiddleRows(
    middles,
    middleResults,
    { xMiddle, gutterHeight },
    style,
  );

  const sourcePlaced = placeCol(sourceColumns, xSource, middleHeight);
  const sinkPlaced = placeCol(sinkColumns, xSink, middleHeight);

  const scene: FoldScene = {
    nodes: [],
    absoluteBoxes: new Map(),
    absolutePorts: new Map(),
    origins: new Map(),
  };
  pushCol(sourcePlaced, scene);
  pushCol(sinkPlaced, scene);
  pushMiddleRows(rows, scene, elementById, fg.syntheticIds);

  const edges: SceneEdge[] = [];
  const edgePoints = new Map<string, Point[]>();
  const collectCtx: EdgeCollectContext = {
    origins: scene.origins,
    syntheticIds: fg.syntheticIds,
    edgeFontSize: style.edge,
  };
  for (const row of rows) {
    if (!row.result) continue;
    const collected = collectFoldedEdges(row.result, rowOffset(row), collectCtx);
    edges.push(...collected.edges);
    for (const [edgeId, points] of collected.edgePoints) edgePoints.set(edgeId, points);
  }

  const leftLaneAlloc = new LaneAllocator();
  const rightLaneAlloc = new LaneAllocator();
  const gutterAllocators = gutterDemand.map(() => new LaneAllocator());
  const gutters: Gutters = {
    laneLeftX: (y1, y2) => xLeftGutter + 14 + leftLaneAlloc.alloc(y1, y2) * LANE_STEP,
    laneRightX: (y1, y2) => xRightGutter + 14 + rightLaneAlloc.alloc(y1, y2) * LANE_STEP,
    gutterInfo: (gutterIndex, x1, x2) => {
      const top =
        gutterIndex === 0
          ? 14
          : rows[gutterIndex - 1].box.y + rows[gutterIndex - 1].box.height + 10;
      const laneIndex = gutterAllocators[gutterIndex].alloc(x1, x2);
      return {
        y: top + LABEL_ZONE + laneIndex * LANE_V,
        laneIndex,
        labelY: top + 2 + (laneIndex % 2) * LABEL_ROW,
      };
    },
    xLeftGutter,
    xRightGutter,
    xSink,
  };

  for (const entry of classified) {
    const { flow } = entry;
    const sourceRoot = rootOf.get(flow.from)!;
    const destRoot = rootOf.get(flow.to)!;
    const sourceBox = scene.absoluteBoxes.get(flow.from) ?? scene.absoluteBoxes.get(sourceRoot.id)!;
    const destBox = scene.absoluteBoxes.get(flow.to) ?? scene.absoluteBoxes.get(destRoot.id)!;
    const routed = routeConnector(
      entry,
      {
        source: scene.absolutePorts.get(`${flow.id}_out`) ?? sideMid(sourceBox, "right"),
        dest: scene.absolutePorts.get(`${flow.id}_in`) ?? sideMid(destBox, "left"),
        sourceBox,
      },
      gutters,
    );
    const label = connectorLabel(flow, routed, style);
    edges.push({
      id: flow.id,
      pts: [
        ...(edgePoints.get(`${flow.id}_oe`) ?? []),
        ...routed.points,
        ...(edgePoints.get(`${flow.id}_ie`) ?? []),
      ],
      labels: label ? [label] : [],
    });
  }

  return {
    width: Math.ceil(xSink + widthSink + 10),
    height: Math.ceil(
      Math.max(
        middleHeight + 30,
        ...sinkPlaced.map((placed) => placed.box.y + placed.box.height + 20),
        ...sourcePlaced.map((placed) => placed.box.y + placed.box.height + 20),
      ),
    ),
    nodes: scene.nodes,
    edges,
    layoutMs: 0,
  };
}
