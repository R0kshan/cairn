/**
 * Alternative "folded" layout for `slide` disposition: arranges source / middle
 * / sink partitions into columns with hand-routed orthogonal connectors through
 * left/right gutters, so wide source→sink diagrams fit a 16:9 frame better than
 * the default flow. Lays out each middle group with ELK, then places columns and
 * routes inter-group flows itself. `LaneAllocator` assigns non-overlapping lanes
 * to parallel connectors. Returns `null` when folding doesn't apply.
 */

import type { Model, Element } from "./models/ast.ts";
import type { ELK, ElkNode } from "elkjs/lib/elk.bundled.js";
import type { View } from "./views.ts";
import type { Scene, SceneNode, SceneEdge, SceneLabel, LaidOutNode } from "./scene-layout.ts";
import { measure, wrapText, nodeSize, flowLabelBox, techText, fontSizes } from "./text-metrics.ts";
import type { Box, Point } from "./geometry.ts";

const PAD_TOP = 30,
  PAD = 12;
const LANE_STEP = 10;
const LANE_V = 11;
const LABEL_WRAP = 16;

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

export async function foldedLayout(model: Model, view: View, elk: ELK): Promise<Scene | null> {
  const roots = model.elements;
  const businessObjectNames = new Map(model.businessObjects.map((bo) => [bo.id, bo.name]));
  const numbered = model.style.flowText === "numbered";
  const {
    edge: edgeFontSize,
    node: nodeFontSize,
    cont: containerFontSize,
    scale: fontScale,
  } = fontSizes(model.style.font.size);
  const chipsOf = (flow: { objects?: { id: string }[] }) =>
    numbered
      ? []
      : (flow.objects ?? []).map(
          (objectRef) => businessObjectNames.get(objectRef.id) ?? objectRef.id,
        );
  const numLabel = (flow: { id: string }) => ({
    text: String(parseInt(flow.id.slice(1), 10)),
    width: Math.round(26 * fontScale),
    height: Math.round(17 * fontScale),
  });
  const partitionOf = (element: Element) => view.partitions[element.kind] ?? 1;
  const sources = roots.filter((element) => partitionOf(element) === 0);
  const middles = roots.filter((element) => partitionOf(element) === 1);
  const sinks = roots.filter((element) => partitionOf(element) === 2);
  if (view.partitionByOrder) return null;
  const middleGroups = middles.filter((middle) => middle.children.length > 0);
  if (middleGroups.length < 2) return null;

  const rootOf = new Map<string, Element>();
  for (const root of roots) {
    function mark(element: Element) {
      rootOf.set(element.id, root);
      element.children.forEach(mark);
    }
    mark(root);
  }

  const interFlows = model.flows.filter((flow) => {
    const sourceRoot = rootOf.get(flow.from);
    const destRoot = rootOf.get(flow.to);
    return sourceRoot && destRoot && sourceRoot !== destRoot;
  });
  const internalFlows = model.flows.filter(
    (flow) => rootOf.get(flow.from) && rootOf.get(flow.from) === rootOf.get(flow.to),
  );

  const elementById = new Map<string, Element>();
  function indexElements(elements: Element[]) {
    for (const element of elements) {
      elementById.set(element.id, element);
      indexElements(element.children);
    }
  }
  indexElements(roots);

  function toElkNode(element: Element): ElkNode {
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
            ...measure(element.label ?? element.id, containerFontSize),
          },
        ],
        children: element.children.map(toElkNode),
      };
    }
    const size = nodeSize(element.kind, element.label ?? element.id, nodeFontSize);
    return { id: element.id, width: size.width, height: size.height };
  }

  const middleResults = new Map<string, LaidOutNode>();
  for (const group of middleGroups) {
    const node = toElkNode(group);
    const nodeChildren = (node.children ??= []);
    for (const flow of interFlows) {
      if (rootOf.get(flow.from) === group)
        nodeChildren.push({
          id: `${flow.id}_out`,
          width: 1,
          height: 1,
          layoutOptions: { "elk.layered.layering.layerConstraint": "LAST" },
        });
      if (rootOf.get(flow.to) === group)
        nodeChildren.push({
          id: `${flow.id}_in`,
          width: 1,
          height: 1,
          layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" },
        });
    }
    const graph: ElkNode = {
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
      edges: [
        ...internalFlows
          .filter((flow) => rootOf.get(flow.from) === group)
          .map((flow) => {
            if (numbered)
              return {
                id: flow.id,
                sources: [flow.from],
                targets: [flow.to],
                labels: [numLabel(flow)],
              };
            const text = flow.label ? wrapText(flow.label, LABEL_WRAP + 4) : techText(flow.tech);
            const chips = chipsOf(flow);
            return {
              id: flow.id,
              sources: [flow.from],
              targets: [flow.to],
              labels:
                text || chips.length
                  ? [
                      {
                        text,
                        ...flowLabelBox(
                          text,
                          chips,
                          edgeFontSize,
                          flow.label ? techText(flow.tech) : undefined,
                          fontScale,
                        ),
                      },
                    ]
                  : [],
            };
          }),
        ...interFlows
          .filter((flow) => rootOf.get(flow.from) === group)
          .map((flow) => ({
            id: `${flow.id}_oe`,
            sources: [flow.from],
            targets: [`${flow.id}_out`],
          })),
        ...interFlows
          .filter((flow) => rootOf.get(flow.to) === group)
          .map((flow) => ({
            id: `${flow.id}_ie`,
            sources: [`${flow.id}_in`],
            targets: [flow.to],
          })),
      ],
    };
    middleResults.set(group.id, (await elk.layout(graph)) as unknown as LaidOutNode);
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
  const layoutColumn = (elements: Element[]): ColGroup[] =>
    elements.map((group) => {
      const blocks = group.children.map((child) => {
        const size = nodeSize(child.kind, child.label ?? child.id, nodeFontSize);
        return {
          element: child,
          width: size.width,
          height: size.height,
          x: 0,
          y: 0,
        };
      });
      const columnWidth =
        Math.max(
          measure(group.label ?? group.id, containerFontSize).width + 20,
          ...blocks.map((block) => block.width),
        ) +
        2 * PAD;
      let blockY = PAD_TOP;
      for (const block of blocks) {
        block.x = PAD + (columnWidth - 2 * PAD - block.width) / 2;
        block.y = blockY;
        blockY += block.height + 14;
      }
      return {
        element: group,
        width: columnWidth,
        height: blockY - 14 + PAD,
        blocks,
      };
    });
  const sourceColumns = layoutColumn(sources);
  const sinkColumns = layoutColumn(sinks);

  const rowIndex = new Map(middles.map((middle, middleIndex) => [middle.id, middleIndex]));
  type Cls = "A" | "B" | "C" | "D" | "E" | "X";
  const classify = (flow: (typeof interFlows)[number]): { cls: Cls; gutter?: number } => {
    const sourcePartition = partitionOf(rootOf.get(flow.from)!);
    const destPartition = partitionOf(rootOf.get(flow.to)!);
    if (sourcePartition === 0 && destPartition === 1) return { cls: "A" };
    if (sourcePartition === 1 && destPartition === 2) return { cls: "B" };
    if (sourcePartition === 1 && destPartition === 1) {
      const sourceRowIndex = rowIndex.get(rootOf.get(flow.from)!.id)!;
      const destRowIndex = rowIndex.get(rootOf.get(flow.to)!.id)!;
      return {
        cls: "C",
        gutter: destRowIndex > sourceRowIndex ? destRowIndex : destRowIndex + 1,
      };
    }
    if (sourcePartition === 2 && destPartition === 1)
      return { cls: "D", gutter: rowIndex.get(rootOf.get(flow.to)!.id)! };
    if (sourcePartition === 1 && destPartition === 0)
      return { cls: "E", gutter: rowIndex.get(rootOf.get(flow.from)!.id)! };
    return { cls: "X" };
  };
  const classified = interFlows.map((flow) => ({
    flow,
    ...classify(flow),
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
  const widthMiddleFn = (element: Element) =>
    element.children.length
      ? middleResults.get(element.id)!.children![0].width
      : nodeSize(element.kind, element.label ?? element.id, nodeFontSize).width;
  const widthMiddle = Math.max(...middles.map(widthMiddleFn));
  const widthSink = Math.max(0, ...sinkColumns.map((col) => col.width));

  const xSource = 10;
  const xLeftGutter = xSource + widthSource + 10;
  const xMiddle = xLeftGutter + widthLeftGutter;
  const xRightGutter = xMiddle + widthMiddle + 10;
  const xSink = xRightGutter + widthRightGutter;

  const hasChips = interFlows.some((flow) => flow.objects?.length);
  const LABEL_ROW = hasChips ? 48 : 29;
  const LABEL_ZONE = 4 + 2 * LABEL_ROW;
  const gutterHeight = (gutterIndex: number) =>
    14 + gutterDemand[gutterIndex] * LANE_V + (gutterDemand[gutterIndex] ? LABEL_ZONE : 0);
  const rows: {
    element: Element;
    box: Box;
    result: LaidOutNode | null;
  }[] = [];
  let yCursor = 16 + gutterHeight(0);
  middles.forEach((element, index) => {
    const result = middleResults.get(element.id) ?? null;
    const size = result
      ? {
          width: result.children![0].width,
          height: result.children![0].height,
        }
      : (() => {
          const node = nodeSize(element.kind, element.label ?? element.id, nodeFontSize);
          return { width: node.width, height: node.height };
        })();
    rows.push({
      element,
      box: {
        x: xMiddle,
        y: yCursor,
        width: size.width,
        height: size.height,
      },
      result,
    });
    yCursor += size.height + Math.max(40, gutterHeight(index + 1));
  });
  const middleHeight = yCursor - Math.max(40, gutterHeight(middles.length));

  const placeCol = (cols: ColGroup[], x: number): { group: ColGroup; box: Box }[] => {
    const total = cols.reduce((sum, col) => sum + col.height, 0) + (cols.length - 1) * 30;
    let colY = Math.max(20, 20 + (middleHeight - total) / 2);
    return cols.map((col) => {
      const box = { x, y: colY, width: col.width, height: col.height };
      colY += col.height + 30;
      return { group: col, box };
    });
  };
  const sourcePlaced = placeCol(sourceColumns, xSource);
  const sinkPlaced = placeCol(sinkColumns, xSink);

  const nodes: SceneNode[] = [];
  const absoluteBoxes = new Map<string, Box>();
  const pushCol = (placed: { group: ColGroup; box: Box }[]) => {
    for (const { group, box } of placed) {
      nodes.push({
        id: group.element.id,
        kind: group.element.kind,
        label: group.element.label ?? group.element.id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        container: true,
      });
      absoluteBoxes.set(group.element.id, box);
      for (const block of group.blocks) {
        const nodeBox = {
          x: box.x + block.x,
          y: box.y + block.y,
          width: block.width,
          height: block.height,
        };
        nodes.push({
          id: block.element.id,
          kind: block.element.kind,
          label: block.element.label ?? block.element.id,
          x: nodeBox.x,
          y: nodeBox.y,
          width: nodeBox.width,
          height: nodeBox.height,
          container: false,
        });
        absoluteBoxes.set(block.element.id, nodeBox);
      }
    }
  };
  pushCol(sourcePlaced);
  pushCol(sinkPlaced);

  const absolutePorts = new Map<string, Point>();
  const origins = new Map<string, Point>();
  for (const { element, box, result } of rows) {
    if (!result) {
      nodes.push({
        id: element.id,
        kind: element.kind,
        label: element.label ?? element.id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        container: false,
      });
      absoluteBoxes.set(element.id, box);
      continue;
    }
    const rootOffset = {
      x: box.x - result.children![0].x,
      y: box.y - result.children![0].y,
    };
    origins.set(result.id, rootOffset);
    function walkNodes(elkNode: LaidOutNode, offsetX: number, offsetY: number) {
      for (const child of elkNode.children ?? []) {
        const absoluteX = offsetX + child.x;
        const absoluteY = offsetY + child.y;
        origins.set(child.id, { x: absoluteX, y: absoluteY });
        if (/_in$|_out$/.test(child.id)) {
          absolutePorts.set(child.id, { x: absoluteX, y: absoluteY });
          continue;
        }
        const element = elementById.get(child.id)!;
        const childBox = {
          x: absoluteX,
          y: absoluteY,
          width: child.width,
          height: child.height,
        };
        nodes.push({
          id: child.id,
          kind: element.kind,
          label: element.label ?? child.id,
          x: childBox.x,
          y: childBox.y,
          width: childBox.width,
          height: childBox.height,
          container: !!child.children?.length,
        });
        absoluteBoxes.set(child.id, childBox);
        walkNodes(child, absoluteX, absoluteY);
      }
    }
    walkNodes(result, rootOffset.x, rootOffset.y);
  }

  const edges: SceneEdge[] = [];
  const edgePoints = new Map<string, Point[]>();
  for (const { box, result } of rows) {
    if (!result) continue;
    const rootOffset = {
      x: box.x - result.children![0].x,
      y: box.y - result.children![0].y,
    };
    function collectEdges(elkNode: LaidOutNode) {
      for (const edge of elkNode.edges ?? []) {
        const section = edge.sections?.[0];
        if (!section) continue;
        const origin = (edge.container && origins.get(edge.container)) || rootOffset;
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
          (point) => ({
            x: point.x + origin.x,
            y: point.y + origin.y,
          }),
        );
        if (/_oe$|_ie$/.test(edge.id)) {
          edgePoints.set(edge.id, points);
          continue;
        }
        const labels = (edge.labels ?? []).map((label) => ({
          flowId: edge.id,
          text: label.text,
          x: label.x + origin.x,
          y: label.y + origin.y,
          width: label.width,
          height: label.height,
        }));
        edges.push({ id: edge.id, pts: points, labels });
      }
      (elkNode.children ?? []).forEach(collectEdges);
    }
    collectEdges(result);
  }

  const leftLaneAlloc = new LaneAllocator();
  const rightLaneAlloc = new LaneAllocator();
  const gutterAllocators = gutterDemand.map(() => new LaneAllocator());
  const laneLeftX = (y1: number, y2: number) =>
    xLeftGutter + 14 + leftLaneAlloc.alloc(y1, y2) * LANE_STEP;
  const laneRightX = (y1: number, y2: number) =>
    xRightGutter + 14 + rightLaneAlloc.alloc(y1, y2) * LANE_STEP;
  const gutterInfo = (gutterIndex: number, x1: number, x2: number) => {
    const top =
      gutterIndex === 0 ? 14 : rows[gutterIndex - 1].box.y + rows[gutterIndex - 1].box.height + 10;
    const laneIndex = gutterAllocators[gutterIndex].alloc(x1, x2);
    return {
      y: top + LABEL_ZONE + laneIndex * LANE_V,
      laneIndex,
      labelY: top + 2 + (laneIndex % 2) * LABEL_ROW,
    };
  };
  const sideMid = (box: Box, side: "left" | "right"): Point => ({
    x: side === "left" ? box.x : box.x + box.width,
    y: box.y + box.height / 2,
  });

  for (const { flow, cls, gutter } of classified) {
    const sourceRoot = rootOf.get(flow.from)!;
    const destRoot = rootOf.get(flow.to)!;
    const outPort = absolutePorts.get(`${flow.id}_out`);
    const inPort = absolutePorts.get(`${flow.id}_in`);
    const sourcePoint =
      outPort ??
      sideMid(absoluteBoxes.get(flow.from) ?? absoluteBoxes.get(sourceRoot.id)!, "right");
    const destPoint =
      inPort ?? sideMid(absoluteBoxes.get(flow.to) ?? absoluteBoxes.get(destRoot.id)!, "left");
    const preSegments = edgePoints.get(`${flow.id}_oe`) ?? [];
    const postSegments = edgePoints.get(`${flow.id}_ie`) ?? [];
    const points: Point[] = [];
    let flowLaneIndex = 0;
    let gutterY = 0;
    let gutterLabelY = 0;

    if (cls === "A") {
      const leftX = laneLeftX(sourcePoint.y, destPoint.y);
      points.push(
        sourcePoint,
        { x: leftX, y: sourcePoint.y },
        { x: leftX, y: destPoint.y },
        destPoint,
      );
    } else if (cls === "B") {
      const rightX = laneRightX(sourcePoint.y, destPoint.y);
      points.push(
        sourcePoint,
        { x: rightX, y: sourcePoint.y },
        { x: rightX, y: destPoint.y },
        destPoint,
      );
    } else if (cls === "C" || cls === "D" || cls === "E") {
      const gutterIndex = gutter!;
      const start: Point =
        cls === "D"
          ? sideMid(absoluteBoxes.get(flow.from) ?? absoluteBoxes.get(sourceRoot.id)!, "left")
          : sourcePoint;
      const info = gutterInfo(gutterIndex, xLeftGutter, cls === "D" ? xSink : xRightGutter + 120);
      gutterY = info.y;
      flowLaneIndex = info.laneIndex;
      gutterLabelY = info.labelY;
      const rightX = laneRightX(start.y, gutterY);
      const leftX = laneLeftX(gutterY, destPoint.y);
      points.push(
        start,
        { x: rightX, y: start.y },
        { x: rightX, y: gutterY },
        { x: leftX, y: gutterY },
        { x: leftX, y: destPoint.y },
        destPoint,
      );
    } else {
      const leftX = laneLeftX(sourcePoint.y, destPoint.y);
      points.push(
        sourcePoint,
        { x: leftX, y: sourcePoint.y },
        { x: leftX, y: destPoint.y },
        destPoint,
      );
    }

    const mergedPoints = [...preSegments, ...points, ...postSegments];
    let label: SceneLabel | undefined;
    const chips = chipsOf(flow);
    const text = numbered
      ? numLabel(flow).text
      : flow.label
        ? wrapText(flow.label, LABEL_WRAP)
        : techText(flow.tech) || (chips.length ? "" : undefined);
    if (text !== undefined) {
      const measured = numbered
        ? { width: Math.round(26 * fontScale), height: Math.round(17 * fontScale) }
        : flowLabelBox(
            text,
            chips,
            edgeFontSize,
            flow.label ? techText(flow.tech) : undefined,
            fontScale,
          );
      if (points.length >= 6) {
        const segmentLeft = Math.min(points[2].x, points[3].x);
        const segmentRight = Math.max(points[2].x, points[3].x);
        const availableSpan = Math.max(40, segmentRight - segmentLeft - measured.width - 20);
        const centerX = segmentLeft + 10 + ((flowLaneIndex * 173) % availableSpan);
        label = {
          flowId: flow.id,
          text,
          x: centerX,
          y: gutterLabelY,
          width: measured.width,
          height: measured.height,
        };
      } else {
        const secondLast = points[points.length - 2];
        const last = points[points.length - 1];
        label = {
          flowId: flow.id,
          text,
          x: (secondLast.x + last.x) / 2 - measured.width / 2,
          y: last.y - measured.height - 4,
          width: measured.width,
          height: measured.height,
        };
      }
    }
    edges.push({
      id: flow.id,
      pts: mergedPoints,
      labels: label ? [label] : [],
    });
  }

  const totalWidth = Math.ceil(xSink + widthSink + 10);
  const totalHeight = Math.ceil(
    Math.max(
      middleHeight + 30,
      ...sinkPlaced.map((placed) => placed.box.y + placed.box.height + 20),
      ...sourcePlaced.map((placed) => placed.box.y + placed.box.height + 20),
    ),
  );
  return {
    width: totalWidth,
    height: totalHeight,
    nodes,
    edges,
    layoutMs: 0,
  };
}
