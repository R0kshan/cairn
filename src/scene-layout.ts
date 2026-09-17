/**
 * Stage 4: turns the validated `Model` into an absolute-positioned `Scene`
 * (nodes, edges, labels, canvas size) via elkjs layered layout. Builds the ELK
 * graph from measured node sizes, runs several candidate layouts for balanced
 * dispositions (`slide`/`page`) and picks the best fit — optionally deferring to
 * the folded layout (`slide-fold.ts`). `LaidOutNode`/`LaidOutEdge` describe an
 * ELK result after layout (coordinates populated) and are shared with slide-fold.
 */

import type { Model, Element, Span, AttachSide, AttachRole } from "./models/ast.ts";
import type { ElkNode, ElkEdgeSection } from "elkjs/lib/elk.bundled.js";
import type { View } from "./views.ts";
import {
  measure,
  wrapText,
  flowLabelBox,
  techText,
  fontSizes,
  GLYPH_GUTTER,
  LOGO_GUTTER,
} from "./text-metrics.ts";
import { foldedLayout } from "./slide-fold.ts";
import { getElk } from "./elk-engine.ts";
import { rerouteDetours, titleBoxesOf } from "./route-detour.ts";
import { type Box, type Point, type TitleBox, isLongDetour } from "./geometry.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import { compactHorizontal, compactVertical, fitCanvas } from "./compact.ts";
import {
  optimiseRoutes,
  decoincideAfterOffsets,
  clearSideHugs,
  reaimAfterOffsets,
  clearLeavingRuns,
  reseatAwayTerminals,
  spreadAttachments,
  swapCrossingSiblingSeats,
  tidyEdges,
} from "./edge-tidy.ts";
import { inspect, type Profile } from "./readability.ts";
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
interface LaidOutLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface LaidOutEdge {
  id: string;
  container?: string;
  sections?: ElkEdgeSection[];
  labels?: LaidOutLabel[];
}

export interface SceneNode extends Box {
  id: string;
  kind: string;
  label: string;
  container: boolean;
}
export interface SceneLabel extends Box {
  flowId: string;
  text: string;
  /**
   * Author-declared nudge from the seat `anchorFlowLabels` gives this label
   * (`{ label-offset: 12, -6 }`). Applied on every re-anchor, so a renderer
   * that re-settles cannot quietly drop it. Pure geometry — a delta, never a
   * DSL side or kind (invariant §16).
   */
  offset?: { dx: number; dy: number };
  /**
   * Height of the *text* rows, which sit at the top of the box; a protocol line
   * and chips fill the rest. Seating a label on its run means centring this, not
   * the box — centre the box and the run lands between text and chip, which is
   * neither on the line nor under it. 0 for a chips-only label.
   */
  textH: number;
}
export interface SceneEdge {
  id: string;
  pts: Point[];
  labels: SceneLabel[];
  /**
   * Set by `route-detour` on edges it sent through a top/bottom channel.
   * Those wrap around by design (invariant §11), so the attachment-direction
   * rule (§4c) and its `attachAway` gate exempt them.
   */
  detour?: boolean;
  /**
   * Which of this flow's terminals the author pinned to a node side
   * (`APP.right -> DB.left`) — or named with an endpoint role, which fixes the
   * queue cap at the *other* end of the flow (`CAPTURE.producer -> EVENTS`) and
   * is the author's word just as much. A pinned terminal is intent, not a metric win, so
   * the passes that would move it stand down: re-siding skips the edge,
   * `route-detour` never channels it, `attachAway` exempts it, and the route
   * repair may only offer it candidates that keep the pinned end on its side.
   *
   * Per end, so a half-pinned flow keeps its free end free. Geometry only —
   * which end, never which DSL side — so no positioning pass has to know an
   * element kind to honor it (invariant §16).
   */
  pinned?: { start?: boolean; end?: boolean };
  /**
   * Which of this flow's terminals took a side *this stage* chose rather than
   * the author — the queue caps of `hubFlowSides`. Re-siding stands down for it
   * exactly as it does for a pin, because a side the reader is meant to read as
   * a grouping is worth as much as one the author asked for; elk had already put
   * both consumers on the right cap of a queue and the re-aim was moving the
   * second one to the bottom.
   *
   * What it deliberately does **not** buy is the pin's exemption from
   * `attachAway`, in the layout's own count or in `scripts/sweep.ts`: a side
   * cairn chose must stay measurable by the gate that judges it (invariant §3a).
   * Geometry only, like `pinned` — which end, never which kind (§16).
   */
  hubSided?: { start?: boolean; end?: boolean };
  /**
   * The route this flow had before `optimiseRoutes` moved it. Kept so the
   * renderer can undo a repair that cost some label its seat — that verdict is
   * only reachable after label settling, which happens during rendering.
   */
  repairedFrom?: Point[];
}
export interface Scene {
  width: number;
  height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  layoutMs: number;
  /**
   * Vertical bands `compactVertical` must not reclaim. An `offset:` that moves an
   * element down opens a gap on purpose, and compaction — which runs again inside
   * the renderer, after settling — cannot otherwise tell it from the dead space
   * it exists to remove. Geometry only, like every other flag here (§16).
   */
  pinnedBands?: { top: number; bottom: number }[];
  /**
   * Elements whose `offset:` was cut short to keep them inside their container.
   * The one place a positioning hint is negotiated (§17), so it is also the one
   * that has to be reportable — `offsetDiagnostics` turns this into W0573.
   */
  clampedOffsets?: Set<string>;
  /**
   * Spans of the `size:` hints a container's own children or its parent cut
   * short — the same negotiation `clampedOffsets` records, from the other end
   * (§17). Spans rather than ids: a `size:` names one container, so there is
   * nothing to attribute back through a parent chain.
   */
  clampedSizes?: Set<Span>;
  /**
   * Spans of the `segment-offset:` entries a route could not honor as written:
   * `clamped` was cut short to keep a terminal on the element side it sits on,
   * `stale` named a run the route does not have. `offsetDiagnostics` turns them
   * into W0573 and W0574 — the same rule as `clampedOffsets`, that the one
   * negotiation a hint gets is also the one it is told about (§17).
   */
  segmentHints?: { clamped: Span[]; stale: Span[] };
  /**
   * Best (lowest) tier `optimiseRoutes` paid at across the repairs it kept. The
   * renderer audits those repairs for label collateral the router could not see,
   * and "a loss at tier T is payable only by a gain at a better tier" needs to
   * know what the repair bought. Absent when nothing was repaired.
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

/**
 * The author's `order: n` on an element **inside a container**, as an elk
 * position hint. elk reads the vector's *second* component as the index within a
 * layer, and honors it only under `crossingMinimization.semiInteractive` (armed
 * by the container in `toElkNode`). Absent for an element without one, which is
 * what keeps an order-free diagram byte-identical.
 *
 * A top-level element does not come through here: its `order:` sequences it
 * along the reading direction, which is a partition band (`readingSlots`), not
 * an index inside a layer. Inside a container elk offers nothing equivalent —
 * every layer constraint was measured to be a no-op under
 * `hierarchyHandling: INCLUDE_CHILDREN` — so there the hint sorts the siblings
 * that share a layer, across the flow direction (`DSL_SPEC.md` § Positioning
 * controls).
 */
const orderOption = (element: Element): Record<string, string> =>
  element.order ? { "elk.position": `(0,${element.order.value})` } : {};

/**
 * The switch that makes elk read `elk.position` at all. It belongs on the node
 * whose *children* carry the positions — the root for top-level elements, and
 * every container for its own children, which is why `toElkNode` arms it too —
 * and only when at least one of those children declares an order, so an
 * order-free diagram gets no new option and renders byte-identically.
 */
const semiInteractiveOption = (children: Element[]): Record<string, string> =>
  children.some((child) => child.order)
    ? { "elk.layered.crossingMinimization.semiInteractive": "true" }
    : {};

/**
 * Narrowest box the renderer draws well — an actor's, which carries a figure
 * and a name and nothing else. It doubles as the floor for a node whose author
 * asked for a `label-padding:`, since that is a request to stop reserving room
 * the label is not using.
 */
const ACTOR_MIN_WIDTH = 64;

/** What sizing a node needs beyond the element itself: the same values for every node in one layout. */
interface NodeSizing {
  compact: boolean;
  fonts: { cont: number; node: number };
  /** `style { container-padding: <n> }`, or undefined for the built-in spacing. */
  containerPadding?: number;
  /** `style { label-padding: <n> }`, or undefined for the built-in spacing. */
  labelPadding?: number;
  /** Kinds drawn with a corner glyph — see `View.glyphKinds`. */
  glyphKinds: ReadonlySet<string>;
}

/**
 * Converts an `Element` (and its children, recursively) into elk's input node
 * shape. `root` marks a top-level element, whose own `order:` is a partition
 * band rather than an index inside a layer — its children still carry theirs.
 */
function toElkNode(element: Element, sizing: NodeSizing, root = false): ElkNode {
  const { compact, fonts, glyphKinds, containerPadding, labelPadding } = sizing;
  const { cont: containerFontSize, node: nodeFontSize } = fonts;
  if (element.children.length) {
    const lineCount = (element.label ?? element.id).split("\n").length;
    // The top is left out of the knob on purpose: it is the container's title
    // bar, so it has to track the label's line count or the name lands on the
    // first child. Only the three sides that are pure whitespace are tunable.
    const side = containerPadding ?? (compact ? 7 : 9);
    return {
      id: element.id,
      layoutOptions: {
        "elk.padding": `[top=${(compact ? 11 : 13) + lineCount * 14},left=${side},bottom=${side},right=${side}]`,
        ...(root ? {} : orderOption(element)),
        ...semiInteractiveOption(element.children),
      },
      labels: [
        {
          text: element.label ?? element.id,
          ...measure(element.label ?? element.id, containerFontSize),
        },
      ],
      children: element.children.map((child) => toElkNode(child, sizing)),
    };
  }
  const measured = measure(element.label ?? element.id, nodeFontSize);
  const isActor = element.kind === "actor";
  // A glyph node keeps the same minimum: the minimum already leaves more room
  // than a short label needs, so only labels wide enough to reach the glyph
  // widen the box.
  // A logo reserves the mirror image of the glyph gutter, on the right. An
  // element can in principle carry both, so they add rather than override.
  const gutter =
    (glyphKinds.has(element.kind) ? GLYPH_GUTTER : 0) + (element.logo ? LOGO_GUTTER : 0);
  // A `label-padding:` drops the uniform minimum with it. The minimum is what
  // keeps boxes the same width when their labels are short, so leaving it in
  // place would mean the knob narrowed nothing on the very diagrams it was
  // asked for: it is the floor, not the padding, that most boxes sit on.
  // `ACTOR_MIN_WIDTH` is the narrowest box the renderer already draws well.
  const sidePad = labelPadding ?? (compact ? 5 : 6);
  const minWidth = labelPadding === undefined ? (compact ? 98 : 108) : ACTOR_MIN_WIDTH;
  // An actor's label sits under a figure rather than in a box, so it carries
  // its own default — but `label-padding:` still governs it, or the property
  // would narrow every box on the diagram except the people.
  const actorSidePad = labelPadding ?? 4;
  return {
    id: element.id,
    ...(element.order && !root ? { layoutOptions: orderOption(element) } : {}),
    width: isActor
      ? Math.max(
          ACTOR_MIN_WIDTH,
          measure(element.label ?? element.id, nodeFontSize - 1.5).width + actorSidePad * 2,
        )
      : Math.max(minWidth, measured.width + sidePad * 2 + gutter),
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
 * Mirrors a scene across the diagonal. `route-detour` reasons in one orientation
 * — flows right-to-left, channels above or below — and a DOWN layout is that
 * problem rotated. Transposing in and out reuses the same rules and gated
 * invariants instead of a second implementation.
 *
 * Label boxes swap with everything else on the way in, so lane spacing budgets a
 * label's width where the drawing needs width. The text itself never rotates,
 * which is why title bands are computed before transposing.
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

/**
 * How many times the port-constrained relayout may be re-entered. Two: the first
 * round repairs what elk drew unaided, the second repairs what the first round's
 * new layer assignment introduced. Every round costs a full elk layout, and a
 * third has not been observed to beat the two before it.
 */
const PORT_PASS_ROUNDS = 2;

/** One round of the port-constrained relayout, scored against the layout elk drew unaided. */
export interface RelayoutRound<T> {
  scene: T;
  /** The ladder tier this round pays off at against the base layout. Lower is better. */
  tier: number;
  /** How many of its flows measure as `longDetour` — the tie-break, see `beatsRelayout`. */
  detours: number;
}

/**
 * Does this round beat the best one so far? The ladder decides first: a round
 * that pays at a better tier wins outright, and one that pays at a worse tier
 * never does.
 *
 * The tie-break is what the ladder cannot supply. `relayoutVerdict` refuses on
 * any per-key gain, so two rounds that both clear a tier-0 defect are simply
 * incomparable to it — even when one of them leaves two flows wrapped around the
 * whole drawing and the other does not. Fewer over-long routes therefore breaks
 * the tie, and an exact tie keeps the earlier round, so the choice never depends
 * on iteration order (INVARIANTS §2).
 */
export function beatsRelayout<T>(round: RelayoutRound<T>, best: RelayoutRound<T> | null): boolean {
  if (!best) return true;
  if (round.tier !== best.tier) return round.tier < best.tier;
  return round.detours < best.detours;
}

/**
 * The flows whose terminal segment departs *away* from their counterpart or
 * arrives from beyond it — the sweep's `attachAway` predicate, on the final
 * scene (channel reroutes are exempt, they wrap by design). Drives the
 * port-constraint second pass below: the population that pass exists to
 * prevent is exactly the one this counts.
 */
function attachAwayOf(scene: Scene, model: Model): Set<string> {
  const ATTACH_AWAY_TOL = 24;
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const flagged = new Set<string>();
  for (const e of scene.edges) {
    // A pinned terminal departs where the author said to, which is exactly what
    // this predicate calls "away" — exempt, like a channel route. Per end: the
    // free end of a half-pinned flow is still the layout's to answer for.
    if (e.pts.length < 2 || e.detour) continue;
    const flow = model.flows.find((f) => f.id === e.id);
    const from = byId.get(flow?.from ?? "");
    const to = byId.get(flow?.to ?? "");
    if (!from || !to) continue;
    const centerOf = (n: SceneNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
    const away = (seg: { x: number; y: number }, target: { x: number; y: number }): boolean =>
      (Math.abs(seg.x) >= 0.5 && Math.abs(target.x) > ATTACH_AWAY_TOL && seg.x * target.x < 0) ||
      (Math.abs(seg.y) >= 0.5 && Math.abs(target.y) > ATTACH_AWAY_TOL && seg.y * target.y < 0);
    const p0 = e.pts[0];
    const p1 = e.pts[1];
    const pn = e.pts[e.pts.length - 1];
    const pm = e.pts[e.pts.length - 2];
    const toCenter = centerOf(to);
    const fromCenter = centerOf(from);
    if (
      !e.pinned?.start &&
      away({ x: p1.x - p0.x, y: p1.y - p0.y }, { x: toCenter.x - p0.x, y: toCenter.y - p0.y })
    )
      flagged.add(e.id);
    if (
      !e.pinned?.end &&
      away({ x: pn.x - pm.x, y: pn.y - pm.y }, { x: pn.x - fromCenter.x, y: pn.y - fromCenter.y })
    )
      flagged.add(e.id);
    // The other shape this pass repairs, and the one `away` cannot see. A
    // backward flow whose channel plan fell through to a lane over the top of
    // the drawing leaves north and arrives north; when its two nodes sit at
    // roughly the same height, neither offset clears `ATTACH_AWAY_TOL`, so the
    // route is called clean while measuring twice the distance it covers. No
    // post-pass can repair it either — the corridor between the two nodes is
    // usually one lane wide and already carries the answering flow, so the
    // reroute is refused for merging with it. Ports facing the counterpart are
    // the repair, which is what an author gets today by pinning both ends by
    // hand (`SIPRE.left -> MESSAGING.right`).
    // Whole-route shape, not a terminal: a flow with either end pinned keeps the
    // route the author's pin bought it.
    if (!e.pinned && isLongDetour(e.pts, from, to)) flagged.add(e.id);
  }
  return flagged;
}

/**
 * How many of this layout's flows measure far longer than the distance they
 * cover — `scripts/sweep.ts`'s `longDetour`, counted per layout.
 *
 * `relayoutVerdict` cannot weigh this between two whole layouts: it refuses on
 * any per-key gain, so a candidate that removes two wrap-arounds and eight
 * crossings while adding four crossings elsewhere reads exactly like one that
 * only added them. Counting the defect the ladder is blind to lets the pass
 * break that tie instead of taking whichever candidate came first.
 */
function longDetourCount(scene: Scene, model: Model): number {
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  let count = 0;
  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    const flow = model.flows.find((f) => f.id === edge.id);
    const from = byId.get(flow?.from ?? "");
    const to = byId.get(flow?.to ?? "");
    if (!from || !to) continue;
    if (isLongDetour(edge.pts, from, to)) count++;
  }
  return count;
}

/**
 * Defects the sweep gates on that the house ladder deliberately does not model,
 * keyed for the same set-based verdict so `ladderAccepts` judges a wholesale
 * relayout the way the gate will. Two blind spots, both deliberate router design
 * (`readability.ts`): `hug:` is the §4i arrowhead rule, leaf-only at 8px/12px,
 * while the sweep's `sideHug` covers containers at 3px/24px; and `title:` checks
 * runs only while `titleStruck` covers labels too. A router picking per-edge
 * candidates can afford that; a choice between two whole layouts cannot — the
 * constrained pass was buying attachAway fixes with container hugs and labels
 * parked on title bands it could not see.
 */
function selectionExtras(scene: Scene, model: Model): Profile {
  const extra: Profile = new Map();
  const edgeEnds = new Map(model.flows.map((flow) => [flow.id, new Set([flow.from, flow.to])]));
  const bands = titleBoxesOf(scene, model);
  for (const e of scene.edges) {
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      const vert = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;
      const horiz = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
      if (!vert && !horiz) continue;
      for (const n of scene.nodes) {
        if (edgeEnds.get(e.id)?.has(n.id)) continue;
        const shared = vert
          ? Math.min(Math.max(a.y, b.y), n.y + n.height) - Math.max(Math.min(a.y, b.y), n.y)
          : Math.min(Math.max(a.x, b.x), n.x + n.width) - Math.max(Math.min(a.x, b.x), n.x);
        if (shared <= 24) continue;
        const gap = vert
          ? Math.min(Math.abs(a.x - n.x), Math.abs(a.x - (n.x + n.width)))
          : Math.min(Math.abs(a.y - n.y), Math.abs(a.y - (n.y + n.height)));
        if (gap < 3) extra.set(`sidehug:${e.id}:${i}@${n.id}`, 2);
      }
    }
    for (const l of e.labels) {
      if (!l.width || !l.height) continue;
      for (const band of bands)
        if (
          l.x < band.x + band.width &&
          band.x < l.x + l.width &&
          l.y < band.y + band.height &&
          band.y < l.y + l.height
        )
          extra.set(`titlelabel:${e.id}@${band.x},${band.y}`, 0);
    }
  }
  return extra;
}

/**
 * The ladder's verdict, adapted to a whole-layout choice. `ladderVerdict` keys
 * defects by identity *and position* — right for a router moving one edge, where
 * a moved crossing is a new one; wrong between two complete layouts, where every
 * coordinate shifts a few px and one crossing reads as gained at one address and
 * lost at another, refusing every relayout. Identity here drops positions and
 * segment indices, keeping multiplicity as a count so a pair gaining a *second*
 * crossing is still a gain. The rule is unchanged: walk tiers, refuse on any
 * gain, accept at the first tier that only lost.
 */
/**
 * A profile counted by defect *identity* — position and segment index dropped,
 * multiplicity kept — which is what comparing two whole layouts needs: every
 * coordinate shifts between them, so an address-keyed diff reads one unmoved
 * crossing as both a gain and a loss.
 */
function tallyProfile(profile: Profile): Map<string, { tier: number; count: number }> {
  const normalize = (key: string) => key.replace(/@[-\d.,]+$/, "").replace(/:\d+(?=@|$)/, "");
  const out = new Map<string, { tier: number; count: number }>();
  for (const [key, tier] of profile) {
    const id = normalize(key);
    const entry = out.get(id) ?? { tier, count: 0 };
    entry.count++;
    out.set(id, entry);
  }
  return out;
}

function relayoutVerdict(before: Profile, after: Profile): number {
  const was = tallyProfile(before);
  const now = tallyProfile(after);
  for (let tier = 0; tier < 5; tier++) {
    let gained = false;
    let lost = false;
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const w = was.get(key);
      const n = now.get(key);
      // Judge a key at its own tier only — a tier-1 loss paid for a tier-0
      // win is the ladder working, not a gain.
      if ((w ?? n)!.tier !== tier) continue;
      if ((n?.count ?? 0) > (w?.count ?? 0)) gained = true;
      if ((n?.count ?? 0) < (w?.count ?? 0)) lost = true;
    }
    if (gained) return -1;
    if (lost) return tier;
  }
  return -1;
}

/**
 * Does `after` cost the reader nothing the ladder can see? `relayoutVerdict`
 * answers a different question — it demands a *strict* win, because a repair
 * that changes nothing is not worth taking. A denser layout is: a candidate that
 * ties on every tier and draws the same diagram in two thirds of the area is the
 * one to keep, so ties count as admissible here and only a gain refuses.
 */
export function noLadderRegression(before: Profile, after: Profile): boolean {
  const perTier = (profile: Profile) => {
    const totals = [0, 0, 0, 0, 0];
    for (const { tier, count } of tallyProfile(profile).values()) totals[tier] += count;
    return totals;
  };
  const was = perTier(before);
  const now = perTier(after);
  // Tier *totals*, not per-defect identity: two independent layouts share almost
  // no defect addresses, so a key-by-key rule refuses even a candidate that
  // halves the crossings.
  //
  // And every tier must hold, not merely the first that differs. The ladder's
  // trade rule prices a *repair* that pays for itself; this is a whole drawing
  // swapped for a smaller one, and page area is not on the ladder at all — so a
  // candidate may not weave one flow to buy it. Measured, too: allowing the
  // trade sent the corpus `turnHeavy` and `nearParallel` ratchets through their
  // ceilings while the area it bought was a few percent.
  return now.every((count, tier) => count <= was[tier]);
}

/**
 * Fraction of the drawing's own bounding box that node boxes touch, on a coarse
 * grid. Counting area would double-count a container over its children and call
 * a nest of boxes dense; the grid asks the reader's question instead — how much
 * of the page has *something* on it. Drives one decision only: whether a layout
 * is empty enough to be worth re-laying out for density (`DENSE_ENOUGH`).
 */
export function nodeCoverage(scene: Scene): number {
  if (!scene.nodes.length) return 1;
  const left = Math.min(...scene.nodes.map((n) => n.x));
  const top = Math.min(...scene.nodes.map((n) => n.y));
  const right = Math.max(...scene.nodes.map((n) => n.x + n.width));
  const bottom = Math.max(...scene.nodes.map((n) => n.y + n.height));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return 1;
  const COLUMNS = 32;
  const ROWS = 16;
  let covered = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const cellLeft = left + (column * width) / COLUMNS;
      const cellRight = left + ((column + 1) * width) / COLUMNS;
      const cellTop = top + (row * height) / ROWS;
      const cellBottom = top + ((row + 1) * height) / ROWS;
      if (
        scene.nodes.some(
          (n) =>
            n.x < cellRight &&
            n.x + n.width > cellLeft &&
            n.y < cellBottom &&
            n.y + n.height > cellTop,
        )
      )
        covered++;
    }
  }
  return covered / (COLUMNS * ROWS);
}

/**
 * `slide` and `page` already choose between candidate layouts — on scale-to-fit,
 * which is this same pressure under another name. `wide` and `tall` have no
 * frame to fit into, so they kept whatever elk drew first, and for a sparse
 * graph that is a ribbon: one small box per layer, its column empty above and
 * below, the reader's eye crossing a page of nothing between two boxes that talk
 * to each other.
 *
 * So re-lay the same graph out with the knobs that pull the cross axis in, and
 * take the smallest drawing that costs the reader nothing the ladder can see.
 * Elk runs the candidates in parallel, the way the `slide` path prices its own.
 * Returns `null` when nothing beat the layout it was given.
 */
async function denserLayout(
  base: Scene,
  elkPass: {
    layout: (spec: GraphOptions) => Promise<unknown>;
    toScene: (laidOut: LaidOutNode) => Scene;
    profile: (scene: Scene) => Profile;
  },
): Promise<{ scene: Scene; options: GraphOptions } | null> {
  /**
   * Two knobs, both measured against the whole corpus: fewer layers, or a
   * placement that stops straightening edges through the cross axis. Tighter
   * spacing on its own and elk's `SIMPLE` placement were tried too — the first
   * never won a drawing, the second only ever won one the ladder then refused.
   */
  const densitySpecs: GraphOptions[] = [
    { minLayers: true, dense: true },
    { placement: "LINEAR_SEGMENTS", dense: true },
  ];
  const laidOut = await Promise.allSettled(densitySpecs.map((spec) => elkPass.layout(spec)));
  const areaOf = (scene: Scene) => scene.width * scene.height;
  const baseProfile = elkPass.profile(base);
  let bestArea = areaOf(base) * DENSITY_GAIN;
  let winner: { scene: Scene; options: GraphOptions } | null = null;
  for (const [index, settled] of laidOut.entries()) {
    // Placement strategies and port constraints alike reach elk paths that throw
    // on some models (see the port pass in `layout`); a candidate that fails to
    // lay out is simply not a candidate.
    if (settled.status !== "fulfilled") continue;
    const candidate = elkPass.toScene(settled.value as LaidOutNode);
    if (areaOf(candidate) > bestArea) continue;
    if (!noLadderRegression(baseProfile, elkPass.profile(candidate))) continue;
    bestArea = areaOf(candidate);
    winner = { scene: candidate, options: densitySpecs[index] };
  }
  return winner;
}

type ElkSide = "NORTH" | "SOUTH" | "EAST" | "WEST";

const centerOf = (n: SceneNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

/** The side of `from` that faces `to` — where a flow between them should leave. */
function sideToward(from: SceneNode, to: SceneNode): ElkSide {
  const dx = centerOf(to).x - centerOf(from).x;
  const dy = centerOf(to).y - centerOf(from).y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "WEST" : "EAST") : dy < 0 ? "NORTH" : "SOUTH";
}

/** The side of `n` the point `p` sits on, in elk's compass, or null for none. */
function sideOn(p: { x: number; y: number }, n: SceneNode): ElkSide | null {
  if (p.x > n.x - 2 && p.x < n.x + n.width + 2) {
    if (Math.abs(p.y - n.y) < 2) return "NORTH";
    if (Math.abs(p.y - (n.y + n.height)) < 2) return "SOUTH";
  }
  if (p.y > n.y - 2 && p.y < n.y + n.height + 2) {
    if (Math.abs(p.x - n.x) < 2) return "WEST";
    if (Math.abs(p.x - (n.x + n.width)) < 2) return "EAST";
  }
  return null;
}

/**
 * Which side of `sceneNode` this flow's terminal already sits on in the
 * first-pass scene — the side an unflagged edge keeps, so fixing one bad route
 * does not disturb the good ones around it. Null when the terminal is not on a
 * side of the node (or the edge has no route yet).
 */
function firstPassSide(
  scene: Scene,
  flowId: string,
  role: "src" | "dst",
  sceneNode: SceneNode,
): ElkSide | null {
  const edge = scene.edges.find((candidate) => candidate.id === flowId);
  if (!edge || edge.pts.length < 2) return null;
  return sideOn(role === "src" ? edge.pts[0] : edge.pts[edge.pts.length - 1], sceneNode);
}

/**
 * Is this end of the flow the *elk* source? A role reverses the flow on the way
 * into elk (`elkEnds`, `laidOutReversed`), so the authored source is elk's
 * target — and both port builders below have to agree on that, or they hang two
 * ports with different ids on the same terminal and the second one wins.
 */
const isElkSource = (flow: Model["flows"][number], end: "src" | "dst"): boolean =>
  (end === "src") !== laidOutReversed(flow);

/** The elk port id for one end of a flow, `#out` on elk's source end. */
const elkPortId = (flow: Model["flows"][number], end: "src" | "dst"): string =>
  `${flow.id}#${isElkSource(flow, end) ? "out" : "in"}`;

/**
 * Rebuild `graph` with explicit ports on the nodes `flagged` flows touch, so elk
 * routes them out the side *facing* the counterpart. elk's default for a
 * backward flow in a layered layout is to loop around the outside, departing
 * away from its target and arriving from beyond it (`attachAway`).
 *
 * `elk.port.side` is honored only at `FIXED_SIDE` or stricter, which constrains
 * every edge of the node — so every incident flow gets a port: flagged ones face
 * their counterpart (measured on the first-pass scene), unflagged ones keep the
 * side elk already chose, so a good route is not disturbed to fix a bad one.
 */
function constrainPorts(graph: ElkNode, scene: Scene, flagged: Set<string>, model: Model): void {
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const elkById = new Map<string, ElkNode>();
  const register = (node: ElkNode) => {
    elkById.set(node.id, node);
    for (const child of node.children ?? []) register(child);
  };
  register(graph);
  // Only the flagged flows' nodes are pinned. Pinning *every* flow to its
  // first-pass side was measured worse (attachAway 303 -> 304, nearParallel
  // 63 -> 66, the application-compact regressions back): with no freedom left
  // on the other edges, elk cannot reorganise corridors around the new ports.
  const flaggedNodes = new Set<string>();
  for (const flow of model.flows)
    if (flagged.has(flow.id)) {
      flaggedNodes.add(flow.from);
      flaggedNodes.add(flow.to);
    }
  for (const nodeId of flaggedNodes) {
    const elkNode = elkById.get(nodeId);
    const sceneNode = nodeById.get(nodeId);
    if (!elkNode || !sceneNode) continue;
    const ports: NonNullable<ElkNode["ports"]> = [];
    for (const flow of model.flows) {
      if (flow.from !== nodeId && flow.to !== nodeId) continue;
      const role = flow.from === nodeId ? "src" : "dst";
      const other = nodeById.get(role === "src" ? flow.to : flow.from);
      if (!other) continue;
      const side = flagged.has(flow.id)
        ? sideToward(sceneNode, other)
        : (firstPassSide(scene, flow.id, role, sceneNode) ?? sideToward(sceneNode, other));
      const portId = elkPortId(flow, role);
      // The author already pinned this terminal, and `applyDeclaredPorts` put
      // the port on the node when the graph was built: leave it exactly as
      // declared instead of adding a second port under the same id.
      if ((elkNode.ports ?? []).some((port) => port.id === portId)) continue;
      // 1x1, not 0x0: a zero-size port breaks the scanline constraint's
      // hitbox math inside elk ("Invalid hitboxes for scanline constraint
      // calculation") on hierarchical graphs — measured on every themes/*
      // model, where the constrained pass crashed and fell back to the wrap.
      ports.push({ id: portId, width: 1, height: 1, layoutOptions: { "elk.port.side": side } });
      const elkEdge = (graph.edges ?? []).find((edge) => edge.id === flow.id);
      if (elkEdge) {
        if (isElkSource(flow, role)) elkEdge.sources = [portId];
        else elkEdge.targets = [portId];
      }
    }
    if (!ports.length) continue;
    elkNode.layoutOptions = { ...elkNode.layoutOptions, "elk.portConstraints": "FIXED_SIDE" };
    elkNode.ports = [...(elkNode.ports ?? []), ...ports];
  }
}

/** Everything the elk graph builder needs from the model and its style. */
interface GraphContext {
  model: Model;
  view: View;
  ingressExternal: Set<string>;
  /**
   * Reading-order slot per top-level element, resolved from the `order:` hints
   * (`readingSlots`). Empty for a diagram that declares none, and an empty map
   * leaves the view's partitions untouched (§17).
   */
  slotOf: Map<string, number>;
  compact: boolean;
  numbered: boolean;
  fonts: { edge: number; node: number; cont: number; scale: number };
  businessObjectName: Map<string, string>;
}

interface GraphOptions {
  tight?: boolean;
  minLayers?: boolean;
  /** elk node-placement strategy override (cross-axis spread). */
  placement?: string;
  /** Tighter spacing between layers and nodes — for the density candidates. */
  dense?: boolean;
  /**
   * `false` builds the graph without the derived hub ports (`hubFlowSides`) —
   * the last retry after elk refuses to lay a hub-ported graph out. Anything
   * else, `undefined` included, keeps them.
   */
  hubPorts?: boolean;
  /**
   * Overrides elk's post-compaction strategy. Only the hub-port retry sets it:
   * the scanline failure elk raises on a hub-ported graph comes from that phase,
   * and a differently-compacted layout that honors the ports beats one that
   * drops them (`withHubPortFallback`).
   */
  postCompaction?: "EDGE_LENGTH_CONSTRAINT_LOCKING" | "NONE";
}

/**
 * Node coverage (`nodeCoverage`) at or above which a drawing is dense enough
 * that the density candidates are not worth their layouts. Calibrated by running
 * the corpus with the gate forced open: every drawing that a denser candidate
 * could improve measured below 0.57, and nothing above it changed at all, so the
 * line sits just clear of the last win and the dense half of the corpus pays
 * nothing for a re-layout with nothing to find.
 */
const DENSE_ENOUGH = 0.6;
/**
 * How much smaller a candidate must be before it is worth swapping the layout
 * for. A few percent is layout noise, not a page the reader takes in faster,
 * and churning the corpus for it would make every diff a re-render.
 */
const DENSITY_GAIN = 0.95;

const INGRESS_PARTITION = -1;
/**
 * The entry-side kinds of a view that does not name its own. Actors were the
 * only ones until `ingressKinds` existed, so this keeps a view that omits the
 * field drawing exactly as it did before.
 */
const DEFAULT_INGRESS_KINDS = ["actor", "actor-group"];
const EGRESS_PARTITION = 900;

/**
 * How many reading-order slots one view partition is split into. A partition
 * band becomes `partition * SLOT_SCALE + slot`, so the view's own bands (§9)
 * keep their relative order — every slot of band *n* stays ahead of every slot
 * of band *n+1* — and an `order:` can only move an element inside its own band.
 * Slots are normalised ranks bounded by the number of top-level elements, so no
 * author value can overflow into the next band.
 */
const SLOT_SCALE = 1000;

/** Which elk partition an element belongs to, before its reading-order slot. */
function elkPartitionOf(
  element: Element,
  index: number,
  view: View,
  ingressExternal: Set<string>,
): number {
  if (!view.partitionByOrder) return view.partitions[element.kind] ?? 1;
  if ((view.ingressKinds ?? DEFAULT_INGRESS_KINDS).includes(element.kind)) return INGRESS_PARTITION;
  if (element.kind === "external")
    return ingressExternal.has(element.id) ? INGRESS_PARTITION : EGRESS_PARTITION;
  if (view.partitions[element.kind] !== undefined) return 90 + view.partitions[element.kind];
  return index;
}

/** The top-level ancestor of `id` — the element a flow endpoint is banded with. */
function rootAncestorOf(model: Model, id: string): string | undefined {
  let element = model.index.get(id);
  if (!element) return undefined;
  while (element.parent) element = element.parent;
  return element.id;
}

/**
 * The author's `order:` on a top-level element, resolved into a slot inside that
 * element's view partition — which is what makes it read along the *direction*
 * axis: left to right under `elk.direction: RIGHT` (`wide`/`slide`), top to
 * bottom under `DOWN` (`tall`/`page`). A partition band is a contiguous run of
 * layers, so this is the one lever that sequences elements the flows would
 * otherwise put side by side. elk's own layer constraints do not do it:
 * `layerChoiceConstraint`, `layering.strategy: INTERACTIVE` and
 * `elk.interactiveLayout` were all measured to be no-ops here.
 *
 * Three rules keep it predictable.
 *
 * - **Slots are per view partition.** Ordering happens among the siblings that
 *   share a band, never across bands, so `order:` cannot move an actor-group
 *   past the applications (§9).
 * - **Declared values become ranks.** The distinct `order:` values of a band,
 *   ascending, become slots `1…k`. Gaps in the author's numbering cost nothing,
 *   and no value can reach the next band.
 * - **An element without an `order:` follows the flows into a slot.** elk needs
 *   a partition for every node — one left unpartitioned was measured to drift to
 *   the end of the drawing — so an unordered element takes the highest slot
 *   among the elements that flow *into* it, and the lowest declared slot when
 *   nothing does. That is a monotone fixed point: it terminates on a cyclic
 *   graph and does not depend on the order the flows are visited (§2).
 *
 * Empty unless some top-level element declares an `order:`, and an empty map
 * leaves every partition exactly as it was — which is what keeps a diagram that
 * declares none byte-identical (§17).
 */
function readingSlots(model: Model, view: View, ingressExternal: Set<string>): Map<string, number> {
  const slotOf = new Map<string, number>();
  if (!model.elements.some((element) => element.order)) return slotOf;

  const bandOf = new Map(
    model.elements.map((element, index) => [
      element.id,
      elkPartitionOf(element, index, view, ingressExternal),
    ]),
  );
  const lowestOf = new Map<number, number>();
  for (const band of new Set(bandOf.values())) {
    const members = model.elements.filter((element) => bandOf.get(element.id) === band);
    const declared = [...new Set(members.filter((m) => m.order).map((m) => m.order!.value))].sort(
      (a, b) => a - b,
    );
    // A band nobody ordered keeps one slot, so its members stay as free as they
    // were; `lowest` is then that slot, and the propagation below is a no-op.
    const lowest = declared.length ? 1 : 0;
    lowestOf.set(band, lowest);
    for (const member of members)
      slotOf.set(member.id, member.order ? declared.indexOf(member.order.value) + 1 : lowest);
  }

  // Pull every unordered element forward to the last slot that reaches it, so a
  // flow never has to run backwards into a band it was not placed in.
  const ordered = new Set(model.elements.filter((element) => element.order).map((e) => e.id));
  for (let pass = 0; pass < model.elements.length; pass++) {
    let moved = false;
    for (const flow of model.flows) {
      const from = rootAncestorOf(model, flow.from);
      const to = rootAncestorOf(model, flow.to);
      if (!from || !to || from === to || ordered.has(to)) continue;
      if (bandOf.get(from) !== bandOf.get(to)) continue;
      const candidate = slotOf.get(from)!;
      if (candidate <= slotOf.get(to)!) continue;
      slotOf.set(to, candidate);
      moved = true;
    }
    if (!moved) break;
  }
  return slotOf;
}

/** The flow's ends as elk needs them: data direction, which a role may reverse. */
function elkEnds(flow: Model["flows"][number]): { sources: string[]; targets: string[] } {
  return laidOutReversed(flow)
    ? { sources: [flow.to], targets: [flow.from] }
    : { sources: [flow.from], targets: [flow.to] };
}

/** The elk edge for one flow, with the label it carries already measured. */
function elkFlowEdge(flow: Model["flows"][number], ctx: GraphContext, flowLabelWrap?: number) {
  const { numbered, fonts, businessObjectName } = ctx;
  if (numbered)
    return {
      id: flow.id,
      ...elkEnds(flow),
      labels: [
        {
          text: String(parseInt(flow.id.slice(1), 10)),
          width: Math.round(26 * fonts.scale),
          height: Math.round(17 * fonts.scale),
        },
      ],
    };
  // Only `flow-label-wrap: <n>` breaks a flow label — the flow's own if it
  // names one, else the diagram's — the way `label-wrap` is the only thing that
  // breaks an element's. Left alone it
  // keeps the lines it was written with, whatever the layout would rather it
  // were: `compact: on` and the slide/page fit both used to impose their own
  // widths from here, which is the automatic wrapping #107 removed.
  const wrap = flow.labelWrap ?? flowLabelWrap;
  const raw = flow.label && wrap ? wrapText(flow.label, wrap) : flow.label;
  const chips = (flow.objects ?? []).map(
    (objectRef) => businessObjectName.get(objectRef.id) ?? objectRef.id,
  );
  const tech = techText(flow.tech);
  const text = raw || (tech ? tech : "");
  const labelBox = flowLabelBox({
    text,
    chipNames: chips,
    fontSize: fonts.edge,
    tech: raw ? tech : undefined,
    scale: fonts.scale,
  });
  return {
    id: flow.id,
    ...elkEnds(flow),
    labels: text || chips.length ? [{ text, ...labelBox }] : [],
  };
}

/** The author's side names, as the diagram is read, in elk's compass terms. */
const SIDE_TO_ELK: Record<AttachSide, "NORTH" | "SOUTH" | "EAST" | "WEST"> = {
  left: "WEST",
  right: "EAST",
  top: "NORTH",
  bottom: "SOUTH",
};

/** An attachment side this stage derived for a flow's ends, rather than the author. */
interface DerivedSides {
  from?: AttachSide;
  to?: AttachSide;
}

/**
 * Where the flows of a *hub* — a `queue`, the one kind any view declares in
 * `View.hubKinds` today — attach: everything produced into it arrives on the
 * upstream side, everything consumed out of it leaves on the downstream side, so
 * a reader sees producers on one edge of the box and consumers on the other
 * instead of one undifferentiated fan.
 *
 * Left and right in **every** disposition, because the queue's own glyph is a
 * cylinder lying on its side (`renderQueue`): its mouth is the left and right
 * cap, so a terminal on the flat top reads as missing the box even when the
 * drawing itself runs top to bottom. A DOWN layout does pay for it — elk throws
 * `Invalid hitboxes for scanline constraint calculation` on some hierarchical
 * graphs carrying WEST/EAST ports, which is what `withHubPortFallback` climbs
 * down from.
 *
 * Which cap a flow gets is read from the arrow: into the queue is a producer,
 * out of it a consumer. An endpoint *role* (`INDEXER.consumer -> EVENTS`) needs
 * nothing here — `orientRoleFlows` has already turned that dependency into the
 * exchange it stands for, so the arrow tells the truth by the time this runs.
 *
 * Three limits keep this a layout hint rather than a promise:
 *
 * - **The author outranks it.** An endpoint carrying an `ID.side` pin is left
 *   alone — a derived side never overrides declared intent (INVARIANTS §17).
 * - **It is not a pin.** The terminal is marked `hubSided`, not `pinned`
 *   (`markDeclaredTerminals`): the route repair stands down from re-siding it,
 *   but `attachAway` still counts it — exempting a side *cairn itself* chose
 *   from the gate that measures it would hide the cost (INVARIANTS §3a). No
 *   `W0570` is reported for it either: nothing was declared, so nothing was
 *   dropped.
 * - **It is opt-in per view.** A view without `hubKinds`, or a diagram without a
 *   hub element, produces an empty map and builds the graph it always built.
 */
/**
 * Does this flow have to be handed to elk the other way round?
 *
 * A role names what the annotated element does with the queue at the other end,
 * and both roles are *written* pointing at the queue — `A.producer -> Q` and
 * `B.consumer -> Q` — because that is how a reader looks at a bus: everything
 * touches it. Only elk needs the data direction, to seat a consumer *after* the
 * queue instead of before it; the drawn polyline is flipped back afterwards, so
 * the arrowhead lands where the author put it (`sceneFromResult`).
 */
function laidOutReversed(flow: Model["flows"][number]): boolean {
  return flow.fromRole?.value === "consumer" || flow.toRole?.value === "producer";
}

/**
 * The queue cap a role asks for: a producer's flow meets the left one, a
 * consumer's the right. Read per endpoint, from the role at the *other* end —
 * `A.consumer -> B.producer` between two queues names a cap on each of them,
 * and taking only the first would leave the second at its arrow-derived default.
 */
function roleCap(role: { value: AttachRole } | undefined): AttachSide | null {
  if (!role) return null;
  return role.value === "producer" ? "left" : "right";
}

function hubFlowSides(model: Model, view: View): Map<string, DerivedSides> {
  const derived = new Map<string, DerivedSides>();
  const hubKinds = new Set(view.hubKinds ?? []);
  if (!hubKinds.size) return derived;
  const hubs = new Set(
    indexElementsById(model.elements)
      .filter(([, element]) => hubKinds.has(element.kind))
      .map(([id]) => id),
  );
  if (!hubs.size) return derived;
  for (const flow of model.flows) {
    const sides: DerivedSides = {};
    // A role decides the cap outright; without one the arrow does — into the
    // queue is a producer, out of it a consumer.
    if (hubs.has(flow.to) && !flow.toSide) sides.to = roleCap(flow.fromRole) ?? "left";
    if (hubs.has(flow.from) && !flow.fromSide) sides.from = roleCap(flow.toRole) ?? "right";
    if (sides.to || sides.from) derived.set(flow.id, sides);
  }
  return derived;
}

/**
 * A derived side in the shape the port loop reads author pins in. It carries no
 * `span`, which is the point: only a declared side has a place in the source to
 * report a dropped pin against (`attachSideDiagnostics`).
 */
const sideRequest = (side: AttachSide | undefined) => (side ? { value: side } : undefined);

/**
 * Gives every author-pinned flow terminal — and every terminal `hubFlowSides`
 * derived a side for — an elk port on that side.
 *
 * Only those terminals get a port: the node goes to `FIXED_SIDE`, but its
 * other edges stay portless and elk keeps choosing their sides, which measured
 * identical to the unpinned layout. The 1×1 size is deliberate — a 0×0 port
 * breaks elk's scanline constraint on hierarchical graphs (see `constrainPorts`).
 *
 * A DOWN layout is not transposed on the way out (`runGeometryPasses` mirrors in
 * and back), so elk's compass is the rendered side in every disposition.
 */
function applyDeclaredPorts(
  graph: ElkNode,
  model: Model,
  derived: Map<string, DerivedSides>,
): void {
  const pinned = model.flows.filter((flow) => flow.fromSide || flow.toSide || derived.has(flow.id));
  if (!pinned.length) return;
  const elkById = new Map<string, ElkNode>();
  const register = (node: ElkNode) => {
    elkById.set(node.id, node);
    for (const child of node.children ?? []) register(child);
  };
  register(graph);
  for (const flow of pinned) {
    const elkEdge = (graph.edges ?? []).find((edge) => edge.id === flow.id);
    if (!elkEdge) continue;
    const hub = derived.get(flow.id);
    for (const [role, declared, nodeId] of [
      ["src", flow.fromSide ?? sideRequest(hub?.from), flow.from],
      ["dst", flow.toSide ?? sideRequest(hub?.to), flow.to],
    ] as const) {
      if (!declared) continue;
      const elkNode = elkById.get(nodeId);
      if (!elkNode) continue;
      // `#out` / `#in` name the *elk* ends, which a role may have swapped
      // (`elkEnds`), so a reversed flow's source port is its authored target's.
      const portId = elkPortId(flow, role);
      elkNode.ports = [
        ...(elkNode.ports ?? []),
        {
          id: portId,
          width: 1,
          height: 1,
          layoutOptions: { "elk.port.side": SIDE_TO_ELK[declared.value] },
        },
      ];
      elkNode.layoutOptions = { ...elkNode.layoutOptions, "elk.portConstraints": "FIXED_SIDE" };
      if (isElkSource(flow, role)) elkEdge.sources = [portId];
      else elkEdge.targets = [portId];
    }
  }
}

/** Which side of `node` the point `p` sits on, or null when it is on none. */
function terminalSide(p: Point, node: SceneNode): AttachSide | null {
  if (p.x > node.x - 2 && p.x < node.x + node.width + 2) {
    if (Math.abs(p.y - node.y) < 2) return "top";
    if (Math.abs(p.y - (node.y + node.height)) < 2) return "bottom";
  }
  if (p.y > node.y - 2 && p.y < node.y + node.height + 2) {
    if (Math.abs(p.x - node.x) < 2) return "left";
    if (Math.abs(p.x - (node.x + node.width)) < 2) return "right";
  }
  return null;
}

/**
 * W0570 for every declared attachment side the finished drawing does not show.
 * Layout-derived, like W0520: elk honors a port side in the graph, but the
 * geometry passes that follow may still move a terminal, and a pin that silently
 * did nothing is worth telling the author about. Runs after every pass.
 */
export function attachSideDiagnostics(scene: Scene, model: Model): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  for (const flow of model.flows) {
    if (!flow.fromSide && !flow.toSide) continue;
    const edge = scene.edges.find((candidate) => candidate.id === flow.id);
    if (!edge || edge.pts.length < 2) continue;
    for (const [declared, nodeId, point, role] of [
      [flow.fromSide, flow.from, edge.pts[0], "leaves"],
      [flow.toSide, flow.to, edge.pts[edge.pts.length - 1], "arrives on"],
    ] as const) {
      const node = declared ? nodeById.get(nodeId) : undefined;
      if (!declared || !node) continue;
      const actual = terminalSide(point, node);
      if (actual === declared.value) continue;
      diagnostics.push({
        code: "W0570",
        severity: "warning",
        message: `attachment side \`${declared.value}\` could not be honored`,
        span: declared.span,
        note: actual
          ? `the flow ${role} the ${actual} side of \`${nodeId}\``
          : `the flow does not ${role} a side of \`${nodeId}\` cleanly`,
        help: "a side the layout cannot reach is dropped rather than forced — try the opposite endpoint, or `order:` to move the element instead",
      });
    }
  }
  return diagnostics;
}

/** The whole model as one elk graph, in the given direction. */
function buildElkGraph(
  ctx: GraphContext,
  direction: "RIGHT" | "DOWN",
  options?: GraphOptions,
): ElkNode {
  const { model, view, ingressExternal, slotOf, compact, numbered, fonts } = ctx;
  // `slide-fold.ts` sizes nodes on its own path, so it reserves the same gutter
  // there (`leafSize`). The two must stay in step: a view that declares
  // `glyphKinds` without `partitionByOrder` — the application view — is laid out
  // by `foldedLayout` on slides, and a gutter reserved in only one of the two
  // paths puts a glyph on top of a label.
  const glyphKinds = new Set(view.glyphKinds ?? []);
  const graph: ElkNode = {
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
      "elk.layered.compaction.postCompaction.strategy": options?.postCompaction ?? "EDGE_LENGTH",
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
      // Spread last, after every spacing default above, because overriding them
      // is the whole point — a density candidate that lands before them is
      // silently shadowed and lays out exactly like the layout it was meant to
      // beat.
      ...(options?.dense
        ? {
            "elk.layered.spacing.nodeNodeBetweenLayers": "14",
            "elk.spacing.nodeNode": "10",
            "elk.spacing.edgeEdge": "8",
            "elk.spacing.edgeNode": "9",
          }
        : {}),
      ...(options?.placement ? { "elk.layered.nodePlacement.strategy": options.placement } : {}),
    },
    children: model.elements.map((element, index) => {
      const elkNode = toElkNode(
        element,
        {
          compact,
          fonts,
          glyphKinds,
          containerPadding: model.style.containerPadding,
          labelPadding: model.style.labelPadding,
        },
        true,
      );
      const band = elkPartitionOf(element, index, view, ingressExternal);
      const slot = slotOf.get(element.id);
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        // Without an `order:` anywhere the band is emitted as it always was, so
        // the drawing is byte-identical to one from before the hint existed.
        "elk.partitioning.partition": String(slot === undefined ? band : band * SLOT_SCALE + slot),
      };
      return elkNode;
    }),
    edges: model.flows.map((flow) => elkFlowEdge(flow, ctx, model.style.flowLabelWrap)),
  };
  applyDeclaredPorts(
    graph,
    model,
    options?.hubPorts === false ? new Map() : hubFlowSides(model, view),
  );
  return graph;
}

/**
 * Record *every* edge the repair moved. Restricting it to edges whose label was
 * seated beforehand made the rollback partial, leaving a drawing half repaired —
 * a state neither pass ever evaluated, and the source of `coincident` runs, a
 * must-be-zero breach. Worth is judged whole-drawing in the renderer; this only
 * has to make the undo complete.
 */
function recordRepairs(scene: Scene, routesBefore: Map<string, Point[]>): void {
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
}

/**
 * Every pass that moves geometry after elk has laid the graph out, in the order
 * the invariants require. Title bands are re-derived before each pass that reads
 * them, never carried across one that moves nodes.
 */
/** Do two axis-aligned segments properly cross? Shared endpoints do not count. */
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aH = Math.abs(a1.y - a2.y) < 0.5;
  const bH = Math.abs(b1.y - b2.y) < 0.5;
  if (aH === bH) return false;
  const [h1, h2, v1, v2] = aH ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
  const hy = h1.y;
  const vx = v1.x;
  return (
    vx > Math.min(h1.x, h2.x) + 0.5 &&
    vx < Math.max(h1.x, h2.x) - 0.5 &&
    hy > Math.min(v1.y, v2.y) + 0.5 &&
    hy < Math.max(v1.y, v2.y) - 0.5
  );
}

/**
 * Interior runs short enough to read as a kink rather than a turn — the same
 * `jog<=20` the sweep counts. Endpoints are excluded: only a segment with a run
 * on either side of it is a jog.
 */
function shortJogs(edges: SceneEdge[]): number {
  let total = 0;
  for (const edge of edges)
    for (let i = 1; i + 2 < edge.pts.length; i++) {
      const run =
        Math.abs(edge.pts[i + 1].x - edge.pts[i].x) + Math.abs(edge.pts[i + 1].y - edge.pts[i].y);
      if (run > 0 && run <= 20) total++;
    }
  return total;
}

/** Crossings between the given edges and every edge in the scene. */
function crossingsAround(scene: Scene, subject: SceneEdge[]): number {
  let total = 0;
  const subjectIds = new Set(subject.map((edge) => edge.id));
  for (const edge of subject)
    for (const other of scene.edges) {
      if (other.id === edge.id) continue;
      if (subjectIds.has(other.id) && other.id < edge.id) continue;
      for (let i = 1; i < edge.pts.length; i++)
        for (let j = 1; j < other.pts.length; j++)
          if (segmentsCross(edge.pts[i - 1], edge.pts[i], other.pts[j - 1], other.pts[j])) total++;
    }
  return total;
}

/** Leaf boxes a run must not cross — the same set `sweep`'s `throughBox` tests. */
function leafBoxesOf(scene: Scene): SceneNode[] {
  return scene.nodes.filter((node) => !node.container);
}

/** Does any segment of `edge` cross a leaf box it is not attached to? */
function crossesLeaf(edge: SceneEdge, leaves: SceneNode[], attached: Set<string>): boolean {
  for (let i = 1; i < edge.pts.length; i++) {
    const a = edge.pts[i - 1];
    const b = edge.pts[i];
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const vertical = Math.abs(a.x - b.x) < 0.5;
    if (!horizontal && !vertical) continue;
    const at = horizontal ? a.y : a.x;
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    for (const node of leaves) {
      if (attached.has(node.id)) continue;
      const struck = horizontal
        ? at > node.y + 1 &&
          at < node.y + node.height - 1 &&
          lo < node.x + node.width - 1 &&
          hi > node.x + 1
        : at > node.x + 1 &&
          at < node.x + node.width - 1 &&
          lo < node.y + node.height - 1 &&
          hi > node.y + 1;
      if (struck) return true;
    }
  }
  return false;
}

/**
 * Snaps nodes sharing a lane id onto one coordinate along the reading axis.
 * Reads a geometry-keyed map and a `container` boolean only — no kind, no view
 * name (invariant §16), the same shape as the `pinned` flag.
 *
 * Every snap is *proposed, verified and kept or rolled back*: a move whose edges
 * would strike a leaf box, overlap a leaf or a container, add a crossing, tilt a
 * run off the orthogonal, or kink one into a jog is undone, so the pass cannot
 * introduce the defects it was measured to introduce. A lane that cannot be
 * seated cleanly simply stays as elk drew it — a fallback, not a weakened
 * threshold.
 */
function snapLanes(scene: Scene, laneOf: Map<string, number>, axis: "x" | "y"): void {
  if (!laneOf.size) return;
  const leaves = leafBoxesOf(scene);
  /**
   * Segments running on neither axis. A snap shifts only the points that sat
   * inside the old box, so a segment straddling its edge comes out tilted — and
   * `crossesLeaf` skips non-orthogonal runs, so a tilt it introduced would slip
   * past the gate and reach the squaring passes with geometry nothing judged.
   * Counted before and after like the crossings and the jogs, never asserted
   * outright: elk emits slanted segments of its own, and refusing those refuses
   * lanes for geometry the move never touched.
   */
  const tilted = (edges: SceneEdge[]) =>
    edges.reduce(
      (total, edge) =>
        total +
        edge.pts.filter(
          (point, i) =>
            i > 0 &&
            Math.abs(point.x - edge.pts[i - 1].x) >= 0.5 &&
            Math.abs(point.y - edge.pts[i - 1].y) >= 0.5,
        ).length,
      0,
    );
  const touching = new Map<string, SceneEdge[]>();
  const attachedTo = new Map<string, Set<string>>();
  for (const edge of scene.edges) {
    const ends = new Set<string>();
    for (const point of [edge.pts[0], edge.pts[edge.pts.length - 1]]) {
      if (!point) continue;
      for (const node of scene.nodes)
        if (
          point.x >= node.x - 1 &&
          point.x <= node.x + node.width + 1 &&
          point.y >= node.y - 1 &&
          point.y <= node.y + node.height + 1
        ) {
          ends.add(node.id);
          if (!touching.has(node.id)) touching.set(node.id, []);
          touching.get(node.id)!.push(edge);
        }
    }
    attachedTo.set(edge.id, ends);
  }

  const byLane = new Map<number, SceneNode[]>();
  for (const node of scene.nodes) {
    const lane = laneOf.get(node.id);
    if (lane === undefined) continue;
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane)!.push(node);
  }

  for (const members of [...byLane.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
    if (members.length < 2) continue;
    // Forward along the reading direction: a node pulled backwards would cross
    // its own source and turn a forward flow into a backward one.
    const target = Math.max(...members.map((node) => node[axis]));
    for (const node of members) {
      const delta = target - node[axis];
      if (!delta) continue;
      const box = { x: node.x, y: node.y, w: node.width, h: node.height };
      const edges = touching.get(node.id) ?? [];
      const before = edges.map((edge) => edge.pts.map((point) => ({ ...point })));
      const crossingsBefore = crossingsAround(scene, edges);
      const jogsBefore = shortJogs(edges);
      const tiltsBefore = tilted(edges);
      node[axis] = target;
      for (const edge of edges)
        for (const point of edge.pts)
          if (
            point.x >= box.x - 1 &&
            point.x <= box.x + box.w + 1 &&
            point.y >= box.y - 1 &&
            point.y <= box.y + box.h + 1
          )
            point[axis] += delta;
      const broke =
        crossingsAround(scene, edges) > crossingsBefore ||
        shortJogs(edges) > jogsBefore ||
        tilted(edges) > tiltsBefore ||
        edges.some((edge) => crossesLeaf(edge, leaves, attachedTo.get(edge.id) ?? new Set())) ||
        // Containers included: a lane member is top-level, so it has no
        // legitimate container ancestor and may not land on one.
        scene.nodes.some(
          (other) =>
            other !== node &&
            !node.container &&
            other.x < node.x + node.width &&
            node.x < other.x + other.width &&
            other.y < node.y + node.height &&
            node.y < other.y + other.height,
        );
      if (broke) {
        node[axis] = target - delta;
        edges.forEach((edge, i) => {
          edge.pts = before[i];
        });
      }
    }
  }
  const maxX = Math.max(...scene.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...scene.nodes.map((node) => node.y + node.height));
  scene.width = Math.max(scene.width, Math.ceil(maxX) + 10);
  scene.height = Math.max(scene.height, Math.ceil(maxY) + 10);
}

/**
 * The author's `offset:` per element id, with a container's delta carried down
 * to everything inside it and a child's own offset added on top. Computed from
 * the model *before* any `Scene` exists — the same shape as `laneAssignment`,
 * so the pass below reads a geometry-keyed map and never the DSL (§16).
 *
 * Empty unless some element declares an `offset:`, and an empty map makes the
 * pass a no-op, which is what keeps an offset-free diagram byte-identical.
 */
function offsetAssignment(model: Model): Map<string, OffsetSpec> {
  const offsetOf = new Map<string, OffsetSpec>();
  const walk = (elements: Element[], parent: string | undefined, inherited: boolean): void => {
    for (const element of elements) {
      const own = element.offset;
      // An element inside a moved container has an entry even with no `offset:`
      // of its own: it still moves, and the pass resolves each delta against its
      // parent's rather than carrying a pre-summed one, so a parent the
      // containment clamp cut short does not hand its children a delta the
      // drawing never used.
      const moved = inherited || !!own;
      if (moved) offsetOf.set(element.id, { dx: own?.dx ?? 0, dy: own?.dy ?? 0, parent });
      walk(element.children, element.id, moved);
    }
  };
  walk(model.elements, undefined, false);
  return offsetOf;
}

/**
 * Copies each flow's `label-offset:` onto its label boxes, where the model is
 * still in reach — `anchorFlowLabels` then reads a plain delta and stays blind
 * to the DSL (§16).
 */
function stampLabelOffsets(edges: SceneEdge[], model: Model): void {
  const declaredOf = new Map(
    model.flows.filter((flow) => flow.labelOffset).map((flow) => [flow.id, flow.labelOffset!]),
  );
  for (const edge of edges) {
    const declared = declaredOf.get(edge.id);
    if (!declared) continue;
    for (const label of edge.labels) label.offset = { dx: declared.dx, dy: declared.dy };
  }
}

/**
 * One element's own `offset:` and the id of the element that holds it — ids and
 * numbers only, no kinds and no view names, so the pass below stays blind to
 * the DSL (§16).
 */
interface OffsetSpec {
  dx: number;
  dy: number;
  parent?: string;
}

/** Is `point` on or inside `box`, within a pixel of its border? */
const pointOn = (point: Point, box: Box): boolean =>
  point.x >= box.x - 1 &&
  point.x <= box.x + box.width + 1 &&
  point.y >= box.y - 1 &&
  point.y <= box.y + box.height + 1;

/**
 * Resizes the containers the author pulled a handle on, and carries every flow
 * terminal sitting on a border that moved.
 *
 * A delta on what the layout computed, like `offset:` and for the same reason:
 * elk sizes a container from the content it holds, so a hint naming an absolute
 * box would go stale the moment a child is added. The top-left corner stays put
 * — growing is done to the right and down, and a handle on the other two sides
 * writes an `offset:` for the move and a `size:` for the rest.
 *
 * Nothing re-flows. A container grown into its neighbour is drawn as asked and
 * the overlap reported (W0572), exactly as an `offset:` is (§17). One clamp
 * bounds it, and it is nesting rather than taste (§7): a container may not
 * shrink inside its own children (W0575).
 *
 * Upward there is no clamp. A container grown past its parent makes the *parent*
 * grow — by just enough to keep holding it, and on up the chain. Cutting the
 * child back to fit instead refused the resize outright, which is the whole
 * gesture doing nothing.
 *
 * Runs before `applyNodeOffsets`, which holds each child inside its parent —
 * the room a parent has to give must be settled before anything is held in it.
 *
 * Returns the flows whose terminal it carried, for the same re-aim and repair
 * an offset's carried flows get.
 */
/** The smallest a `size:` may leave one container: what it holds, plus the gap
    the layout keeps around it. Absolute pixels, not a delta — the hint is a
    delta, but what floors it is where the geometry already is.

    There is no ceiling. A container that outgrows its parent is not clamped; the
    parent grows to hold it (`containWithin`). */
export interface SizeBounds {
  minWidth: number;
  minHeight: number;
}

/**
 * The floor under each container's `size:`, on the geometry as it stands.
 *
 * Exported because two callers must agree on it to the pixel: the pass that
 * applies the hint, and `compile()`'s boxes, which is how an editor knows where
 * to stop a resize handle. A guard that measured this differently from the pass
 * would let the playground promise a box the engine then refuses to draw (§3a).
 */
export function containerSizeBounds(scene: Scene, model: Model): Map<string, SizeBounds> {
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const pad = containerPad(model);
  const bounds = new Map<string, SizeBounds>();
  const walk = (elements: Element[]): void => {
    for (const element of elements) {
      walk(element.children);
      const node = nodeById.get(element.id);
      if (node?.container) bounds.set(element.id, contentFloor({ node, element, nodeById, pad }));
    }
  };
  walk(model.elements);
  return bounds;
}

/** The gap the layout keeps between a container's border and what it holds — so
    a resized container reads like every other one rather than shrink-wrapped. */
const containerPad = (model: Model) =>
  model.style.containerPadding ?? (model.style.compact ? 7 : 9);

/** What is left between two children a squeeze has pushed together. Matches
    `compactHorizontal`'s column gap: elk leaves exactly this either side of a
    centred edge label, so a band already sized to one is not taken. */
const MIN_SIBLING_GAP = 20;

/** One container and the scene around it — what every size measurement needs,
    bundled so the four of them travel together instead of as four parameters. */
interface SizedContainer {
  node: SceneNode;
  element: Element;
  nodeById: Map<string, SceneNode>;
  /** The gap the layout keeps between the border and what it holds. */
  pad: number;
}

/** Its direct children, as scene boxes. */
const kidsOf = (box: SizedContainer): SceneNode[] =>
  box.element.children
    .map((child) => box.nodeById.get(child.id))
    .filter((child): child is SceneNode => !!child);

/** One band of empty space inside a container, along whichever axis is being
    measured, and how much of it a squeeze may take. */
interface FreeBand {
  start: number;
  end: number;
  spare: number;
}

/**
 * The empty bands inside `node` along one axis, in order.
 *
 * A band is free where no child sits across it — merged extents, so two children
 * stacked on the other axis hold their column between them exactly as one wide
 * child would. The bands at the two ends keep the container's padding; the ones
 * between children keep `MIN_SIBLING_GAP`, and only what is over those is spare.
 *
 * This is where a shrink comes from. A container hugs its children — elk sizes
 * it that way — so its border has nothing to give: the room is the gaps *inside*
 * it, and closing them is the only thing "make this narrower" can mean without
 * moving a box outside the container or drawing it over its own content.
 */
function freeBands(box: SizedContainer, axis: Axis): FreeBand[] {
  const { node, pad } = box;
  const { min, size } = AXIS[axis];
  const spans = kidsOf(box)
    .map((kid) => ({ start: kid[min], end: kid[min] + kid[size] }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  if (!merged.length) return [];
  const bands: FreeBand[] = [];
  const add = (start: number, end: number, keep: number) => {
    if (end - start > keep) bands.push({ start, end, spare: end - start - keep });
  };
  add(node[min], merged[0].start, pad);
  for (let i = 0; i + 1 < merged.length; i++)
    add(merged[i].end, merged[i + 1].start, MIN_SIBLING_GAP);
  add(merged[merged.length - 1].end, node[min] + node[size], pad);
  return bands;
}

/** Which scene-box fields one axis reads. */
type Axis = "x" | "y";
const AXIS = {
  x: { min: "x", size: "width" },
  y: { min: "y", size: "height" },
} as const satisfies Record<Axis, { min: "x" | "y"; size: "width" | "height" }>;

/**
 * The smallest box that still *contains* this container's children where they
 * currently sit, with the padding around them.
 *
 * Not the same question as `contentFloor`, and neither bounds the other: this
 * one asks how big a container must be for what is in it, which is what makes a
 * parent grow when a child outgrows it. `contentFloor` asks how small it can be
 * squeezed, which is a statement about the empty room *between* those children.
 */
function holdsChildren(box: SizedContainer): SizeBounds {
  const { node, pad } = box;
  const kids = kidsOf(box);
  if (!kids.length) return { minWidth: pad * 2, minHeight: pad * 2 };
  return {
    minWidth: Math.max(...kids.map((kid) => kid.x + kid.width)) + pad - node.x,
    minHeight: Math.max(...kids.map((kid) => kid.y + kid.height)) + pad - node.y,
  };
}

/**
 * The smallest box this container can be squeezed into: what it is now, less
 * every spare band inside it.
 */
function contentFloor(box: SizedContainer): SizeBounds {
  const { node, pad } = box;
  if (!kidsOf(box).length) return { minWidth: pad * 2, minHeight: pad * 2 };
  const spare = (axis: Axis) =>
    freeBands(box, axis).reduce((total, band) => total + band.spare, 0);
  return { minWidth: node.width - spare("x"), minHeight: node.height - spare("y") };
}

/**
 * Closes the empty bands inside `node` along one axis until it is `target` long,
 * moving each child — and its whole subtree — that sits past one.
 *
 * This is what makes "narrower" mean anything. A container is sized by elk to
 * hug its children, so its border has no slack of its own: asked to shrink, it
 * either takes the room from the gaps between what it holds or does nothing at
 * all, and doing nothing is what a resize grip that refuses to move looks like.
 *
 * The bands give up their spare room in proportion, so the drawing keeps its
 * shape as it tightens rather than collapsing one gap first. A band is never
 * taken below `MIN_SIBLING_GAP` — or the container's own padding at the two ends
 * — so children never touch, and the fraction is capped at 1, which is exactly
 * the floor `contentFloor` reports.
 *
 * Right to left, accumulating: everything past a band shifts by what every band
 * before it gave up, which is the same monotone piecewise map `compactVertical`
 * uses. Growing needs none of this — the far border simply moves out — so this
 * returns untouched for any `target` at or above the current size.
 */
function squeezeInside(box: SizedContainer, axis: Axis, target: number): void {
  const { min, size } = AXIS[axis];
  const need = box.node[size] - target;
  if (need <= 0) return;
  const bands = freeBands(box, axis);
  const spare = bands.reduce((total, band) => total + band.spare, 0);
  if (spare <= 0) return;
  const share = Math.min(1, need / spare);
  // How far something at `at` slides back, which is what every band before it
  // gave up. The first band is at the container's own leading edge and moves
  // everything inside; the last sits against the far border and moves nothing.
  const shiftAt = (at: number) =>
    bands.reduce((total, band) => (at >= band.end ? total + band.spare * share : total), 0);
  for (const child of box.element.children) {
    const kid = box.nodeById.get(child.id);
    if (!kid) continue;
    const shift = shiftAt(kid[min]);
    if (!shift) continue;
    for (const id of subtreeIds(child)) {
      const inside = box.nodeById.get(id);
      if (inside) inside[min] -= shift;
    }
  }
}

function applyContainerSizes(scene: Scene, model: Model): Set<string> {
  const carried = new Set<string>();
  const wanted = new Map<string, { dw: number; dh: number; span: Span }>();
  // Pre-order, so a container is always resized before the children it gives
  // room to and after the parent whose room bounds it.
  const walk = (elements: Element[]): void => {
    for (const element of elements) {
      if (element.size) wanted.set(element.id, element.size);
      walk(element.children);
    }
  };
  walk(model.elements);
  if (!wanted.size) return carried;

  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const pad = containerPad(model);
  const clampedSpans = new Set<Span>();
  // Snapshot before any border moves: a terminal is matched against the box it
  // was seated on, not one a later step has already grown.
  const before = new Map(
    scene.nodes.map((node) => [
      node.id,
      { x: node.x, y: node.y, width: node.width, height: node.height },
    ]),
  );

  // What the author asked for. Growing just moves the far border out; shrinking
  // closes the empty bands inside, because a container hugs its children and has
  // nothing else to give.
  for (const [id, spec] of wanted) {
    const node = nodeById.get(id);
    const element = model.index.get(id);
    if (!node || !element) continue;
    const box = { node, element, nodeById, pad };
    const floor = contentFloor(box);
    const width = Math.max(node.width + spec.dw, floor.minWidth);
    const height = Math.max(node.height + spec.dh, floor.minHeight);
    if (width !== node.width + spec.dw || height !== node.height + spec.dh)
      clampedSpans.add(spec.span);
    squeezeInside(box, "x", width);
    squeezeInside(box, "y", height);
    node.width = width;
    node.height = height;
  }

  // And every ancestor then opens up just enough to keep holding what it holds.
  // A container grown past its parent is not cut back to fit — the parent makes
  // room, because "big enough for what is in it" is what a container *is*, and
  // an author who enlarges an inner layer means the layer, not the layer as far
  // as its current frame happens to allow.
  //
  // Post-order, so a container is squared up only once the children it must
  // contain have finished growing, and the cascade reaches the root in one pass.
  const containWithin = (elements: Element[]): void => {
    for (const element of elements) {
      containWithin(element.children);
      const node = nodeById.get(element.id);
      if (!node?.container) continue;
      const holds = holdsChildren({ node, element, nodeById, pad });
      node.width = Math.max(node.width, holds.minWidth);
      node.height = Math.max(node.height, holds.minHeight);
    }
  };
  containWithin(model.elements);

  if (clampedSpans.size) scene.clampedSizes = clampedSpans;
  // Every box this pass touched, against where it was. A squeeze moves boxes and
  // a resize moves borders, so a seat carries both — smallest first, because a
  // terminal inside a container is seated on the leaf and only the leaf's own
  // change describes where it went.
  const seats: { box: Box; dx: number; dy: number; dw: number; dh: number }[] = [];
  for (const node of scene.nodes) {
    const was = before.get(node.id);
    if (!was) continue;
    const moved = {
      dx: node.x - was.x,
      dy: node.y - was.y,
      dw: node.width - was.width,
      dh: node.height - was.height,
    };
    if (!moved.dx && !moved.dy && !moved.dw && !moved.dh) continue;
    seats.push({ box: was, ...moved });
  }
  seats.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  if (!seats.length) return carried;

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    for (const which of ["first", "last"] as const) {
      const terminal = edge.pts[which === "first" ? 0 : edge.pts.length - 1];
      const seat = seats.find((candidate) => pointOn(terminal, candidate.box));
      if (!seat) continue;
      // A box that moved takes its whole border with it; a box that was resized
      // moves only its east and south faces, the top-left corner being the
      // anchor. A seat on the north or west face of a resized box therefore
      // stays exactly where it was.
      const onRight = Math.abs(terminal.x - (seat.box.x + seat.box.width)) < SEGMENT_EPSILON;
      const onBottom = Math.abs(terminal.y - (seat.box.y + seat.box.height)) < SEGMENT_EPSILON;
      const delta = {
        dx: seat.dx + (onRight ? seat.dw : 0),
        dy: seat.dy + (onBottom ? seat.dh : 0),
      };
      if (!delta.dx && !delta.dy) continue;
      carried.add(edge.id);
      carryTerminal(edge, which, delta);
    }
  }
  for (const edge of scene.edges) if (carried.has(edge.id)) dropRedundantPoints(edge.pts);
  return carried;
}

/**
 * Moves the nodes the author nudged, and carries every flow terminal seated on
 * one along with it so the flow stays attached.
 *
 * A terminal that moves leaves its first segment slanted, and a slanted segment
 * is a tier-0 breach (§3). So the elbow is rebuilt rather than left to the route
 * repair, which is free to refuse a candidate and keep what it was given: one
 * point is inserted between the moved terminal and its neighbour, on the axis
 * the original segment did *not* run along. That is orthogonal by construction
 * for any delta, and degenerates to nothing when the delta is zero on that axis
 * — the zero-length segment is dropped.
 *
 * Runs from `applyAuthorPositioning`, on the layout that already won — never
 * inside the pipeline that builds a candidate, or the nudge would be measured as
 * if the router had chosen it (§17). Nothing re-routes afterwards, so the elbow
 * rebuilt here is the repair, and `fitCanvas` grows the canvas for anything the
 * offset pushed past its edge (§18).
 *
 * Returns the flows whose terminal it carried, which is the only set
 * `reaimAfterOffsets` is allowed to touch.
 */
function applyNodeOffsets(scene: Scene, offsetOf: Map<string, OffsetSpec>): Set<string> {
  const carried = new Set<string>();
  if (!offsetOf.size) return carried;
  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const clamped = new Set<string>();
  const resolved = new Map<string, { dx: number; dy: number }>();

  /**
   * The delta an element actually moves by: its own, on top of whatever its
   * container ended up moving by, and then held inside that container.
   *
   * The clamp is the one place an offset is negotiated, and deliberately so —
   * a block drawn outside the system that contains it does not read as a nudged
   * block, it reads as a broken diagram. Nesting is what the drawing *means*
   * (§7); a nudge is a preference about where inside it something sits.
   *
   * Memoised and resolved through the parent chain, so a container is always
   * settled before the children whose room it defines.
   */
  const deltaOf = (id: string): { dx: number; dy: number } => {
    const memo = resolved.get(id);
    if (memo) return memo;
    const spec = offsetOf.get(id);
    if (!spec) return { dx: 0, dy: 0 };
    // Seeded before recursing: a malformed parent chain would otherwise spin
    // here, and a layout must not hang on bad input.
    resolved.set(id, { dx: 0, dy: 0 });
    const inherited = spec.parent ? deltaOf(spec.parent) : { dx: 0, dy: 0 };
    let dx = inherited.dx + spec.dx;
    let dy = inherited.dy + spec.dy;
    const node = nodeById.get(id);
    const parent = spec.parent ? nodeById.get(spec.parent) : undefined;
    if (node && parent) {
      const room = {
        x: parent.x + inherited.dx,
        y: parent.y + inherited.dy,
        right: parent.x + inherited.dx + parent.width - node.width,
        bottom: parent.y + inherited.dy + parent.height - node.height,
      };
      const held = {
        dx: Math.min(Math.max(node.x + dx, room.x), Math.max(room.right, room.x)) - node.x,
        dy: Math.min(Math.max(node.y + dy, room.y), Math.max(room.bottom, room.y)) - node.y,
      };
      if (held.dx !== dx || held.dy !== dy) clamped.add(id);
      dx = held.dx;
      dy = held.dy;
    }
    const delta = { dx, dy };
    resolved.set(id, delta);
    return delta;
  };

  for (const id of offsetOf.keys()) deltaOf(id);
  if (clamped.size) scene.clampedOffsets = clamped;

  // Snapshot before anything moves: a terminal is matched against the box it was
  // seated on, not against a box some earlier iteration has already shifted.
  const seats = scene.nodes
    .filter((node) => resolved.has(node.id))
    .map((node) => ({
      box: { x: node.x, y: node.y, width: node.width, height: node.height },
      delta: resolved.get(node.id)!,
      area: node.width * node.height,
    }))
    .sort((a, b) => a.area - b.area);

  const bands = scene.pinnedBands ?? [];
  for (const node of scene.nodes) {
    const delta = resolved.get(node.id);
    if (!delta) continue;
    // The corridor the node crossed is intentional space; pin it before moving,
    // while both extents are still known.
    if (delta.dy)
      bands.push({
        top: Math.min(node.y, node.y + delta.dy),
        bottom: Math.max(node.y + node.height, node.y + delta.dy + node.height),
      });
    node.x += delta.dx;
    node.y += delta.dy;
  }
  if (bands.length) scene.pinnedBands = bands;

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    // Recomputed per end, never snapshotted: the first iteration can splice an
    // elbow in and grow `pts`, and a stale `length - 1` then names an interior
    // point. An edge with both ends on moved nodes had its target shifted at the
    // wrong index and left the real terminal behind, detached.
    for (const which of [0, 1]) {
      const end = which === 0 ? 0 : edge.pts.length - 1;
      const terminal = edge.pts[end];
      // Smallest box first: a terminal inside a container is seated on the leaf,
      // and only the leaf's own delta describes where it went.
      const seat = seats.find((candidate) => pointOn(terminal, candidate.box));
      if (!seat || (!seat.delta.dx && !seat.delta.dy)) continue;
      // Named for the re-aim below, which is only ever this pass's business.
      carried.add(edge.id);
      carryTerminal(edge, end === 0 ? "first" : "last", seat.delta);
    }
  }
  for (const edge of scene.edges) if (carried.has(edge.id)) dropRedundantPoints(edge.pts);
  return carried;
}

/**
 * Moves one end of a route by `delta` and squares the elbow beside it.
 *
 * The elbow goes on the *neighbour's* side of the move, so the terminal keeps
 * meeting its box across the border rather than along it. Squaring the other way
 * is orthogonal too, but it turns this end's approach a quarter turn: a seat on
 * a west side gets a vertical last segment, and the arrowhead then points down
 * the border it lands on. Where the neighbour is the flow's *other* terminal the
 * turn only moves to that end, which is what `reaimAfterOffsets` settles.
 *
 * Shared by the two hints that move a terminal without asking the router: an
 * `offset:` that carries the box it is seated on, and a `size:` that moves the
 * border under it.
 */
function carryTerminal(
  edge: SceneEdge,
  which: "first" | "last",
  delta: { dx: number; dy: number },
): void {
  const end = which === "first" ? 0 : edge.pts.length - 1;
  const terminal = edge.pts[end];
  const neighbour = edge.pts[which === "first" ? 1 : edge.pts.length - 2];
  const wasHorizontal = Math.abs(terminal.y - neighbour.y) < SEGMENT_EPSILON;
  terminal.x += delta.dx;
  terminal.y += delta.dy;
  const elbow = wasHorizontal
    ? { x: neighbour.x, y: terminal.y }
    : { x: terminal.x, y: neighbour.y };
  const degenerate =
    (Math.abs(elbow.x - terminal.x) < SEGMENT_EPSILON &&
      Math.abs(elbow.y - terminal.y) < SEGMENT_EPSILON) ||
    (Math.abs(elbow.x - neighbour.x) < SEGMENT_EPSILON &&
      Math.abs(elbow.y - neighbour.y) < SEGMENT_EPSILON);
  if (!degenerate) edge.pts.splice(which === "first" ? 1 : edge.pts.length - 1, 0, elbow);
}

/**
 * Drops interior points whose two segments run along the same axis.
 *
 * The elbow spliced above lands beside the terminal it squares, which leaves the
 * point that used to be the corner in line with it — and where the element moved
 * *past* that corner, in line but beyond it, so the route runs out to the old
 * seat and back. `M … L 430 611 L 430 237 L 430 339 L 483 339`: a spur up to
 * where the queue used to be, drawn over the run that already goes there.
 *
 * Removing such a point cannot bend anything, since the two segments it joined
 * shared an axis and what is left still runs along it. Only routes an offset
 * actually moved are touched, so a drawing with no hint keeps its geometry —
 * redundant points and all — to the byte.
 *
 * Backwards, so one removal cannot skip the next: dropping `i` makes the old
 * `i + 1` the new `i`, which a forward walk would step straight over.
 */
function dropRedundantPoints(pts: Point[]): void {
  const inLine = (a: Point, b: Point, c: Point): boolean =>
    (Math.abs(a.x - b.x) < SEGMENT_EPSILON && Math.abs(b.x - c.x) < SEGMENT_EPSILON) ||
    (Math.abs(a.y - b.y) < SEGMENT_EPSILON && Math.abs(b.y - c.y) < SEGMENT_EPSILON);
  for (let i = pts.length - 2; i >= 1; i--)
    if (inLine(pts[i - 1], pts[i], pts[i + 1])) pts.splice(i, 1);
}

/** Two points are on the same axis when they differ by less than this. */
const SEGMENT_EPSILON = 0.5;

/** A run that carries no terminal has nothing bounding it; this stands in for
    the infinity a clamp cannot use without turning a delta into `NaN`. */
const SLIDE_UNBOUNDED = 1e4;

/** Far enough in that a slid terminal still reads as meeting the side rather
    than the corner where two of them meet. */
const SEAT_INSET = 4;

/** One maximal straight stretch of a route: the span of `pts` it covers, and
    which way it runs. */
export interface StraightRun {
  /** Index of its first point in `pts`. */
  from: number;
  /** Index of its last point — never `from`, and more than one apart where the
      route holds points that sit on the same straight line. */
  to: number;
  vertical: boolean;
}

/**
 * The maximal straight stretches of a route, in order.
 *
 * A "run" is what the reader sees: one straight line, however many points the
 * polyline spends on it. Routes do carry redundant ones — `applyNodeOffsets`
 * splices an elbow that can land in line with the segment beside it, and the
 * committed examples hold eleven such junctions — and treating each pair of
 * points as its own run would both misnumber what an author is looking at and
 * let a slide move half a line, leaving the other half slanted. Collapsing the
 * points instead would change every affected SVG for a drawing that is pixel for
 * pixel the same, so the geometry is left alone and the *reading* of it is what
 * merges.
 *
 * A zero-length segment joins whichever stretch it falls in rather than ending
 * one: it has no direction to disagree about.
 */
export function straightRuns(pts: Point[]): StraightRun[] {
  const axisOf = (a: Point, b: Point): "vertical" | "horizontal" | null => {
    const vertical = Math.abs(a.x - b.x) < SEGMENT_EPSILON;
    const horizontal = Math.abs(a.y - b.y) < SEGMENT_EPSILON;
    if (vertical === horizontal) return null; // degenerate, or a slant
    return vertical ? "vertical" : "horizontal";
  };
  const runs: StraightRun[] = [];
  let from = 0;
  while (from + 1 < pts.length) {
    let to = from + 1;
    let axis = axisOf(pts[from], pts[to]);
    while (to + 1 < pts.length) {
      const next = axisOf(pts[to], pts[to + 1]);
      if (next && axis && next !== axis) break;
      axis ??= next;
      to++;
    }
    runs.push({ from, to, vertical: axis === "vertical" });
    from = to;
  }
  return runs;
}

/**
 * How far `run` may slide along its normal, as a delta range.
 *
 * A run in the middle of a route is free: both of its ends are corners, and the
 * perpendicular runs on either side simply change length. A run carrying a
 * *terminal* is bounded by the element side that terminal sits on — its normal
 * points along that side, so sliding it slides the seat, and past the corner the
 * flow would come off the element it connects.
 *
 * Exported for `compile()`, which hands the bounds to an editor so a drag can
 * promise only what the drawing will actually show.
 */
export function segmentSlideRange(
  pts: Point[],
  run: StraightRun,
  leaves: SceneNode[],
): { min: number; max: number } {
  let min = -SLIDE_UNBOUNDED;
  let max = SLIDE_UNBOUNDED;
  for (const [point, terminal] of [
    [pts[run.from], run.from === 0],
    [pts[run.to], run.to === pts.length - 1],
  ] as [Point, boolean][]) {
    if (!terminal) continue;
    const node = leaves.find((leaf) => pointOn(point, leaf));
    if (!node) continue;
    const lo = (run.vertical ? node.x : node.y) + SEAT_INSET;
    const hi = (run.vertical ? node.x + node.width : node.y + node.height) - SEAT_INSET;
    const at = run.vertical ? point.x : point.y;
    min = Math.max(min, Math.min(lo, hi) - at);
    max = Math.min(max, Math.max(lo, hi) - at);
  }
  return { min, max: Math.max(min, max) };
}

/**
 * Slides the individual runs the author nudged (`{ segment-offset: 2, -18 }`)
 * and returns how many moved, which is what tells `shiftIntoCanvas` whether to
 * run.
 *
 * A run moves along its normal and nothing else: a vertical run left or right, a
 * horizontal one up or down. That is the one direction that needs no repair —
 * the perpendicular runs meeting it at either end keep their own axis and only
 * change length — so the route comes out orthogonal by construction, with the
 * same number of turns it went in with. Nothing else about the flow moves.
 *
 * Runs after the last pass that routes, so no repair can re-route the delta
 * away, and before the final `anchorFlowLabels`, so a nudged run carries the
 * label that names it. Reads `model.flows` for ids and numbers only — no kind,
 * no view name (§16).
 */
function applySegmentOffsets(scene: Scene, model: Model): number {
  const wanted = new Map(
    model.flows
      .filter((flow) => flow.segmentOffsets?.length)
      .map((flow) => [flow.id, flow.segmentOffsets!]),
  );
  if (!wanted.size) return 0;
  // Leaves only: a terminal inside a container is seated on the element, never
  // on the box drawn around it.
  const leaves = scene.nodes.filter((node) => !node.container);
  const clamped: Span[] = [];
  const stale: Span[] = [];
  let moved = 0;
  for (const edge of scene.edges) {
    const entries = wanted.get(edge.id);
    if (!entries) continue;
    // Read once, before any slide: a slide that leaves a neighbouring run zero
    // length lets `straightRuns` absorb it into the run beside it, and every
    // number after that point would name a different run than the author saw.
    // Indices into `pts` stay valid either way — a slide moves points, it never
    // adds or drops one.
    const runs = straightRuns(edge.pts);
    for (const entry of entries) {
      const run = runs[entry.segment - 1];
      // A run the route does not have — the numbers are positional, and a route
      // that gained or lost a turn renumbers everything after it.
      if (!run) {
        stale.push(entry.span);
        continue;
      }
      const range = segmentSlideRange(edge.pts, run, leaves);
      const delta = Math.min(Math.max(entry.delta, range.min), range.max);
      if (Math.abs(delta - entry.delta) >= SEGMENT_EPSILON) clamped.push(entry.span);
      if (!delta) continue;
      // Every point of the run, not just its two ends: a straight line the route
      // spends three points on is still one line, and moving two of them would
      // leave the third behind on a slant — a tier-0 breach (§3).
      for (let index = run.from; index <= run.to; index++) {
        if (run.vertical) edge.pts[index].x += delta;
        else edge.pts[index].y += delta;
      }
      moved++;
    }
  }
  if (clamped.length || stale.length) scene.segmentHints = { clamped, stale };
  return moved;
}

/** Where the drawing's left edge is seated when it has drifted inward. */
const LEFT_MARGIN = 10;

/**
 * Seats the drawing against the left margin, in whichever direction it has
 * drifted.
 *
 * Two jobs, one translation. **Left of the canvas**: `fitCanvas` only ever grows
 * right and down, so geometry pushed past x=0 or y=0 is drawn outside the
 * viewBox and clipped (§18) — five corpus drawings sit at a negative `minX`
 * today. **Right of the margin**: nothing ever pulled a drawing *back*, so a
 * layout whose leftmost element ends up inset keeps the strip beside it for
 * ever. 109 of the 352 swept drawings carry one, `logical-helios-fr` at 647px of
 * it, and on `infrastructure-focus-communication` it is the band under the
 * `Gare` site that a reader sees as unfinished.
 *
 * A translation is the one move that cannot cost anything: every node, run and
 * label keeps its position relative to every other, so no defect on the ladder
 * can change — and the bands below are drawn from the canvas, so they follow the
 * new left edge and the legend lines up with the drawing.
 *
 * It is also the one move that leaves an author's `offset:` meaning exactly what
 * it meant. The deltas are applied before this (§17), and this shifts what they
 * produced along with everything else, so a dragged element lands the same
 * distance from its neighbours however far the drawing moves. Re-rendering the
 * same source therefore gives the same picture, which is what makes a written-back
 * offset safe to paste.
 *
 * Runs for every diagram, not only those carrying a hint: the inward drift is
 * the router's, not the author's.
 */
function shiftIntoCanvas(scene: Scene): void {
  const MARGIN = 4;
  let minX = Infinity;
  let minY = MARGIN;
  for (const node of scene.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
  }
  for (const edge of scene.edges) {
    for (const point of edge.pts) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
    }
    for (const label of edge.labels) {
      minX = Math.min(minX, label.x);
      minY = Math.min(minY, label.y);
    }
  }
  // Left of the canvas, or inset past the margin. The band between the two is
  // left alone, so the 234 drawings already seated at 4-10px never move.
  const shiftX =
    minX < MARGIN ? MARGIN - minX : minX > LEFT_MARGIN ? LEFT_MARGIN - minX : 0;
  const shiftY = minY < MARGIN ? MARGIN - minY : 0;
  if (!shiftX && !shiftY) return;
  for (const node of scene.nodes) {
    node.x += shiftX;
    node.y += shiftY;
  }
  for (const band of scene.pinnedBands ?? []) {
    band.top += shiftY;
    band.bottom += shiftY;
  }
  for (const edge of scene.edges) {
    for (const point of edge.pts) {
      point.x += shiftX;
      point.y += shiftY;
    }
    // The renderer can still undo a repair by restoring this, so it has to move
    // with the drawing — a snapshot left behind describes a canvas that no
    // longer exists.
    for (const point of edge.repairedFrom ?? []) {
      point.x += shiftX;
      point.y += shiftY;
    }
    for (const label of edge.labels) {
      label.x += shiftX;
      label.y += shiftY;
    }
  }
  scene.width += shiftX;
  scene.height += shiftY;
}

/**
 * Overlaps an author's `offset:` or `label-offset:` created, plus the two ways a
 * `segment-offset:` can fail to land. The hints themselves are never negotiated
 * (§17), so this reports rather than repairs — the drawing ships as asked and
 * the author is told what the ask cost.
 *
 * Only boxes an offset actually moved are tested, against everything else: an
 * overlap between two elements neither of which was nudged is the layout's
 * business, not this warning's.
 */
/**
 * W0572 for a container a `size:` grew onto something.
 *
 * Its own family is not something: a container is drawn around its children and
 * inside its parent, so only a node on neither side of it counts — which is a
 * sibling, a cousin, or anything else the drawing puts beside it. The hint still
 * ships as written (§17); this only says so out loud.
 */
function sizeOverlaps(
  scene: Scene,
  model: Model,
  overlap: (a: Box, b: Box) => boolean,
): Diagnostic[] {
  const sized = new Map<string, Span>();
  const family = new Map<string, Set<string>>();
  const walk = (elements: Element[], ancestors: string[]): void => {
    for (const element of elements) {
      if (element.size) sized.set(element.id, element.size.span);
      family.set(element.id, new Set([...ancestors, ...subtreeIds(element)]));
      walk(element.children, [...ancestors, element.id]);
    }
  };
  walk(model.elements, []);
  if (!sized.size) return [];

  const diagnostics: Diagnostic[] = [];
  for (const node of scene.nodes) {
    const span = sized.get(node.id);
    if (!span) continue;
    const kin = family.get(node.id)!;
    const struck = scene.nodes.find((other) => !kin.has(other.id) && overlap(node, other));
    if (!struck) continue;
    diagnostics.push({
      code: "W0572",
      severity: "warning",
      message: `\`size\` on \`${node.id}\` overlaps \`${struck.id}\``,
      span,
      help: "the resize is applied as written — make it smaller, or give the drawing room with `order:`",
    });
  }
  return diagnostics;
}

export function offsetDiagnostics(scene: Scene, model: Model): Diagnostic[] {
  const hints: Diagnostic[] = [];
  for (const span of scene.segmentHints?.stale ?? [])
    hints.push({
      code: "W0574",
      severity: "warning",
      message: "`segment-offset` names a run this flow's route does not have",
      span,
      help: "runs are counted from 1 along the route, and renumber when it gains or loses a turn — re-drag the run in the playground, or drop the hint",
    });
  for (const span of scene.segmentHints?.clamped ?? [])
    hints.push({
      code: "W0573",
      severity: "warning",
      message: "`segment-offset` was limited to keep the flow on the element it attaches to",
      span,
      help: "the run carries a terminal, so it can only slide as far as the side that terminal sits on — pin the side with `ID.side`, or move the element instead",
    });
  for (const span of scene.clampedSizes ?? [])
    hints.push({
      code: "W0575",
      severity: "warning",
      message: "`size` was limited to keep this container around its own children",
      span,
      help: "a container is drawn around what it holds, which is not negotiable — resize or move the children first if the box has to be smaller",
    });
  // A descendant carried by its container's offset is answerable to *that*
  // offset: the container is what the author moved, so an overlap its children
  // cause is reported against the container's span, not passed over for having
  // no `offset:` of its own.
  const spans = new Map<string, Span>();
  const walk = (elements: Element[], inherited?: Span): void => {
    for (const element of elements) {
      const span = element.offset?.span ?? inherited;
      if (span) spans.set(element.id, span);
      walk(element.children, span);
    }
  };
  walk(model.elements);
  for (const flow of model.flows) if (flow.labelOffset) spans.set(flow.id, flow.labelOffset.span);

  const overlap = (a: Box, b: Box): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  hints.push(...sizeOverlaps(scene, model, overlap));
  if (!spans.size) return hints;

  const leaves = scene.nodes.filter((node) => !node.container);
  const labels = scene.edges.flatMap((edge) => edge.labels);
  const diagnostics: Diagnostic[] = [...hints];
  const reported = new Set<Span>();
  for (const id of scene.clampedOffsets ?? []) {
    const span = spans.get(id);
    if (!span || reported.has(span)) continue;
    reported.add(span);
    diagnostics.push({
      code: "W0573",
      severity: "warning",
      message: `\`offset\` on \`${id}\` was limited to keep it inside its container`,
      span,
      help: "an element is drawn inside the thing that contains it — move the container instead, or use a smaller offset",
    });
    spans.delete(id);
  }
  const report = (id: string, what: string) => {
    const span = spans.get(id);
    // One warning per `offset:`, not one per element it carried into something.
    if (!span || reported.has(span)) return;
    reported.add(span);
    diagnostics.push({
      code: "W0572",
      severity: "warning",
      message: `\`offset\` on \`${id}\` overlaps ${what}`,
      span,
      help: "the offset is applied as written — reduce it, or move the element with `order:` instead",
    });
    spans.delete(id);
  };
  for (const node of leaves) {
    if (!spans.has(node.id)) continue;
    const struckNode = leaves.find((other) => other.id !== node.id && overlap(node, other));
    if (struckNode) report(node.id, `\`${struckNode.id}\``);
    else if (labels.some((label) => overlap(node, label))) report(node.id, "a flow label");
  }
  for (const label of labels) {
    if (!spans.has(label.flowId)) continue;
    if (leaves.some((node) => overlap(label, node))) report(label.flowId, "an element");
    else if (labels.some((other) => other !== label && overlap(label, other)))
      report(label.flowId, "another flow label");
  }
  return diagnostics;
}

/**
 * Take-and-put-back for a whole `Scene`, for a pass that tries something and may
 * not keep it.
 *
 * Whole objects, not the handful of fields a caller means to touch: a trial that
 * runs the repair, the re-anchor or either compaction pass sets route flags
 * (`detour`, `pinned`, `hubSided`, `repairedFrom`) and scene metadata
 * (`repairTier`, `clampedOffsets`) a partial rollback would leave behind. Residue
 * does not merely dirty the scene — the candidate sweep reads it, so a trial that
 * was thrown away ends up picking the layout (`medium` came out 26px wider for
 * exactly that).
 */
function sceneSnapshots(scene: Scene) {
  const clone = <T extends object>(item: T): T => ({ ...item });
  const capture = () => ({
    nodes: scene.nodes.map(clone),
    edges: scene.edges.map((edge) => ({
      ...edge,
      pts: edge.pts.map(clone),
      labels: edge.labels.map(clone),
    })),
    pinnedBands: scene.pinnedBands?.map(clone),
    clampedOffsets: scene.clampedOffsets && new Set(scene.clampedOffsets),
    repairTier: scene.repairTier,
    width: scene.width,
    height: scene.height,
  });
  /** Puts `item` back to `snapshot`, keys the trial added included. */
  const revert = <T extends object>(item: T, snapshot: T) => {
    for (const key of Object.keys(item))
      if (!(key in snapshot)) delete (item as Record<string, unknown>)[key];
    Object.assign(item, snapshot);
  };
  const restore = (snapshot: ReturnType<typeof capture>) => {
    for (const [index, node] of scene.nodes.entries()) revert(node, snapshot.nodes[index]);
    for (const [index, edge] of scene.edges.entries()) {
      const was = snapshot.edges[index];
      revert(edge, was);
      edge.pts = was.pts.map(clone);
      edge.labels = was.labels.map(clone);
    }
    scene.pinnedBands = snapshot.pinnedBands?.map(clone);
    scene.clampedOffsets = snapshot.clampedOffsets && new Set(snapshot.clampedOffsets);
    scene.repairTier = snapshot.repairTier;
    scene.width = snapshot.width;
    scene.height = snapshot.height;
  };
  return { capture, restore };
}

/** Breathing room kept between a subtree this pass moves and whatever bounds it. */
const RECLAIM_GAP = 12;
/** Don't churn a drawing's routes to claw back less than this. */
const MIN_RECLAIM = 24;
/**
 * And don't *keep* the result for less than this, whatever the share works out
 * at. Below it the reclaim stops paying for itself: `colors-custom` bought 97px
 * and a new `sideHug`, `flow-labels-long` 96px and 26px of extra height. Both
 * are stage-5 costs this pass cannot see from where it runs — it measures before
 * labels take their final seats — so the floor stands in for the look it cannot
 * take.
 */
const MIN_RECLAIM_KEPT = 24;
/**
 * And don't *keep* the result for less than this share of the width.
 *
 * Stage 5 re-settles labels and refits the canvas after every geometry pass, so
 * what this pass measures is not the final number — a slide worth 30px here came
 * out 26px *wider* on `medium` once its labels found their final seats. The pass
 * exists for the pathological shape, an element in a trailing band holding a
 * column of its own, where the gain is a tenth of the drawing and survives
 * anything stage 5 does to it. A few percent is noise this cannot see the end of.
 */
const RECLAIM_SHARE = 0.05;
/**
 * The worst tier a reclaim may add a defect at — nothing at this tier or better
 * is purchasable. Tiers 0-2 are the invariants and the defects that make a flow
 * hard to follow; 3 and 4 are the ones that make it untidy.
 */
const RECLAIM_UNBUYABLE_TIER = 2;
/**
 * And how much of the width a reclaim has to win before it may add a defect at
 * the two bottom tiers at all. Twice the plain acceptance bar: an ordinary
 * reclaim stays free, and only one worth a tenth of the drawing may spend.
 */
const RECLAIM_TRADE_SHARE = 0.1;
/**
 * And a floor in pixels alongside the share, because a share alone misprices a
 * small drawing: `placement/sides` wins a larger *fraction* (12.6%) than
 * `infrastructure-large-slide` (10.6%) while reclaiming 77px less, and on a
 * drawing with six flows one extra weave is far more of the picture than it is
 * among twenty. A defect has to buy real page, not just a good ratio.
 */
const RECLAIM_TRADE_MIN = 200;
/**
 * And how much of the drawing's height a lift may move a box through.
 *
 * A lift is meant to step a box off rows it was not using — 21px, on the drawing
 * this pass was written for. Past a point it stops being that and becomes a
 * restack: `theme-light` had its one box moved 118px down a 169px drawing, which
 * turns a wide strip into a block. That is a disposition choice (§2.1), made once
 * for the whole drawing against the aspect target, not something a space-reclaim
 * pass gets to make on the side.
 */
const RECLAIM_LIFT_SHARE = 0.15;

/** A top-level subtree's extent, title overflow included — what this pass moves as one. */
interface Reach {
  x: number;
  y: number;
  right: number;
  bottom: number;
}

/**
 * Stage 4c½: pulls a trailing element back into the empty column beside its
 * neighbour, and lifts the one box standing in its way when that box is the only
 * thing holding it out there.
 *
 * elk draws in layers, so an element in a partition band past every other one
 * takes a column of its own however little of that column its own rows use.
 * `infrastructure-large-fr` is the shape: both egress externals sit in the band
 * after `Site de secours` (`EGRESS_PARTITION`), and the flows feeding them cross
 * 1038px and 1426px of drawing to reach a column whose only occupant is a site
 * 180px tall standing in 504px of height. A reader would seat them beside it.
 *
 * `compactHorizontal` cannot do this: a column is dead to that pass only when it
 * is dead at *every* row, and the site's rows are alive. This one asks the
 * narrower question — dead at the rows *this subtree* occupies — which is what
 * makes the two complementary rather than redundant.
 *
 * Two moves, in this order, and only ever between top-level subtrees:
 *
 * - **Slide.** A subtree moves left until it is `RECLAIM_GAP` from the nearest
 *   subtree sharing a row with it. One that shares no row cannot stop it, which
 *   is the whole point.
 * - **Lift.** Where exactly one subtree caps the slide of whatever is setting the
 *   drawing's width, and there is room to move it clear of those rows, it moves —
 *   the smaller of up and down, and only into space nothing else holds.
 *
 * Nothing is taken on trust. The moves go on through `applyNodeOffsets`, the same
 * path an author's `offset:` takes, so terminals are carried and elbows squared by
 * code that already does it; the result is then kept only if the drawing got
 * narrower *and* the ladder did not regress (§5). Anything else rolls back to the
 * geometry that came in, to the byte — which is what keeps every drawing this
 * cannot help byte-identical.
 *
 * Runs before `compactHorizontal`, not after: this pass re-routes, and the column
 * pass is the one that has to see final geometry. That also means the canvas is
 * re-measured there, so this pass never touches `scene.width`.
 */
function reclaimTrailingColumns(scene: Scene, model: Model): void {
  const tops = model.elements.filter((element) => !element.parent);
  // Two subtrees can only ever be side by side; a column with a hole in it needs
  // a third to be standing in it.
  if (tops.length < 3) return;

  const nodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  // `titleBoxesOf` walks the container nodes in scene order, so the two zip.
  const titleIndex = new Map(
    scene.nodes.filter((node) => node.container).map((node, index) => [node.id, index]),
  );
  const titles = titleBoxesOf(scene, model);

  const spanOf = (ids: string[]): Reach | null => {
    let span: Reach | null = null;
    const fold = (box: Box) => {
      const right = box.x + box.width;
      const bottom = box.y + box.height;
      span = span
        ? {
            x: Math.min(span.x, box.x),
            y: Math.min(span.y, box.y),
            right: Math.max(span.right, right),
            bottom: Math.max(span.bottom, bottom),
          }
        : { x: box.x, y: box.y, right, bottom };
    };
    for (const id of ids) {
      const node = nodeById.get(id);
      if (!node) continue;
      fold(node);
      // A container title overflows its box to the right, and a slide blind to it
      // would seat the next subtree over the top of the title.
      const index = titleIndex.get(id);
      if (index !== undefined && titles[index]) fold(titles[index]);
    }
    return span;
  };

  const idsOf = new Map(tops.map((element) => [element.id, subtreeIds(element)]));
  const spans = new Map<string, Reach>();
  for (const element of tops) {
    const span = spanOf(idsOf.get(element.id)!);
    if (span) spans.set(element.id, span);
  }
  if (spans.size < 3) return;

  const sharesRows = (a: Reach, b: Reach) =>
    a.y < b.bottom + RECLAIM_GAP && b.y < a.bottom + RECLAIM_GAP;

  /** How far `id` can move left, and the one subtree that stops it going further. */
  const slideRoom = (id: string): { dx: number; blocker: string | null } => {
    const box = spans.get(id)!;
    let limit = RECLAIM_GAP;
    let blocker: string | null = null;
    for (const [otherId, other] of spans) {
      if (otherId === id || !sharesRows(box, other)) continue;
      // Level with it or already past it: that is a swap, not a slide, and a swap
      // is not this pass's business.
      if (other.right > box.x) return { dx: 0, blocker: otherId };
      if (other.right + RECLAIM_GAP > limit) {
        limit = other.right + RECLAIM_GAP;
        blocker = otherId;
      }
    }
    return { dx: Math.min(0, limit - box.x), blocker };
  };

  const moves = new Map<string, { dx: number; dy: number }>();
  const shift = (id: string, dx: number, dy: number) => {
    const span = spans.get(id)!;
    span.x += dx;
    span.right += dx;
    span.y += dy;
    span.bottom += dy;
    const had = moves.get(id) ?? { dx: 0, dy: 0 };
    moves.set(id, { dx: had.dx + dx, dy: had.dy + dy });
  };

  // Rightmost first: a subtree cannot open room for one standing further right.
  const order = [...spans.keys()].sort((a, b) => spans.get(b)!.right - spans.get(a)!.right);
  const slideAll = () => {
    for (const id of order) {
      const { dx } = slideRoom(id);
      if (dx <= -MIN_RECLAIM) shift(id, dx, 0);
    }
  };
  const widest = () => order.reduce((a, b) => (spans.get(b)!.right > spans.get(a)!.right ? b : a));

  const widthBefore = spans.get(widest())!.right;
  slideAll();

  // One lift, to part the subtree still setting the width from the one thing in
  // its way. Only one pair is ever tried: more than that is a packer, and a
  // packer rearranges boxes the reader is using to find their way.
  const stuck = widest();
  const { blocker } = slideRoom(stuck);
  if (blocker) {
    const box = spans.get(stuck)!;
    const wall = spans.get(blocker)!;
    // The pair is left out of the check: both are about to move, and the slide
    // that follows is what puts them in the same column — on rows the lift has
    // just made disjoint.
    const clear = (moved: Reach) =>
      [...spans].every(
        ([id, other]) =>
          id === blocker ||
          id === stuck ||
          !sharesRows(moved, other) ||
          moved.right + RECLAIM_GAP <= other.x ||
          other.right + RECLAIM_GAP <= moved.x,
      );
    // The wall moves, never the subtree that is stuck. Letting the stuck one move
    // instead is the smaller delta and looks like the better deal, but it drags a
    // flow's target off the row its label was seated on: measured, it put a
    // `labelOffLine` on all six `application-small` dispositions for width none
    // of them needed. The subtree that is *not* carrying the long flow is the one
    // with room to give.
    const options = [box.y - RECLAIM_GAP - wall.bottom, box.bottom + RECLAIM_GAP - wall.y].sort(
      (a, b) => Math.abs(a) - Math.abs(b),
    );
    for (const dy of options) {
      if (!dy) continue;
      if (Math.abs(dy) > scene.height * RECLAIM_LIFT_SHARE) continue;
      const moved = { ...wall, y: wall.y + dy, bottom: wall.bottom + dy };
      if (moved.y < RECLAIM_GAP || !clear(moved)) continue;
      shift(blocker, 0, dy);
      slideAll();
      break;
    }
  }

  if (!moves.size || spans.get(widest())!.right > widthBefore - MIN_RECLAIM) return;

  const everyEdge = new Set(scene.edges.map((edge) => edge.id));
  const profileOf = (candidate: Scene) =>
    inspect(candidate, titleBoxesOf(candidate, model)).local(everyEdge, new Map());
  const { capture, restore } = sceneSnapshots(scene);
  const undo = capture();

  // What the drawing costs if this pass does nothing — measured through the
  // column pass, because that is what sets `scene.width`, and a slide can just as
  // easily block a cut it was already getting as open a new one. Comparing the
  // raw spans instead priced two different drawings against each other and fired
  // on `medium`, which came out 26px wider.
  const compact = () => compactHorizontal(scene, titleBoxesOf(scene, model));
  compact();
  const stayWidth = scene.width;
  const stayHeight = scene.height;
  const stayProfile = profileOf(scene);
  restore(undo);

  const offsetOf = new Map<string, OffsetSpec>();
  for (const [rootId, delta] of moves) {
    offsetOf.set(rootId, delta);
    // Descendants carry no delta of their own: `applyNodeOffsets` inherits the
    // root's through the parent chain, which is also what holds each child inside
    // the container it belongs to.
    for (const id of idsOf.get(rootId)!)
      if (id !== rootId) offsetOf.set(id, { dx: 0, dy: 0, parent: model.index.get(id)?.parent?.id });
  }
  const carried = applyNodeOffsets(scene, offsetOf);
  // That pass pins the corridor a lifted box crossed, because an author who drags
  // something across a gap meant to leave the gap there. A lift is not a
  // preference — it is this pass taking a box off rows it was not using, and the
  // height it vacates is exactly what `compactVertical` below is for.
  scene.pinnedBands = undo.pinnedBands?.map((band) => ({ ...band }));
  const settled = titleBoxesOf(scene, model);
  // A subtree that moved this far leaves terminals on a side that no longer faces
  // its counterpart, and routes drawn for the seat it used to have.
  reaimAfterOffsets(scene, settled, carried);
  if (carried.size) optimiseRoutes(scene, settled, false, carried);
  // A subtree that slid into a column now sits alongside routes that were not
  // running past anything before. `tidyEdges` owns that defect mid-pipeline and
  // is long past; run its side-hug pass again over the settled geometry.
  clearSideHugs(scene, settled);
  // Labels name runs that just moved, and a band the slide emptied is dead height
  // the vertical pass already ran past. Both are measured below, so both are put
  // right first — judging the move on stale labels judges the wrong drawing.
  anchorFlowLabels(scene, settled, false);
  compactVertical(scene);

  compact();

  // Stricter than `noLadderRegression`, and deliberately: that rule prices a
  // whole re-layout, where two candidates share no defect addresses and only tier
  // totals can be compared. This is one layout with a few boxes moved, so the
  // addresses survive the move and every defect *kind* can be held to account.
  // A slide is opportunistic — worth taking only when it is free.
  // Stricter than `noLadderRegression`, and deliberately: that rule prices a
  // whole re-layout, where two candidates share no defect addresses and only tier
  // totals can be compared. This is one layout with a few boxes moved, so the
  // addresses survive the move and every defect *kind* can be held to account.
  //
  // Two bands, because "free or nothing" turned out too strict to be right.
  // Anything at tier 2 or better is unbuyable — those are the defects that make a
  // drawing wrong rather than untidy. A defect at the bottom two tiers is
  // purchasable, but only by a *large* win: on `infrastructure-large-slide` a
  // single tier-3 `attachAway` was refusing 217px, a tenth of the drawing, and
  // the whole point of this pass is the page. `RECLAIM_TRADE_SHARE` is set well
  // above the plain acceptance bar so an ordinary reclaim still has to be free —
  // only a reclaim worth a tenth of the width may spend anything at all.
  const was = tallyProfile(stayProfile);
  let grewAbove = false;
  let grewBelow = false;
  for (const [key, entry] of tallyProfile(profileOf(scene))) {
    if (entry.count <= (was.get(key)?.count ?? 0)) continue;
    if (entry.tier <= RECLAIM_UNBUYABLE_TIER) grewAbove = true;
    else grewBelow = true;
  }
  const saved = stayWidth - scene.width;
  const bought = saved >= stayWidth * RECLAIM_TRADE_SHARE && saved >= RECLAIM_TRADE_MIN;
  const held = !grewAbove && (!grewBelow || bought);
  const bar = Math.max(MIN_RECLAIM_KEPT, stayWidth * RECLAIM_SHARE);
  // Narrower, and not one pixel taller. Width alone is the wrong objective — the
  // freed column has to go somewhere, and on `theme-dark` a third of the width
  // came back as half again the height. Trading the axes is what the disposition
  // choice is for (§2.1); this pass only reclaims what nothing was using, so a
  // reclaim that costs height was not reclaiming empty space at all.
  const won = scene.width <= stayWidth - bar && scene.height <= stayHeight;
  if (held && won) return;
  // Not worth it: back to the geometry that came in, and the column pass at the
  // call site compacts it exactly as it would have without this pass.
  restore(undo);
}

/**
 * Room an arrowhead needs behind it, so a flow arriving from outside a container
 * is not drawn with its head flush against the frame. The head is ~7px long and
 * elk's container padding is 9, which left 2px — on `infrastructure-large-wide`
 * the WAF's inbound arrow all but sat on the DMZ border.
 */
const BORDER_AIR = 3;
/** Total room an arrowhead wants between the frame it crosses and the box it
    points at: the ~7px head, plus enough that the two read apart. */
const ARROW_ROOM = 12;
/** And the clearance a frame must keep from a run lying outside it — just past
    the 3px at which a run and a border read as one line (sweep `sideHug`). */
const RUN_CLEAR = 4;

/**
 * How far a container's border may travel on `side` before it meets a route.
 *
 * A run lying just outside a border is why the frame cannot simply take the
 * space: move the border onto it and the two draw as one line (`sideHug`), move
 * it past and a route that was outside the container is suddenly cutting through
 * it (`throughContainer`). Only runs parallel to the border matter — a
 * perpendicular one crosses it either way.
 */
function runRoom(scene: Scene, box: Box, side: "left" | "right" | "bottom"): number {
  const horizontal = side !== "bottom";
  const acrossLo = horizontal ? box.y : box.x;
  const acrossHi = horizontal ? box.y + box.height : box.x + box.width;
  let free = Number.POSITIVE_INFINITY;
  for (const edge of scene.edges)
    for (let i = 0; i + 1 < edge.pts.length; i++) {
      const a = edge.pts[i];
      const b = edge.pts[i + 1];
      const vertical = Math.abs(a.x - b.x) < 0.5;
      if (vertical === Math.abs(a.y - b.y) < 0.5) continue;
      if (vertical !== horizontal) continue;
      const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      if (hi <= acrossLo || lo >= acrossHi) continue;
      const at = vertical ? a.x : a.y;
      const gap =
        side === "left"
          ? box.x - at
          : side === "right"
            ? at - (box.x + box.width)
            : at - (box.y + box.height);
      if (gap >= 0) free = Math.min(free, gap - RUN_CLEAR);
    }
  return free;
}

/**
 * Stage 4e: pushes a container's borders outward a few pixels, into space
 * nothing is using.
 *
 * The complaint this answers is an arrowhead drawn hard against a container
 * frame: a flow crossing into a zone has only the container's padding between
 * the border and the box it points at, and the head fills almost all of it.
 *
 * The obvious lever is elk's own `elk.padding`, and it is the wrong one. Padding
 * moves every child, which re-routes the whole drawing for a cosmetic gain:
 * measured at one extra pixel it put `sideHug` through its ceiling (22 → 32) and
 * regressed 63 drawings. Moving the *border* instead leaves every node and every
 * route exactly where the router put them — the frame is the only thing that
 * moves, and the gap it opens is the gap the arrowhead was missing.
 *
 * Runs dead last, after `compactHorizontal` and before `fitCanvas`, for that
 * reason: nothing downstream measures geometry, so a widened frame cannot feed
 * back into a routing decision. `fitCanvas` still sees it, so a container grown
 * at the edge of the drawing takes the canvas with it.
 *
 * Each side is grown independently and only into proven free space: never past
 * the inner edge of the container that holds it, never into another box, and
 * never onto a route that is not already crossing that border. A side with
 * nothing to spare simply stays where it is.
 */
export function airOutContainers(scene: Scene): void {
  const containers = scene.nodes.filter((node) => node.container);
  if (!containers.length) return;

  const holds = (outer: SceneNode, inner: SceneNode) =>
    outer !== inner &&
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1;

  /** The smallest container holding `node`, or null for a top-level one. */
  const parentOf = (node: SceneNode): SceneNode | null => {
    let best: SceneNode | null = null;
    for (const box of containers)
      if (holds(box, node) && (!best || box.width * box.height < best.width * best.height))
        best = box;
    return best;
  };

  // Snapshotted before anything moves: every clamp is measured against the
  // geometry the router produced, not against a frame an earlier iteration has
  // already pushed out.
  const was = new Map(scene.nodes.map((node) => [node.id, { ...node }]));
  const grown = new Map(containers.map((box) => [box.id, { ...box }]));

  for (const box of containers) {
    const parent = parentOf(box);
    const self = was.get(box.id)!;
    // Anything that is neither inside this container nor the container itself
    // bounds how far its frame may travel.
    const foreign = scene.nodes.filter(
      (node) => node !== box && !holds(box, node) && !holds(node, box),
    );

    const room = (side: "left" | "right" | "bottom"): number => {
      const horizontal = side !== "bottom";
      let free = BORDER_AIR;
      free = Math.min(free, runRoom(scene, self, side));
      if (parent) {
        const edge = was.get(parent.id)!;
        const limit =
          side === "left"
            ? self.x - edge.x
            : side === "right"
              ? edge.x + edge.width - (self.x + self.width)
              : edge.y + edge.height - (self.y + self.height);
        free = Math.min(free, Math.max(0, limit - 1));
      }
      for (const other of foreign) {
        const o = was.get(other.id)!;
        // Only a box the frame would actually run into: one that overlaps this
        // container on the other axis and sits on the side being grown.
        if (horizontal) {
          if (o.y + o.height <= self.y || o.y >= self.y + self.height) continue;
          const gap =
            side === "left" ? self.x - (o.x + o.width) : o.x - (self.x + self.width);
          if (gap >= 0) free = Math.min(free, gap / 2);
        } else {
          if (o.x + o.width <= self.x || o.x >= self.x + self.width) continue;
          const gap = o.y - (self.y + self.height);
          if (gap >= 0) free = Math.min(free, gap / 2);
        }
      }
      return Math.max(0, Math.floor(free));
    };

    // Only a border an arrowhead is actually cramped against. Growing every
    // frame by whatever it could take moves borders nothing asked to move, and
    // each one is a chance to land on a route: measured, it put
    // `throughContainer` through its ceiling (67 → 83). A container whose
    // arrivals all have room is left exactly as the router drew it.
    const wanted = (side: "left" | "right" | "bottom"): number => {
      let short = 0;
      for (const edge of scene.edges) {
        if (edge.pts.length < 2) continue;
        for (const terminal of [edge.pts[0], edge.pts[edge.pts.length - 1]]) {
          const seat = scene.nodes.find(
            (node) => !node.container && pointOn(terminal, was.get(node.id)!),
          );
          if (!seat || !holds(box, seat)) continue;
          const s = was.get(seat.id)!;
          // The arrow has to be crossing *this* border to be cramped by it: the
          // terminal sits on the facing side of its box, and the route reaches
          // back out past the frame.
          const outside = edge.pts.some((point) =>
            side === "left"
              ? point.x < self.x
              : side === "right"
                ? point.x > self.x + self.width
                : point.y > self.y + self.height,
          );
          if (!outside) continue;
          const gap =
            side === "left"
              ? s.x - self.x
              : side === "right"
                ? self.x + self.width - (s.x + s.width)
                : self.y + self.height - (s.y + s.height);
          const onFace =
            side === "bottom"
              ? Math.abs(terminal.y - (s.y + s.height)) < 1
              : Math.abs(terminal.x - (side === "left" ? s.x : s.x + s.width)) < 1;
          if (onFace && gap >= 0) short = Math.max(short, ARROW_ROOM - gap);
        }
      }
      return short;
    };

    const left = Math.min(room("left"), wanted("left"));
    const right = Math.min(room("right"), wanted("right"));
    const bottom = Math.min(room("bottom"), wanted("bottom"));
    if (left <= 0 && right <= 0 && bottom <= 0) continue;
    const out = grown.get(box.id)!;
    out.x = self.x - Math.max(0, left);
    out.width = self.width + Math.max(0, left) + Math.max(0, right);
    out.height = self.height + Math.max(0, bottom);
  }

  for (const box of containers) {
    const out = grown.get(box.id)!;
    box.x = out.x;
    box.width = out.width;
    box.height = out.height;
  }
}

function runGeometryPasses(
  scene: Scene,
  model: Model,
  options: { numbered: boolean; sideways: boolean; laneOf?: Map<string, number> },
): void {
  const { numbered, sideways } = options;
  if (options.laneOf) snapLanes(scene, options.laneOf, sideways ? "y" : "x");
  // Issue #26 applies to every disposition. A DOWN layout wraps its backward
  // flows around the sides rather than the top, so it is routed through the
  // same pass with the scene mirrored across the diagonal.
  const titleBoxes = titleBoxesOf(scene, model);
  if (sideways) transpose(scene, titleBoxes);
  rerouteDetours(scene, model, numbered, titleBoxes);
  if (sideways) transpose(scene, titleBoxes);

  // `rerouteDetours` shifts the whole scene when a top-channel lane sits above
  // y=0, so boxes measured before it are stale by that amount. Handing those to
  // `tidyEdges` makes its re-side pass accept runs that strike titles where they
  // now are — on logical-fr/slide, §4c sent F19's L through a band it could not
  // see. Re-derive before any pass that reads them.
  const routedTitles = titleBoxesOf(scene, model);
  // Straighten routing noise and separate flows sharing a node side, for every
  // edge — elk's as much as the rerouted ones.
  tidyEdges(scene, routedTitles);
  // Every pass above moves routes without moving the labels that name them. Put
  // each label back on its own flow before anything measures where labels are —
  // `compact` below is the first thing that does.
  //
  // Without the author's `label-offset:`, deliberately: everything below this
  // line routes on where labels are, and a label nudged by hand must move the
  // label and nothing else. The offsets go on at the final anchor instead.
  anchorFlowLabels(scene, routedTitles, false);
  // Reclaim the bands elk sized for routes that no longer run there — every
  // disposition, since elk leaves spare corridors whether or not the reroute
  // above moved anything.
  compactVertical(scene);

  // The repair is tried and then audited, not refused outright: a route change
  // can cost a *different* flow's label its seat, so any flow whose label was on
  // its run before and is not after is put back. That keeps the ladder's rule (a
  // Tier 1 loss is bought only by a Tier 0 gain) without refusing every move that
  // merely *might* cost a label. Deep copy — `optimiseRoutes` squares every edge
  // in place, so a shallow snapshot is not a snapshot.
  const routesBefore = new Map(
    scene.edges.map((edge) => [edge.id, edge.pts.map((point) => ({ ...point }))]),
  );
  // Re-derived, not reused: the boxes above predate `compactVertical`, which
  // moves every container's y. Reusing them made a later pass dodge bands where
  // they used to be and strike them where they now are — 17 drawings reported
  // `titleStruck` before this was fixed.
  const settledTitles = titleBoxesOf(scene, model);
  // After compaction, not before: `compact` shrinks the gaps a route is judged
  // on, so validating above it judges geometry that compaction then narrows into
  // near-parallel runs and micro-jogs. Last pass that re-routes — only the spread
  // below still moves geometry, along a side its terminal sits on.
  optimiseRoutes(scene, settledTitles);
  // The ladder trades a lower-tier win for a tier-4 `tight` when every seat it
  // can reach sits within `MIN_ATTACH_GAP` of a sibling — honest, but it leaves
  // the side crowded. The same spread that ran inside `tidyEdges` runs here
  // again, after the pass that re-crowds.
  spreadAttachments(scene);
  recordRepairs(scene, routesBefore);

  // `compactVertical` shrank the gaps this pass judges, so a run that cleared its
  // sides before compaction can hug one after. Placed *after* the repair
  // recording so the hug fix is not swept into the renderer's batch audit and
  // reverted as collateral — on application-large-fr/wide, F19's fix at y=445 was
  // batch-reverted to y=451 over another edge's label harm. Here it is in both
  // audit states, so the comparison is unaffected and the fix permanent.
  clearSideHugs(scene, settledTitles);
  // A terminal still seated on the face opposite its counterpart. The port pass
  // above answers most of these by re-laying the graph out, but exempts anything
  // `route-detour` flagged — and that flag outlives the channel it was set for.
  // One flow at a time, on settled geometry, so it cannot disturb a route it does
  // not touch (which is exactly what re-laying out for one flow did).
  reseatAwayTerminals(scene, settledTitles);
  // A run descending the inside of the frame it is on its way out of. Not a
  // `sideHug` — it is legally clear of the border — but it reads as one, and the
  // page margin outside is empty. Free moves only; see the pass.
  clearLeavingRuns(scene, settledTitles);
  // Still without the author's offsets: this scene is a layout *candidate*, and
  // `applyAuthorPositioning` puts the hints on the one that wins.
  anchorFlowLabels(scene, settledTitles, false);
  // Crossings between two flows on the same leaf side, further out than the §4b
  // fan can see. Here for the same reason as `clearSideHugs`: outside the
  // renderer's batch audit, so an unrelated optimiser trade cannot revert the
  // swap. Only swaps that remove a crossing without shuffling it elsewhere.
  swapCrossingSiblingSeats(scene);
  // The columns elk sized for a label narrower than the gap it reserved, or for
  // a container reaching past the layer beside it. Dead last among the geometry
  // passes, unlike its vertical twin: every pass above re-routes, and a column
  // squeezed before them is judged on geometry they then replace — put here it
  // narrows what the drawing actually ends up with, and nothing re-routes into
  // the gap it closed (`logical-archi` paid for the earlier seat with two
  // coincident runs).
  //
  // Reading direction only. Under `DOWN` the layers run down the page, so x is
  // the cross axis: squeezing it pulls siblings together rather than shortening
  // anything, and the sweep measured that as crossings on six drawings.
  // The column an element in a trailing partition band takes for itself, when
  // nothing else uses the rows beside it. Before the column pass, which has to
  // measure the geometry this one leaves behind.
  if (!sideways) reclaimTrailingColumns(scene, model);
  if (!sideways) compactHorizontal(scene, titleBoxesOf(scene, model));
  // A few pixels of frame, so an arrowhead arriving from outside is not drawn
  // against the border. After every routing pass on purpose — it moves borders,
  // never routes, and nothing below re-measures.
  airOutContainers(scene);
  // The one anchor that runs with nothing left to route. Every earlier one is
  // read by a pass below it, so the seat preferences that are purely about how a
  // label *looks* — clearing a container outline above all — have to wait until
  // here, where moving a label cannot move anything else.
  anchorFlowLabels(scene, titleBoxesOf(scene, model), false, true);
  // Last, because every pass above moves routes and labels after the reroute's
  // own resize.
  fitCanvas(scene);
}

/**
 * Which top-level elements share a lane, keyed by element id. Registry-driven
 * and computed before any `Scene` exists, exactly as `partitions` is: a lane is
 * an opt-in `laneKinds` entry (§9) whose instances are leaves and are not
 * transitively linked by a flow. Chained siblings are excluded because a chain
 * must occupy successive layers by construction, so seating it in one lane would
 * fight the flows rather than tidy them.
 */
function laneAssignment(model: Model, view: View): Map<string, number> {
  const laneOf = new Map<string, number>();
  const laneKinds = new Set(view.laneKinds ?? []);
  // `compact` is an explicit request to spend whitespace on density. Seating a
  // lane spends it the other way, so the two do not both get their way: compact
  // wins, and a compact drawing renders exactly as it did before lanes existed.
  if (!laneKinds.size || model.style.compact) return laneOf;

  const rootOf = new Map<string, string>();
  const walk = (element: Element, root: string) => {
    rootOf.set(element.id, root);
    for (const child of element.children ?? []) walk(child, root);
  };
  for (const element of model.elements) walk(element, element.id);

  const adjacency = new Map<string, Set<string>>();
  for (const flow of model.flows) {
    const from = rootOf.get(flow.from);
    const to = rootOf.get(flow.to);
    if (!from || !to || from === to) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  }
  const reaches = (from: string, to: string) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      for (const next of adjacency.get(queue.pop()!) ?? []) {
        if (next === to) return true;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };

  const byKind = new Map<string, Element[]>();
  for (const element of model.elements) {
    if (!laneKinds.has(element.kind)) continue;
    if ((element.children ?? []).length) continue;
    if (!byKind.has(element.kind)) byKind.set(element.kind, []);
    byKind.get(element.kind)!.push(element);
  }
  // An author pin is an explicit instruction about where an edge meets a box.
  // Seating the box in a lane would move that meeting point, so the pin wins and
  // the lane goes untaken — the same precedence §17 gives every opt-in hint.
  const pinned = new Set<string>();
  for (const flow of model.flows) {
    if (!flow.fromSide && !flow.toSide) continue;
    // Both ends: a pin fixes where the run leaves *and* meets, so moving either
    // box bends a route the author placed deliberately.
    pinned.add(rootOf.get(flow.from) ?? flow.from);
    pinned.add(rootOf.get(flow.to) ?? flow.to);
  }

  let laneId = 0;
  for (const members of byKind.values()) {
    if (members.length < 2) continue;
    if (members.some((member) => pinned.has(member.id))) continue;
    // `order:` on a top-level element is a partition band along the reading
    // axis — the very axis a snap moves along, so seating the lane would
    // override the sequence the author asked for. Same precedence as a pin.
    if (members.some((member) => member.order)) continue;
    if (members.some((a) => members.some((b) => a !== b && reaches(a.id, b.id)))) continue;
    laneId++;
    for (const member of members) laneOf.set(member.id, laneId);
  }
  return laneOf;
}

/** Aspect ratio each framed disposition is fitted to. */
const ASPECT_TARGETS: Record<string, number | undefined> = {
  slide: 16 / 9,
  page: 0.71,
};

/**
 * One elk layout, retried once without the derived hub ports (`hubFlowSides`)
 * if elk refuses them. Port constraints reach an elk path that throws on some
 * hierarchical models — the scanline hitbox failure `constrainPorts` documents —
 * and a hub side is a preference about where producers attach, never a reason to
 * fail a drawing. The options that actually produced the result come back with
 * it, so every later pass rebuilds the same graph rather than the one that was
 * asked for.
 */
async function withHubPortFallback(
  elk: { layout: (graph: ElkNode) => Promise<unknown> },
  makeGraph: (direction: "RIGHT" | "DOWN", options?: GraphOptions) => ElkNode,
  direction: "RIGHT" | "DOWN",
  options?: GraphOptions,
): Promise<{ result: LaidOutNode; options?: GraphOptions }> {
  const run = async (spec?: GraphOptions) =>
    (await elk.layout(makeGraph(direction, spec))) as LaidOutNode;
  // Loosen post-compaction first — locking its constraints, then skipping it —
  // and drop the ports only if neither lays out: a slightly roomier drawing that
  // attaches where a queue reads beats a tighter one that does not.
  const rungs: GraphOptions[] =
    options?.hubPorts === false
      ? []
      : [
          { ...options, postCompaction: "EDGE_LENGTH_CONSTRAINT_LOCKING" },
          { ...options, postCompaction: "NONE" },
          { ...options, hubPorts: false },
        ];
  try {
    return { result: await run(options), options };
  } catch (error) {
    for (const [index, rung] of rungs.entries()) {
      try {
        return { result: await run(rung), options: rung };
      } catch (rungError) {
        if (index === rungs.length - 1) throw rungError;
      }
    }
    throw error;
  }
}

/**
 * Before any geometry pass runs: which terminals were *decided* rather than
 * guessed. `pinned` is the author's own `ID.side`; `hubSided` is the queue cap
 * `hubFlowSides` chose. The passes read them the same way when they consider
 * re-siding a terminal and differently when they count defects — see
 * `SceneEdge.hubSided`.
 *
 * `hubPorts` is whether the layout being described actually carried those ports.
 * When `withHubPortFallback` climbed down from them, elk picked those sides
 * unaided: marking them would fix an arbitrary side and stop `optimiseRoutes`
 * from repairing what the fallback already cost.
 */
function markDeclaredTerminals(
  edges: SceneEdge[],
  model: Model,
  view: View,
  hubPorts: boolean,
): void {
  // A role counts as a pin, not as a derived side: it is written in the same
  // slot as `ID.side`, and it names the cap at the *other* end of the flow
  // (`CAPTURE.producer -> EVENTS` fixes the EVENTS end). The spec promises the
  // wrap it implies — a consumer is seated past the queue and its arrow runs
  // back into the right cap — and the §4c re-aim was trading that away, landing
  // both roles on one cap whenever producer and consumer shared a container.
  // Only when elk was actually handed the hub ports: after the fallback the cap
  // is elk's own guess, and freezing a guess is worse than leaving it free.
  const rolePin = (role: AttachRole | undefined) => hubPorts && !!role;
  const pinnedFlows = new Map(
    model.flows
      .filter(
        (flow) =>
          flow.fromSide ||
          flow.toSide ||
          rolePin(flow.fromRole?.value) ||
          rolePin(flow.toRole?.value),
      )
      .map(
        (flow) =>
          [
            flow.id,
            {
              start: !!flow.fromSide || rolePin(flow.toRole?.value),
              end: !!flow.toSide || rolePin(flow.fromRole?.value),
            },
          ] as const,
      ),
  );
  const hubSides = hubPorts ? hubFlowSides(model, view) : new Map<string, DerivedSides>();
  for (const edge of edges) {
    const pinned = pinnedFlows.get(edge.id);
    if (pinned) edge.pinned = { ...pinned };
    const hub = hubSides.get(edge.id);
    if (hub) edge.hubSided = { start: !!hub.from, end: !!hub.to };
  }
}

/**
 * Lays out `model`, then applies the author's three positioning deltas —
 * `offset:`, `label-offset:` and `segment-offset:` — to the layout that won.
 *
 * **The deltas go on after `chooseLayout`, never inside it.** A drawing with
 * hints must be the hint-free drawing *plus the hints*, and nothing else: an
 * author who nudges one box is asking for that box to move, not for the diagram
 * to be re-derived around it. Inside `chooseLayout` a hint is not a hint, it is
 * an input — the candidate sweep, `denserLayout` and the port pass all measure
 * readability on the scene the passes produced and pick a winner by it, so a
 * nudged element is judged as if the router had put it there. Measured on
 * `application-large-fr`: a single `offset: 0, -30` on `PAY_ORCH` moved all 28
 * other elements and re-routed 20 flows that never touched it.
 *
 * So the candidate scenes are built hint-free, down to `anchorFlowLabels`
 * running with `applyOffsets: false`, and the winner alone is nudged. A hint
 * says where something sits, never which layout wins (§17).
 *
 * `ID.side` and `order:` stay inside the layout, where they belong: those are
 * requests *of* the router — an elk port and a partition band — not deltas
 * applied to what it drew.
 */
export async function layout(model: Model, view: View): Promise<Scene> {
  const scene = await chooseLayout(model, view);
  applyAuthorPositioning(scene, model);
  // The last pass that moves anything, and after the hints: a translation cannot
  // change what any pass above decided, and seating the drawing at the margin
  // only means anything once everything that moves it has moved it. `fitCanvas`
  // then measures the canvas around where things ended up.
  shiftIntoCanvas(scene);
  fitCanvas(scene);
  return scene;
}

/**
 * Puts the author's deltas on a settled scene, and re-runs only what they
 * invalidate.
 *
 * Order matters and is the same as the pipeline's: nodes move first and carry
 * their terminals (`applyNodeOffsets` squares the elbow itself, so no route
 * repair is needed or wanted — a repair here would undo the very churn this
 * function exists to prevent), then the one re-aim a moved node genuinely needs,
 * then the runs, then the labels ride what moved. `shiftIntoCanvas` answers
 * anything pushed past the top or left, which `fitCanvas` cannot — it only ever
 * grows right and down (§18).
 *
 * Every pass here is idempotent on a settled scene, and the whole function is a
 * no-op without a hint, which is what keeps a hint-free drawing byte-identical.
 */
/** Length of a polyline, in pixels. */
const pathLength = (pts: Point[]): number =>
  pts.reduce(
    (total, point, index) =>
      index === 0
        ? 0
        : total + Math.abs(point.x - pts[index - 1].x) + Math.abs(point.y - pts[index - 1].y),
    0,
  );

/**
 * Puts back any route the repair bought at the price of a long way round.
 *
 * The ladder judges *defects* — crossings, struck titles, runs hugging a border
 * — and is deliberately blind to how far a route travels, because inside the
 * pipeline everything it is choosing between was drawn by the router in the
 * first place. After an offset that stops being true: what the repair is handed
 * is the squared route `applyNodeOffsets` produced, which is already a
 * reasonable answer, and a candidate that clears a tier by climbing over the
 * whole drawing and coming back is not an improvement anybody would recognise.
 * On `architecture-applicative-l1`, nudging a queue 80px down sent the flow into
 * it up above the title band and back — 515px of route become 794.
 *
 * So a repair that makes a route half as long again is refused and `before` is
 * restored. The snapshot is taken here rather than read off `repairedFrom`:
 * that field is written by `recordRepairs` for the pipeline's own repair pass,
 * and this stage runs after it.
 */
export function refuseScenicRepairs(scene: Scene, before: Map<string, Point[]>): void {
  // ponytail: one ratio, measured rather than derived. If it starts refusing
  // repairs that are visibly right, the answer is a length term in the ladder
  // itself, not a second constant here.
  const TOLERATED_DETOUR = 1.5;
  for (const edge of scene.edges) {
    const original = before.get(edge.id);
    if (!original) continue;
    if (pathLength(edge.pts) > pathLength(original) * TOLERATED_DETOUR) edge.pts = original;
  }
}

function applyAuthorPositioning(scene: Scene, model: Model): void {
  // Sizes first: `applyNodeOffsets` holds each child inside its parent, so the
  // room a parent has to give must already be the room the drawing will show.
  const resized = applyContainerSizes(scene, model);
  const offsets = offsetAssignment(model);
  if (offsets.size || resized.size) {
    // The flows whose terminal a hint carried — a box that moved, or a border
    // that grew out from under one. Everything repaired below is scoped to them:
    // an author who nudges or resizes one box is asking for that box and its own
    // flows to follow, never for the rest of the drawing to be re-routed (§17).
    const carried = new Set([...resized, ...applyNodeOffsets(scene, offsets)]);
    // The renderer may undo a route repair by restoring `repairedFrom`, and for
    // a flow this stage just moved that snapshot is of geometry that no longer
    // exists — it was taken before the delta, against the node's old seat, so
    // restoring it strands the flow in mid-air beside an element that has moved
    // on. Dropping it leaves the renderer with nothing stale to fall back to;
    // the repair below records a fresh one where it moves anything.
    for (const edge of scene.edges) if (carried.has(edge.id)) edge.repairedFrom = undefined;
    const titles = titleBoxesOf(scene, model);
    // A drag can move an element past its counterpart, which leaves the flow
    // attached to a side that no longer faces it — the wrap §4c straightens.
    reaimAfterOffsets(scene, titles, carried);
    // And a carried flow otherwise keeps the route the router drew for the seat
    // the element used to have: on `infrastructure-siet-pcc`, nudging the idp
    // down 120px left its own inbound flow lying on another flow for 138px and
    // running through a third element. The route repair is the pass that owns
    // that, so it is run — over the carried flows alone, and after
    // `recordRepairs`, so the renderer's batch audit cannot revert a fix it did
    // not measure the need for.
    //
    // A flow whose runs the author placed by hand is left out: its shape is a
    // hint, not a defect, and `applySegmentOffsets` below would be arguing with
    // the repair over it.
    const handPlaced = new Set(
      model.flows.filter((flow) => flow.segmentOffsets?.length).map((flow) => flow.id),
    );
    const repairable = new Set([...carried].filter((id) => !handPlaced.has(id)));
    if (repairable.size) {
      const before = new Map(
        scene.edges
          .filter((edge) => repairable.has(edge.id))
          .map((edge) => [edge.id, edge.pts.map((point) => ({ ...point }))]),
      );
      optimiseRoutes(scene, titles, false, repairable);
      refuseScenicRepairs(scene, before);
      // The repair works to the ladder, which trades defects against each other;
      // two runs lying on top of one another reads as a single line and is worth
      // removing on its own terms, so the de-coincidence post-pass runs after it
      // the same way it does inside `tidyEdges`.
      decoincideAfterOffsets(scene, titles, repairable);
    }
  }
  const nudgedRuns = applySegmentOffsets(scene, model);
  // Same again for a run the author slid: the snapshot is of the route before
  // the slide, and undoing to it would quietly drop the hint.
  if (nudgedRuns)
    for (const edge of scene.edges)
      if (model.flows.find((flow) => flow.id === edge.id)?.segmentOffsets?.length)
        edge.repairedFrom = undefined;
  const nudgedLabels = scene.edges.some((edge) => edge.labels.some((label) => label.offset));
  if (!offsets.size && !resized.size && !nudgedRuns && !nudgedLabels) return;
  // With the author's offsets this time: every anchor before this one ran
  // without them, so this is where a nudged label lands and where a label whose
  // flow moved catches up with it.
  anchorFlowLabels(scene, titleBoxesOf(scene, model));
  fitCanvas(scene);
}

async function chooseLayout(model: Model, view: View): Promise<Scene> {
  const elk = await getElk();
  const businessObjectName = new Map(model.businessObjects.map((bo) => [bo.id, bo.name]));
  const numbered = model.style.flowText === "numbered";
  const compact = model.style.compact;
  const {
    edge: edgeFontSize,
    node: nodeFontSize,
    cont: containerFontSize,
    scale: fontScale,
  } = fontSizes(model.style.font.size);

  const disposition = model.style.disposition;
  const aspectTarget = ASPECT_TARGETS[disposition];

  const ingressExternalElements = view.partitionByOrder
    ? computeIngressExternalElements(model)
    : new Set<string>();

  const graphContext: GraphContext = {
    model,
    view,
    ingressExternal: ingressExternalElements,
    slotOf: readingSlots(model, view, ingressExternalElements),
    compact,
    numbered,
    fonts: {
      edge: edgeFontSize,
      node: nodeFontSize,
      cont: containerFontSize,
      scale: fontScale,
    },
    businessObjectName,
  };
  const makeGraph = (direction: "RIGHT" | "DOWN", options?: GraphOptions): ElkNode =>
    buildElkGraph(graphContext, direction, options);

  const kindOf = new Map(indexElementsById(model.elements));

  const sceneFromResult = (
    result: LaidOutNode,
    layoutMs: number,
    // What the result was *laid out* with, so the scene records hub caps only
    // when elk was actually given them (`withHubPortFallback`).
    laidOutWith?: GraphOptions,
    lanes = true,
  ): Scene => {
    const origins: Record<string, { x: number; y: number }> = {
      root: { x: 0, y: 0 },
    };
    const walkedNodes = walkElkNodes(result, 0, 0, kindOf);
    const nodes = walkedNodes.map((walked) => walked.node);
    for (const walked of walkedNodes) origins[walked.id] = { x: walked.x, y: walked.y };

    const edges = collectSceneEdges(result, origins, numbered, edgeFontSize);
    // Flip back what `elkEnds` handed elk reversed: the author drew both a
    // producer's and a consumer's flow *at* the queue, and that is what the
    // arrowhead has to show. Geometry is untouched — only the direction it is
    // traversed in.
    const reversed = new Set(model.flows.filter(laidOutReversed).map((flow) => flow.id));
    for (const edge of edges) if (reversed.has(edge.id)) edge.pts.reverse();
    markDeclaredTerminals(edges, model, view, laidOutWith?.hubPorts !== false);
    stampLabelOffsets(edges, model);

    const scene: Scene = {
      width: Math.ceil(result.width),
      height: Math.ceil(result.height),
      nodes,
      edges,
      layoutMs,
    };
    runGeometryPasses(scene, model, {
      numbered,
      sideways: disposition === "page" || disposition === "tall",
      laneOf: lanes ? laneOf : undefined,
    });
    return scene;
  };

  const laneOf = laneAssignment(model, view);
  const startTime = Date.now();
  const layoutGraph = (direction: "RIGHT" | "DOWN", options?: GraphOptions) =>
    withHubPortFallback(elk, makeGraph, direction, options);
  let result: LaidOutNode;
  let winnerDirection: "RIGHT" | "DOWN";
  let winnerOptions: GraphOptions | undefined;
  if (aspectTarget) {
    const graphSpecs: {
      direction: "RIGHT" | "DOWN";
      options?: GraphOptions;
    }[] =
      disposition === "slide"
        ? [
            { direction: "RIGHT" },
            { direction: "RIGHT", options: { tight: true } },
            { direction: "RIGHT", options: { tight: true, minLayers: true } },
          ]
        : [{ direction: "DOWN" }];
    const laidOutSpecs = await Promise.all(
      graphSpecs.map((spec) => layoutGraph(spec.direction, spec.options)),
    );
    const candidates = laidOutSpecs.map((laidOut) => laidOut.result);
    const preferWide = disposition === "slide";
    const orientedLayouts = candidates
      .map((layoutResult, index) => ({ layoutResult, index }))
      .filter(({ layoutResult }) =>
        preferWide
          ? layoutResult.width >= layoutResult.height
          : layoutResult.height >= layoutResult.width,
      );
    const viableLayouts = orientedLayouts.length
      ? orientedLayouts
      : candidates.map((layoutResult, index) => ({ layoutResult, index }));
    const frameSize =
      disposition === "slide" ? { width: 1280, height: 720 } : { width: 700, height: 1000 };
    const fitScore = (layoutResult: { width: number; height: number }) =>
      -Math.min(frameSize.width / layoutResult.width, frameSize.height / layoutResult.height);
    const winner = viableLayouts.reduce((candidateA, candidateB) =>
      fitScore(candidateA.layoutResult) <= fitScore(candidateB.layoutResult)
        ? candidateA
        : candidateB,
    );
    result = winner.layoutResult;
    winnerDirection = graphSpecs[winner.index].direction;
    // What the spec laid out with, not what it asked for: hub ports elk refused
    // were retried without them.
    winnerOptions = laidOutSpecs[winner.index].options;
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
    winnerDirection = disposition === "tall" ? "DOWN" : "RIGHT";
    ({ result, options: winnerOptions } = await layoutGraph(winnerDirection));
  }
  const layoutMs = Date.now() - startTime;
  let base = sceneFromResult(result, layoutMs, winnerOptions);
  /** What a whole-layout choice is judged on: the ladder plus the gate's blind spots. */
  const layoutProfile = (candidate: Scene): Profile => {
    const everyEdge = new Set(candidate.edges.map((edge) => edge.id));
    const profile = inspect(candidate, titleBoxesOf(candidate, model)).local(everyEdge, new Map());
    for (const [key, tier] of selectionExtras(candidate, model)) profile.set(key, tier);
    return profile;
  };
  if (!aspectTarget && nodeCoverage(base) < DENSE_ENOUGH) {
    const denser = await denserLayout(base, {
      layout: (spec) => elk.layout(makeGraph(winnerDirection, spec)) as Promise<unknown>,
      // Its specs carry the hub ports (none of them sets `hubPorts: false`), and
      // a candidate elk refuses is dropped rather than retried without them.
      toScene: (laidOut) => sceneFromResult(laidOut, Date.now() - startTime),
      profile: layoutProfile,
    });
    if (denser) {
      base = denser.scene;
      winnerOptions = denser.options;
    }
  }
  const baseProfile = layoutProfile(base);
  // The playground bundles this module for the browser, where `process` does
  // not exist; reach it through `globalThis` so the switch is simply absent
  // there instead of a ReferenceError. CLI-only debug aid — see CONTRIBUTING.md.
  const skipPortPass = !!(globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.CAIRN_NO_PORT_PASS;
  if (skipPortPass) return base;
  // `route-detour` only claims the wrap-arounds wasteful enough to deserve a
  // channel, leaving the merely-bad wrapped. Re-run the winning config with
  // those flows pinned to ports facing their counterpart, judged by the house
  // ladder rather than the metric being fixed: a relayout that clears wrong-side
  // departures but strikes a title or merges a run is refused. Opportunistic —
  // port constraints hit an elk scanline bug on some models, so a crash here
  // just keeps what has been accepted so far.
  //
  // Two things this loop does that a single round cannot.
  //
  // It **re-enters**: constraining one pair's ports moves every layer around it,
  // and the layout that comes back can wrap a flow that was straight before. The
  // next round measures that layout and repairs it in turn.
  //
  // And every round is judged against **the layout elk drew unaided**, never
  // against the round before it, because that is the promise the pass makes —
  // and because chaining the verdicts refuses a strictly better candidate: the
  // second round here removed two wrap-arounds and sixteen net crossings, and
  // was rejected for gaining eight of them. Candidates that beat the base are
  // collected, and the one that pays at the best tier wins; ties go to the
  // candidate carrying fewer over-long routes, the defect the verdict is blind
  // to, and then to the earlier round so the choice stays deterministic.
  let current = base;
  let best: RelayoutRound<Scene> | null = null;
  for (let round = 0; round < PORT_PASS_ROUNDS; round++) {
    const flagged = attachAwayOf(current, model);
    if (!flagged.size) break;
    let candidate: Scene;
    try {
      const constrained = makeGraph(winnerDirection, winnerOptions);
      constrainPorts(constrained, current, flagged, model);
      const reresult = (await elk.layout(constrained)) as unknown as LaidOutNode;
      candidate = sceneFromResult(reresult, Date.now() - startTime, winnerOptions);
    } catch {
      break;
    }
    const tier = relayoutVerdict(baseProfile, layoutProfile(candidate));
    if (tier < 0) break;
    const scored = { scene: candidate, tier, detours: longDetourCount(candidate, model) };
    if (beatsRelayout(scored, best)) best = scored;
    current = candidate;
  }
  return best?.scene ?? base;
}
