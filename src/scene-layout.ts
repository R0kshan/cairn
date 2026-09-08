/**
 * Stage 4: turns the validated `Model` into an absolute-positioned `Scene`
 * (nodes, edges, labels, canvas size) via elkjs layered layout. Builds the ELK
 * graph from measured node sizes, runs several candidate layouts for balanced
 * dispositions (`slide`/`page`) and picks the best fit — optionally deferring to
 * the folded layout (`slide-fold.ts`). `LaidOutNode`/`LaidOutEdge` describe an
 * ELK result after layout (coordinates populated) and are shared with slide-fold.
 */

import type { Model, Element, AttachSide, AttachRole } from "./models/ast.ts";
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
import { compactVertical, fitCanvas } from "./compact.ts";
import {
  optimiseRoutes,
  clearSideHugs,
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
   * (`APP.right -> DB.left`). A pinned terminal is intent, not a metric win, so
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

/** What sizing a node needs beyond the element itself: the same values for every node in one layout. */
interface NodeSizing {
  compact: boolean;
  fonts: { cont: number; node: number };
  /** Kinds drawn with a corner glyph — see `View.glyphKinds`. */
  glyphKinds: ReadonlySet<string>;
}

/**
 * Converts an `Element` (and its children, recursively) into elk's input node
 * shape. `root` marks a top-level element, whose own `order:` is a partition
 * band rather than an index inside a layer — its children still carry theirs.
 */
function toElkNode(element: Element, sizing: NodeSizing, root = false): ElkNode {
  const { compact, fonts, glyphKinds } = sizing;
  const { cont: containerFontSize, node: nodeFontSize } = fonts;
  if (element.children.length) {
    const lineCount = (element.label ?? element.id).split("\n").length;
    return {
      id: element.id,
      layoutOptions: {
        "elk.padding": `[top=${(compact ? 11 : 13) + lineCount * 14},left=${compact ? 7 : 9},bottom=${compact ? 7 : 9},right=${compact ? 7 : 9}]`,
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
  return {
    id: element.id,
    ...(element.order && !root ? { layoutOptions: orderOption(element) } : {}),
    width: isActor
      ? Math.max(64, measure(element.label ?? element.id, nodeFontSize - 1.5).width + 8)
      : Math.max(compact ? 98 : 108, measured.width + (compact ? 10 : 12) + gutter),
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
      const portId = `${flow.id}${role === "src" ? "#out" : "#in"}`;
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
        if (role === "src") elkEdge.sources = [portId];
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
  labelWrap?: number;
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
const COMPACT_WRAP = 10;

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
function elkFlowEdge(flow: Model["flows"][number], ctx: GraphContext, labelWrap?: number) {
  const { compact, numbered, fonts, businessObjectName } = ctx;
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
  const wrap = labelWrap ?? (compact ? COMPACT_WRAP : undefined);
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
      ["out", flow.fromSide ?? sideRequest(hub?.from), flow.from],
      ["in", flow.toSide ?? sideRequest(hub?.to), flow.to],
    ] as const) {
      if (!declared) continue;
      const elkNode = elkById.get(nodeId);
      if (!elkNode) continue;
      // `#out` / `#in` name the *elk* ends, which a role may have swapped
      // (`elkEnds`), so a reversed flow's source port is its authored target's.
      const portId = `${flow.id}#${(role === "out") !== laidOutReversed(flow) ? "out" : "in"}`;
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
      if ((role === "out") !== laidOutReversed(flow)) elkEdge.sources = [portId];
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
      const elkNode = toElkNode(element, { compact, fonts, glyphKinds }, true);
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
    edges: model.flows.map((flow) => elkFlowEdge(flow, ctx, options?.labelWrap)),
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
  anchorFlowLabels(scene, routedTitles);
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
  anchorFlowLabels(scene, settledTitles);
  // Crossings between two flows on the same leaf side, further out than the §4b
  // fan can see. Here for the same reason as `clearSideHugs`: outside the
  // renderer's batch audit, so an unrelated optimiser trade cannot revert the
  // swap. Only swaps that remove a crossing without shuffling it elsewhere.
  swapCrossingSiblingSeats(scene);
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
  const pinnedFlows = new Map(
    model.flows
      .filter((flow) => flow.fromSide || flow.toSide)
      .map((flow) => [flow.id, { start: !!flow.fromSide, end: !!flow.toSide }] as const),
  );
  const hubSides = hubPorts ? hubFlowSides(model, view) : new Map<string, DerivedSides>();
  for (const edge of edges) {
    const pinned = pinnedFlows.get(edge.id);
    if (pinned) edge.pinned = { ...pinned };
    const hub = hubSides.get(edge.id);
    if (hub) edge.hubSided = { start: !!hub.from, end: !!hub.to };
  }
}

export async function layout(model: Model, view: View): Promise<Scene> {
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
            { direction: "RIGHT", options: { labelWrap: 16 } },
            { direction: "RIGHT", options: { labelWrap: 14, tight: true } },
            { direction: "RIGHT", options: { labelWrap: 14, tight: true, minLayers: true } },
          ]
        : [{ direction: "DOWN" }, { direction: "DOWN", options: { labelWrap: 16 } }];
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
