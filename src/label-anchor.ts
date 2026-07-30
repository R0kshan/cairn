/**
 * Stage 4d: puts every flow label back on the flow it names.
 *
 * elk positions an edge label against the route *elk* planned
 * (`elk.edgeLabels.placement: CENTER`). Three passes then move that route out
 * from under it — `route-detour` reroutes backward edges through other channels,
 * `edge-tidy` straightens runs and spreads attachment points, `compact` lifts
 * everything below a reclaimed band. Nothing moved the label. The box is left
 * over open space, and where flows run in a bundle it lands nearer a *different*
 * flow than its own: the reader is asked to guess which run the `(TCP/5432)`
 * belongs to, and has no way to tell.
 *
 * So the label is re-centred on a segment of its own route. Which segment
 * matters more than it looks — see `hostSegment`.
 *
 * Order matters twice over. This runs after `edge-tidy`, because a label
 * anchored to a run that then moves is no better off than before; and before
 * `compact`, because a label pins the horizontal band it sits in, and a band
 * pinned by a label that later moves elsewhere is exactly the dead height
 * `compact` exists to remove.
 *
 * Deterministic: the host is chosen by integer-ordered comparisons with the
 * segment index as the final tie-break, never by floating-point luck, and the
 * new position is a midpoint — two additions and a division.
 */

import { type Box, boxToPolylineSq, boxToSegmentSq } from "./geometry.ts";
import type { Scene, SceneEdge, SceneLabel } from "./scene-layout.ts";
import type { TitleBox } from "./route-detour.ts";

/**
 * Beyond this a label has visibly left its flow, whatever else is near it.
 * Between `ATTACHED` and here the label is anchored only if some *other* flow's
 * run is closer than its own — a mid-distance label with no rival is elk's
 * placement doing its job (often floated deliberately clear of a tight
 * corridor), and re-centring it is not a repair but a new defect: measured on
 * `medium.cairn`, it dropped a 52px two-line box into a 10px corridor, piercing
 * the neighbour run and evicting the neighbour's label into a third flow.
 * Matches the sweep's `LABEL_ADRIFT`.
 */
const ADRIFT = 20;

/**
 * A candidate seat this close to a foreign run would put that run through the
 * label's text — the exact defect (`labelPierced`) this pass exists to prevent,
 * so it must not create one. Matches the sweep's `PIERCE_SLACK`.
 */
const PIERCE = 1;

/**
 * The run to centre the label on.
 *
 * Preference is the nearest segment long enough to carry the label, so a label
 * travels as little as possible from where elk chose to put it — elk's placement
 * already accounts for crossings and label-side selection, and none of that
 * knowledge should be thrown away for a route that only partly moved.
 *
 * Only when no segment is long enough does the longest one win: a label
 * overhanging a short run still reads as attached to it, while a label centred
 * on a 4px stub between two turns reads as attached to nothing.
 */
function hostSegment(label: SceneLabel, edge: SceneEdge): number {
  let host = -1;
  let hostScore = 0;
  let hostFits = false;
  for (let index = 0; index + 1 < edge.pts.length; index++) {
    const a = edge.pts[index];
    const b = edge.pts[index + 1];
    const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
    const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    const fits = span >= (vertical ? label.height : label.width);
    // Nearest among the segments that fit; longest among those that don't.
    // Negated distance so that "bigger score wins" reads the same either way.
    const score = fits ? -boxToSegmentSq(label as Box, a, b) : span;
    if (host < 0 || (fits && !hostFits) || (fits === hostFits && score > hostScore)) {
      host = index;
      hostScore = score;
      hostFits = fits;
    }
  }
  return host;
}

/**
 * Distance from a label's top edge to the centre of its **text**, which is what
 * has to land on the run. The rows sit at the top of the box; a protocol line
 * and business-object chips fill the rest below them, so centring the *box*
 * puts the run between the text and the chip — under the words, which is
 * exactly what "on the line" is not. Chip-only labels have no text to centre,
 * so the box centre stands in.
 */
const textLead = (label: SceneLabel) => (label.textH > 0 ? label.textH / 2 : label.height / 2);

/** Seat a label so its text centre sits on `point`, keeping it centred across. */
function seatAt(label: SceneLabel, x: number, y: number): Box {
  return {
    x: x - label.width / 2,
    y: y - textLead(label),
    width: label.width,
    height: label.height,
  };
}

export function anchorFlowLabels(scene: Scene, titleBoxes: TitleBox[] = []): void {
  const routes = scene.edges.filter((edge) => edge.pts.length >= 2);
  const leaves = scene.nodes.filter((node) => !node.container);
  /** Nearest foreign run to a box, squared. */
  const nearestOtherSq = (box: Box, own: SceneEdge): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const other of routes) {
      if (other === own) continue;
      const d = boxToPolylineSq(box, other.pts);
      if (d < best) best = d;
    }
    return best;
  };
  /**
   * Does this seat land on a node box? Seats are chosen here but collisions are
   * resolved later by the renderer's settler, and every seat handed over
   * already covering a box is one the settler must undo — usually by taking the
   * label *off* its run, which is the one thing this pass exists to prevent.
   * Cheaper to not choose it.
   */
  const overlaps = (
    box: Box,
    other: { x: number; y: number; width: number; height: number },
  ) =>
    box.x < other.x + other.width &&
    other.x < box.x + box.width &&
    box.y < other.y + other.height &&
    other.y < box.y + box.height;
  // A seat over a node box, or over a container's *name* (§4e) — a title has no
  // halo to hide behind, so a label parked on one buries the words. Both are
  // refused here rather than left to the settler, whose only escape is to take
  // the label off its run.
  const coversNode = (box: Box) =>
    leaves.some((node) => overlaps(box, node)) || titleBoxes.some((band) => overlaps(box, band));
  const seated: {
    label: SceneLabel;
    from: { x: number; y: number };
    own: number;
    alternatives: Box[];
    done?: boolean;
  }[] = [];

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    for (const label of edge.labels) {
      if (!label.width || !label.height) continue;
      const own = boxToPolylineSq(label as Box, edge.pts);
      // *Every* label is seated on its run — there is no "close enough".
      // Skipping labels already within a few px (the old `ATTACHED` floor) is
      // precisely what left them where elk parks them, ~3px clear of the line,
      // which reads as a caption beside the flow rather than a name on it.
      const host = hostSegment(label, edge);
      if (host < 0) continue;
      const seatOn = (segment: number): Box => {
        const a = edge.pts[segment];
        const b = edge.pts[segment + 1];
        return seatAt(label, (a.x + b.x) / 2, (a.y + b.y) / 2);
      };
      // Prefer a seat no other flow's run crosses: the host segment's midpoint
      // first, then points along it, then the other segments. Sliding *along*
      // the run keeps the label on the line — the whole point — so it is tried
      // exhaustively before conceding a different segment.
      const segmentOrder = [
        host,
        ...Array.from({ length: edge.pts.length - 1 }, (_, i) => i).filter((i) => i !== host),
      ];
      // Two sweeps over the same seats. The first wants a seat that is both
      // clear of node boxes and unpierced; the second settles for clear of
      // boxes. A pierced seat still reads correctly — the run is masked behind
      // the label's halo — while a seat over a node box forces the settler to
      // move the label off its run, so boxes are the harder constraint.
      let seat: Box | null = null;
      const seatsOf = (segment: number): Box[] => {
        const a = edge.pts[segment];
        const b = edge.pts[segment + 1];
        const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
        const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
        const need = vertical ? label.height : label.width;
        // How far the seat may slide from the midpoint without overhanging the
        // run's ends. Zero when the label is longer than the run it sits on.
        const room = Math.max(0, (span - need) / 2);
        const fractions = room === 0 ? [0] : [0, -0.5, 0.5, -0.25, 0.25, -1, 1];
        return fractions.map((fraction) =>
          vertical
            ? seatAt(label, (a.x + b.x) / 2, (a.y + b.y) / 2 + room * fraction)
            : seatAt(label, (a.x + b.x) / 2 + room * fraction, (a.y + b.y) / 2),
        );
      };
      for (const wantUnpierced of [true, false]) {
        for (const segment of segmentOrder) {
          for (const candidate of seatsOf(segment)) {
            if (coversNode(candidate)) continue;
            if (wantUnpierced && nearestOtherSq(candidate, edge) <= PIERCE * PIERCE) continue;
            seat = candidate;
            break;
          }
          if (seat) break;
        }
        if (seat) break;
      }
      // Every seat is pierced. Sitting on the run still beats floating beside
      // it: `labelPierced` is a ratchet, being off the line is the invariant
      // this pass exists to hold. Take the host seat and let the settler, which
      // can slide along the run too, look for something better.
      if (!seat) seat = seatOn(host);
      // Keep every on-line seat this label could take, clear of node boxes, so
      // a collision found below can be answered by sliding along the run before
      // anyone has to leave it.
      // Two tiers. Clean seats first; then seats that only overlap a container
      // title. A label on a title is a §4e blemish, a label off its run breaks
      // §4d — so when the collision loop below has to choose, it takes the
      // blemish. Without the second tier it reverted to elk's placement instead,
      // which took two labels off their line in `security-fr`.
      const alternatives: Box[] = [];
      const tolerated: Box[] = [];
      for (const segment of segmentOrder)
        for (const candidate of seatsOf(segment)) {
          if (!coversNode(candidate)) alternatives.push(candidate);
          else if (!leaves.some((node) => overlaps(candidate, node))) tolerated.push(candidate);
        }
      alternatives.push(...tolerated);
      seated.push({ label, from: { x: label.x, y: label.y }, own, alternatives });
      label.x = seat.x;
      label.y = seat.y;
    }
  }

  // Seats are chosen one flow at a time, so two can land on top of each other —
  // and a collision here is not a blemish, it is a hard invariant (§1) the
  // renderer's settler must then break something else to clear. Its only escape
  // from a crowded corridor is to fling one label past `ADRIFT`, trading §4d and
  // §4a for §1. Measured in `medium.cairn`, whose 12px corridor cannot seat a
  // 142px two-line label beside its neighbour at all.
  //
  // So a colliding pair is resolved here instead, by giving one label back its
  // original placement — elk's, which was chosen with the whole drawing in view.
  // The one that yields is the one that can afford to: already near its run, and
  // larger, since the bigger box is the one that cannot fit. Ties break on flow
  // id, never on iteration order.
  const overlapping = (a: SceneLabel, b: SceneLabel) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const rank = (entry: (typeof seated)[number]) =>
    entry.label.width * entry.label.height;
  for (let round = 0; round < 3; round++) {
    let reverted = false;
    for (let i = 0; i < seated.length; i++)
      for (let j = i + 1; j < seated.length; j++) {
        const a = seated[i];
        const b = seated[j];
        if (a.done || b.done) continue;
        if (!overlapping(a.label, b.label)) continue;
        // Only a label already close to its run may be given back — reverting
        // one that was adrift would reintroduce the defect §4a forbids.
        const candidates = [a, b]
          .filter((entry) => entry.own <= ADRIFT * ADRIFT)
          .sort(
            (x, y) =>
              rank(y) - rank(x) ||
              x.label.flowId.localeCompare(y.label.flowId),
          );
        const yielding = candidates[0];
        if (!yielding) continue;
        // Slide along the run before leaving it: any other on-line seat that
        // clears every label already placed keeps §4d intact for both flows.
        const free = yielding.alternatives.find((candidate) => {
          const trial = { ...yielding.label, x: candidate.x, y: candidate.y };
          return !seated.some(
            (other) => other !== yielding && overlapping(trial, other.label),
          );
        });
        if (free) {
          yielding.label.x = free.x;
          yielding.label.y = free.y;
        } else {
          yielding.label.x = yielding.from.x;
          yielding.label.y = yielding.from.y;
          yielding.done = true;
        }
        reverted = true;
      }
    if (!reverted) break;
  }
}
