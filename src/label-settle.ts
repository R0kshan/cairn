/**
 * Where every flow label finally sits. `label-anchor` picks a seat from the
 * route alone; this pass is the one that sees the *other* labels, the boxes and
 * the title bands, and walks a label outwards until it stops colliding.
 *
 * Its own module because two stages run it. `svg-render` settles the drawing it
 * is about to paint, and `scene-layout` settles a throwaway copy of each
 * candidate layout so the ladder judges labels where they will actually land:
 * profiled before settling, a candidate's straddles read 11 across the corpus
 * where the finished drawings have 20 (§3a).
 *
 * Not idempotent — `settleLabelPositions` re-applies the author's `above`/
 * `below` offset each time it runs — so a caller that settles to measure must
 * settle a copy, never the scene it keeps.
 */

import type { Model, Flow } from "./models/ast.ts";
import type { Scene, SceneEdge, SceneLabel } from "./scene-layout.ts";
import {
  type Box,
  type TitleBox,
  boundsOf,
  boxesOverlap,
  boxGapSq,
  boxToPolylineSq,
} from "./geometry.ts";
import { titleBoxesOf } from "./route-detour.ts";

/**
 * How far a label may sit from its own flow. Squared, like everything else here.
 * 20px matches the sweep's `labelAdrift` gate: past it the label is further from
 * its flow than `MIN_ATTACH_GAP` puts the neighbouring one, so there is nothing
 * left to tell the reader which run it annotates.
 */
export const ADRIFT_SQ = 20 * 20;
/** Within this a label reads as sitting on its run whatever else is nearby. */
const ATTACHED_SQ = 6 * 6;

/** A seat the settler may try, as the label's top-left corner. */
interface Seat {
  x: number;
  y: number;
}

/** The two judgements and the two seat ladders every escape round consults. */
interface Settler {
  collides: (label: SceneLabel) => boolean;
  attributableHere: (label: SceneLabel) => boolean;
  ownRunMidpoints: (label: SceneLabel) => Seat[];
  alongOwnRun: (label: SceneLabel) => Seat[];
}

/**
 * Round 0: stay on the line. Every seat here is *on* the run — midpoints and
 * slides along it — so §4d survives the escape. Only a label with nowhere to go
 * along its own flow reaches the perpendicular rounds.
 *
 * Two sweeps over the same seats: the first also wants attribution, the second
 * takes any overlap-free seat, pierced or not. Overlapping is unreadable,
 * off-the-line breaks §4d, pierced is a ratchet — so a pierced seat *on* the run
 * beats a clean one beside it.
 */
function settleOnOwnRun(s: Settler, label: SceneLabel): boolean {
  const onLineSeats = [...s.ownRunMidpoints(label), ...s.alongOwnRun(label)];
  for (const wantAttributable of [true, false])
    for (const seat of onLineSeats) {
      label.x = seat.x;
      label.y = seat.y;
      if (s.collides(label)) continue;
      if (wantAttributable && !s.attributableHere(label)) continue;
      return true;
    }
  return false;
}

/**
 * The perpendicular ladder, walked only once every on-line slide has failed.
 *
 * The attributable round slides further than the relaxed one: along its own run
 * a label keeps `own` at 0 whatever the distance, so a long slide is how a label
 * wider than the gap between two crossing runs dodges the piercing one without
 * leaving its flow. The relaxed round keeps the short ladder — unguarded long
 * throws land in a stranger's corridor.
 */
function settleOffOwnRun(s: Settler, label: SceneLabel, here: Seat): boolean {
  for (const attributable of [true, false]) {
    const origins = attributable ? [here, ...s.ownRunMidpoints(label)] : [here];
    const slides = attributable ? [0, -24, 24, -48, 48, -72, 72, -96, 96] : [0, -24, 24, -48, 48];
    for (const origin of origins)
      for (const dx of slides)
        for (const step of [0, 8, 14, 20, 28, 36, 44, 56, 70, 86])
          for (const dir of step === 0 ? [1] : [-1, 1]) {
            label.y = origin.y + dir * step;
            label.x = origin.x + dx;
            if (s.collides(label)) continue;
            if (attributable && !s.attributableHere(label)) continue;
            return true;
          }
  }
  return false;
}

/**
 * Move one label out of trouble, or leave it exactly where it was.
 *
 * A label is moved for either reason. Overlap alone was the old trigger, and it
 * misses the whole `labelPierced` population: a label centred on its own run
 * overlaps nothing at all while another flow is drawn through the middle of its
 * text.
 *
 * Two rounds. The first refuses any escape that detaches the label from its flow
 * or parks it nearer another, walking it to a different run of its own flow
 * instead; the second drops that condition. Not a preference: an overlapping
 * label is unreadable, an ambiguous one merely misleading, so zero overlaps
 * outranks attribution. Attribution is a ratchet exactly because it has to yield
 * here.
 */
function settleOneLabel(s: Settler, label: SceneLabel): void {
  // An author put this label here by hand (`{ label-offset: … }`). Settling it
  // would negotiate a hint §17 says is not negotiable, and the overlap it may
  // have created is reported as W0572 instead of silently moved away from.
  if (label.offset) return;
  if (!s.collides(label) && s.attributableHere(label)) return;
  const origin: Seat = { x: label.x, y: label.y };
  if (settleOnOwnRun(s, label)) return;
  if (settleOffOwnRun(s, label, origin)) return;
  label.x = origin.x;
  label.y = origin.y;
}

/** The label model: where every label sits, and the pass that settles them. */
export interface LabelSettler {
  labels: SceneLabel[];
  titleBands: TitleBox[];
  countLabelOverlaps: () => number;
  offOwnRun: (label: SceneLabel) => number;
  stolen: (label: SceneLabel, own: number) => boolean;
  pierced: (label: SceneLabel) => boolean;
  settleLabelPositions: () => void;
}

export function createLabelSettler(deps: { scene: Scene; model: Model }): LabelSettler {
  const { scene, model } = deps;
  const style = model.style;
  const flowById = new Map<string, Flow>(model.flows.map((flow) => [flow.id, flow]));

  const nodeBoxes: Box[] = scene.nodes
    .filter((node) => !node.container)
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
  const labels: SceneLabel[] = scene.edges.flatMap((edge) => edge.labels);

  const countLabelOverlaps = (): number => {
    let count = 0;
    for (let index = 0; index < labels.length; index++) {
      for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex++)
        if (boxesOverlap(labels[index], labels[otherIndex])) count++;
      for (const node of nodeBoxes) if (boxesOverlap(labels[index], node)) count++;
    }
    return count;
  };

  const ownRun = new Map<SceneLabel, SceneEdge>();
  for (const edge of scene.edges) for (const label of edge.labels) ownRun.set(label, edge);
  /**
   * Bounds are derived from `edge.pts`, which `auditRouteRepairs` swaps between
   * settling passes. Rebuilt on each settle so the cheap prefilter in `stolen`
   * and `pierced` never disagrees with the polyline test it guards — a stale
   * box rejects routes that now pierce, and the audit then compares the two
   * candidate drawings on partly stale data.
   */
  let routes: { edge: SceneEdge; bounds: Box }[] = [];
  const refreshRoutes = () => {
    routes = scene.edges
      .filter((edge) => edge.pts.length >= 2)
      .map((edge) => ({ edge, bounds: boundsOf(edge.pts) }));
  };
  refreshRoutes();

  const offOwnRun = (label: SceneLabel) => {
    const edge = ownRun.get(label);
    return edge && edge.pts.length >= 2 ? boxToPolylineSq(label, edge.pts) : 0;
  };
  /**
   * Is another flow's run closer to this label than its own? Then the reader
   * attributes it to the wrong flow.
   *
   * A label within `ATTACHED_SQ` of its own run is exempt — it is visibly on
   * that run, and a neighbour grazing 1px nearer is two flows running close
   * together, which `nearParallel` already counts.
   */
  const stolen = (label: SceneLabel, own: number) => {
    if (own <= ATTACHED_SQ) return false;
    const mine = ownRun.get(label);
    return routes.some(
      (route) =>
        route.edge !== mine &&
        boxGapSq(label, route.bounds) < own &&
        boxToPolylineSq(label, route.edge.pts) < own,
    );
  };

  /**
   * Is another flow's run drawn through the label box? Neither rule above sees
   * this: a label on its own run has `own` of 0, so it passes both while a second
   * flow crosses the words.
   *
   * Not measured at 0 — the halo keeps a line grazing the box edge legible.
   *
   * Deliberately wider than the gate; INVARIANTS §3 requires that stated next to
   * both. `labelPierced` + `labelStraddled` omit one case this counts: an on-line
   * label crossed transversally. This is a *preference* deciding whether to look
   * for a better seat, not a charge — narrowing it to the gate's union would stop
   * the settler looking, and the relaxed round below makes the strictness free.
   */
  const PIERCE_SQ = 1;
  const pierced = (label: SceneLabel) => {
    const mine = ownRun.get(label);
    return routes.some(
      (route) =>
        route.edge !== mine &&
        boxGapSq(label, route.bounds) <= PIERCE_SQ &&
        boxToPolylineSq(label, route.edge.pts) <= PIERCE_SQ,
    );
  };

  /**
   * Where the label would sit centred on each run of its own flow, in segment
   * order. A label crowded off its preferred run can usually sit elsewhere on
   * the same route — still clearly attached — which beats being flung into open
   * space to escape a collision.
   */
  const ownRunMidpoints = (label: SceneLabel) => {
    const edge = ownRun.get(label);
    const seats: { x: number; y: number }[] = [];
    if (!edge) return seats;
    const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const a = edge.pts[index];
      const b = edge.pts[index + 1];
      seats.push({
        x: (a.x + b.x) / 2 - label.width / 2,
        y: (a.y + b.y) / 2 - lead,
      });
    }
    return seats;
  };

  /**
   * Seats along the label's own run, both directions from where it sits. The
   * escape that keeps §4d: sliding *along* a run never leaves it, so a crowded
   * label can travel a long way and stay on its own line. The perpendicular
   * ladder below is what takes it off, and only once every slide has failed.
   */
  const alongOwnRun = (label: SceneLabel): { x: number; y: number }[] => {
    const edge = ownRun.get(label);
    if (!edge || edge.pts.length < 2) return [];
    const lead = label.textH > 0 ? label.textH / 2 : label.height / 2;
    const seats: { x: number; y: number }[] = [];
    for (let index = 0; index + 1 < edge.pts.length; index++) {
      const a = edge.pts[index];
      const b = edge.pts[index + 1];
      const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
      // Measured on the box, in the direction it slides: the centred seat's
      // leading edge, and how far that edge may travel each way with the whole
      // box still on this run. Vertically the seat is anchored on the text's
      // centre (`lead`) while the box is taller than the text, so the box sits
      // off-centre on the run — one budget for both ends would then overshoot
      // the far end by exactly the difference and leave that much unreachable
      // at the near end. The two ends are measured separately for that reason.
      const size = vertical ? label.height : label.width;
      const start = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const end = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      const seat = vertical ? (a.y + b.y) / 2 - lead : (a.x + b.x) / 2 - label.width / 2;
      const back = Math.max(0, seat - start);
      const ahead = Math.max(0, end - size - seat);
      if (back === 0 && ahead === 0) continue;
      for (const fraction of [0.25, 0.5, 0.75, 1])
        for (const room of [-back, ahead]) {
          const shift = room * fraction;
          seats.push(
            vertical
              ? { x: (a.x + b.x) / 2 - label.width / 2, y: seat + shift }
              : { x: seat + shift, y: (a.y + b.y) / 2 - lead },
          );
        }
    }
    return seats;
  };

  /** Container names, which carry no halo and so may not be sat on (§4e). */
  const titleBands = titleBoxesOf(scene, model);

  const settler: Settler = {
    /**
     * Somewhere this label may not sit at all.
     *
     * Container names sit with the node boxes, not the soft preferences the
     * escape ladder trades, because §4e is tier 0 while every one of those is
     * tier 1: a name drawn through is destroyed information, a label beside its
     * line is still readable. `label-anchor` ranks these the other way — that
     * predates the ladder, which now decides.
     *
     * Surfaced once `laneBeyond` started clearing runs (§4j): labels that never
     * needed to escape began escaping, and five `slide` drawings put one on a
     * container name on the way out.
     */
    collides: (label) =>
      labels.some((other) => other !== label && boxesOverlap(other, label)) ||
      nodeBoxes.some((node) => boxesOverlap(node, label)) ||
      titleBands.some((band) => boxesOverlap(band, label)),
    /** Can the reader tell, from this position alone, which flow is speaking? */
    attributableHere: (label) => {
      const own = offOwnRun(label);
      return own <= ADRIFT_SQ && !stolen(label, own) && !pierced(label);
    },
    ownRunMidpoints,
    alongOwnRun,
  };

  const settleLabelPositions = () => {
    refreshRoutes();
    for (const label of labels) {
      const requested = flowById.get(label.flowId)?.style?.label ?? style.flowLabel;
      if (requested === "above") label.y -= label.height / 2 + 5;
      else if (requested === "below") label.y += label.height / 2 + 5;
    }
    for (const label of labels) settleOneLabel(settler, label);
  };

  return {
    labels,
    titleBands,
    countLabelOverlaps,
    offOwnRun,
    stolen,
    pierced,
    settleLabelPositions,
  };
}
