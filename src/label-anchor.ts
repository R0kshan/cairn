/**
 * Stage 4d: puts every flow label back on the flow it names.
 *
 * elk places a label against the route it planned
 * (`elk.edgeLabels.placement: CENTER`); `route-detour`, `edge-tidy` and
 * `compact` then move that route and leave the label behind — over open space,
 * or in a bundle nearer a foreign flow than its own. Which segment it lands on
 * matters: see `hostSegment`.
 *
 * Ordering is fixed: after `edge-tidy` (a run that still moves is no anchor),
 * before `compact` (a label pins its band, and a stale pin is the dead height
 * `compact` removes).
 *
 * Deterministic — integer-ordered comparisons, segment index as the final
 * tie-break, midpoint arithmetic.
 */

import { type Box, type TitleBox, boxToPolylineSq, boxToSegmentSq } from "./geometry.ts";
import type { Scene, SceneEdge, SceneLabel, SceneNode } from "./scene-layout.ts";

/**
 * Beyond this a label has visibly left its flow. Between `ATTACHED` and here it
 * is re-anchored only when a *foreign* run is closer than its own: a
 * mid-distance label with no rival is elk floating it clear of a tight
 * corridor, and re-centring it is a new defect, not a repair — on `medium` it
 * dropped a 52px two-line box into a 10px corridor, pierced the neighbour run
 * and evicted that neighbour's label into a third flow. Sweep: `LABEL_ADRIFT`.
 */
const ADRIFT = 20;

/**
 * A seat this close to a foreign run puts that run through the label's text —
 * `labelPierced`, the defect this pass exists to prevent. Sweep: `PIERCE_SLACK`.
 */
const PIERCE = 1;

/**
 * Inside this a label reads as sitting on its own run whatever else is near, so
 * a neighbour grazing closer is not an ambiguity. Sweep: `LABEL_ATTACHED`, the
 * floor under `labelOrphan`.
 */
const ATTACHED = 6;

/**
 * How far a label's *text centre* may sit from its own run and still count as
 * on it. Sweep: `ON_LINE_SLACK`, which exempts a seated label from
 * `labelPierced`.
 */
const ON_LINE = 2;

/**
 * The run to centre the label on: the nearest segment long enough to carry it,
 * so the label travels as little as possible from elk's placement — which
 * already accounts for crossings and label-side selection.
 *
 * Only when nothing is long enough does the longest win. A label overhanging a
 * short run still reads as attached to it; one centred on a 4px stub between
 * two turns reads as attached to nothing.
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
    const score = fits ? -boxToSegmentSq(label, a, b) : span;
    if (host < 0 || (fits && !hostFits) || (fits === hostFits && score > hostScore)) {
      host = index;
      hostScore = score;
      hostFits = fits;
    }
  }
  return host;
}

/**
 * Top edge to the centre of the **text**, which is what must land on the run.
 * Text rows sit at the top of the box and a protocol line and chips fill the
 * rest, so centring the *box* puts the run between text and chip — under the
 * words, which is what "on the line" is not. Chip-only labels have no text, so
 * the box centre stands in.
 */
const textLead = (label: SceneLabel) => (label.textH > 0 ? label.textH / 2 : label.height / 2);

/** Seat a label so its text centre sits on (x, y), keeping it centred across. */
function seatAt(label: SceneLabel, x: number, y: number): Box {
  return {
    x: x - label.width / 2,
    y: y - textLead(label),
    width: label.width,
    height: label.height,
  };
}

interface SeatedLabel {
  label: SceneLabel;
  edge: SceneEdge;
  from: { x: number; y: number };
  own: number;
  alternatives: Box[];
  besideRun: () => Box[];
  done?: boolean;
}

/** Shared predicates every per-label seat search and the collision pass need. */
interface LabelSeatContext {
  scene: Scene;
  routes: SceneEdge[];
  leaves: SceneNode[];
  titleBoxes: TitleBox[];
  nearestOtherSq(box: Box, own: SceneEdge): number;
  overlaps(box: Box, other: { x: number; y: number; width: number; height: number }): boolean;
  coversNode(box: Box): boolean;
  straddledSeat(box: Box, vertical: boolean, own: SceneEdge): boolean;
  attributableAt(label: SceneLabel, at: { x: number; y: number }, edge: SceneEdge): boolean;
}

function createLabelSeatContext(scene: Scene, titleBoxes: TitleBox[]): LabelSeatContext {
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
  const overlaps = (box: Box, other: { x: number; y: number; width: number; height: number }) =>
    box.x < other.x + other.width &&
    other.x < box.x + box.width &&
    box.y < other.y + other.height &&
    other.y < box.y + box.height;
  // A container title has no halo, so a label parked on one buries the words
  // (§4e). Refused here rather than handed to the renderer's settler, whose
  // only escape is to take the label off its run.
  const coversNode = (box: Box) =>
    leaves.some((node) => overlaps(box, node)) || titleBoxes.some((band) => overlaps(box, band));
  /**
   * Is a foreign run travelling **parallel** to this seat's own run and passing
   * strictly inside its box (§4j)? A crossing run is masked by the halo and the
   * seat still says which line speaks; a parallel one is masked the same way
   * and emerges on both sides of the words. Mirrors `straddledBy` in
   * `scripts/sweep.ts` (§3).
   */
  const straddledSeat = (box: Box, vertical: boolean, own: SceneEdge): boolean => {
    const lo = vertical ? box.x : box.y;
    const hi = lo + (vertical ? box.width : box.height);
    for (const other of routes) {
      if (other === own) continue;
      for (let i = 0; i + 1 < other.pts.length; i++) {
        const a = other.pts[i];
        const b = other.pts[i + 1];
        const runVertical = Math.abs(a.x - b.x) < 0.5;
        const runHorizontal = Math.abs(a.y - b.y) < 0.5;
        if (runVertical === runHorizontal) continue;
        if (runVertical !== vertical) continue;
        if (boxToSegmentSq(box, a, b) > 0) continue;
        const at = vertical ? a.x : a.y;
        if (at > lo + 1 && at < hi - 1) return true;
      }
    }
    return false;
  };

  /**
   * Can a reader tell, from this seat alone, which flow the label names?
   *
   * `labelAdrift`, `labelOrphan` and `labelPierced` exactly as
   * `scripts/sweep.ts` checks them — box for the first two, text centre for the
   * third's on-line exemption (§3). Anything looser is how the revert below
   * used to hand back seats that cleared `ADRIFT` and broke the other two.
   */
  const attributableAt = (label: SceneLabel, at: { x: number; y: number }, edge: SceneEdge) => {
    const box: Box = { x: at.x, y: at.y, width: label.width, height: label.height };
    const own = boxToPolylineSq(box, edge.pts);
    if (own > ADRIFT * ADRIFT) return false;
    const other = nearestOtherSq(box, edge);
    if (own > ATTACHED * ATTACHED && other < own) return false;
    const centre = { x: at.x + label.width / 2, y: at.y + textLead(label), width: 0, height: 0 };
    const onLine = boxToPolylineSq(centre, edge.pts) <= ON_LINE * ON_LINE;
    return onLine || other > PIERCE * PIERCE;
  };

  return {
    scene,
    routes,
    leaves,
    titleBoxes,
    nearestOtherSq,
    overlaps,
    coversNode,
    straddledSeat,
    attributableAt,
  };
}

const segmentIsVertical = (edge: SceneEdge, segment: number): boolean => {
  const a = edge.pts[segment];
  const b = edge.pts[segment + 1];
  return Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
};

/** The seat centred on a segment's midpoint. */
const midpointSeat = (label: SceneLabel, edge: SceneEdge, segment: number): Box => {
  const a = edge.pts[segment];
  const b = edge.pts[segment + 1];
  return seatAt(label, (a.x + b.x) / 2, (a.y + b.y) / 2);
};

/**
 * Seats along one segment: the midpoint, then slides either way. `room` is how
 * far a seat may slide without overhanging the run's ends — zero when the label
 * is longer than the run it sits on.
 */
function slideSeats(label: SceneLabel, edge: SceneEdge, segment: number): Box[] {
  const a = edge.pts[segment];
  const b = edge.pts[segment + 1];
  const vertical = segmentIsVertical(edge, segment);
  const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
  const room = Math.max(0, (span - (vertical ? label.height : label.width)) / 2);
  const fractions = room === 0 ? [0] : [0, -0.5, 0.5, -0.25, 0.25, -1, 1];
  return fractions.map((fraction) =>
    vertical
      ? seatAt(label, (a.x + b.x) / 2, (a.y + b.y) / 2 + room * fraction)
      : seatAt(label, (a.x + b.x) / 2 + room * fraction, (a.y + b.y) / 2),
  );
}

/**
 * The seat this label takes, or null when every candidate is pierced.
 *
 * Two sweeps over the same seats: the first wants clear of node boxes *and*
 * unpierced, the second settles for clear of boxes. A pierced seat still reads
 * correctly — the halo masks the run — while a seat over a box forces the
 * settler to take the label off its run. A *straddled* seat is refused in both:
 * the halo masks a parallel intruder the same way, leaving nothing to say which
 * line is speaking (§4j).
 */
function chooseSeat(
  ctx: LabelSeatContext,
  edge: SceneEdge,
  label: SceneLabel,
  segmentOrder: number[],
): Box | null {
  const { coversNode, straddledSeat, nearestOtherSq } = ctx;
  for (const wantUnpierced of [true, false])
    for (const segment of segmentOrder)
      for (const candidate of slideSeats(label, edge, segment)) {
        if (coversNode(candidate)) continue;
        if (straddledSeat(candidate, segmentIsVertical(edge, segment), edge)) continue;
        if (wantUnpierced && nearestOtherSq(candidate, edge) <= PIERCE * PIERCE) continue;
        return candidate;
      }
  return null;
}

/**
 * Slides that let the *box* overhang its run's end. `slideSeats` stops where the
 * box would, which is stricter than §4d — whose rule is the text centre, half a
 * label further out. Capped so the centre never leaves the segment, so `own` is
 * 0 and §4a exempts these from `labelOrphan` and `labelPierced`.
 *
 * Worth its own rung even though `besideRunSeats` regenerates them at
 * `away = 0`: reaching them there costs a title strike, since that runs only
 * after the plain slide failed. Removing it cost `security-fr` a `titleStruck`
 * in page and tall — invisible to `snapshots:report`, which renders one
 * disposition per example; only the sweep sees the rest.
 */
function stretchedSeats(
  ctx: LabelSeatContext,
  edge: SceneEdge,
  label: SceneLabel,
  segmentOrder: number[],
): Box[] {
  const { coversNode, straddledSeat } = ctx;
  const out: Box[] = [];
  for (const segment of segmentOrder) {
    const a = edge.pts[segment];
    const b = edge.pts[segment + 1];
    const vertical = segmentIsVertical(edge, segment);
    const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    const room = Math.max(0, (span - (vertical ? label.height : label.width)) / 2);
    const outer = span / 2;
    if (outer <= room) continue;
    const middle = (room + outer) / 2;
    for (const offset of [-middle, middle, -outer, outer]) {
      const candidate = vertical
        ? seatAt(label, (a.x + b.x) / 2, (a.y + b.y) / 2 + offset)
        : seatAt(label, (a.x + b.x) / 2 + offset, (a.y + b.y) / 2);
      if (coversNode(candidate)) continue;
      if (straddledSeat(candidate, vertical, edge)) continue;
      out.push(candidate);
    }
  }
  return out;
}

/**
 * The rung between "slide along the run" and "give up": seats *beside* the run
 * that still read as belonging to it. Where two runs sit closer than a label is
 * tall, no on-line seat clears the neighbour's label — `medium`'s F10/F12 (10px
 * apart, labels 111px/71px wide between nodes 181px apart) left F12 9px off its
 * run with F06 through its words.
 *
 * Two dimensions, since the seat that solves F10 is past its run's end *and*
 * 43px below it. Along-offsets reach half a label beyond each end
 * (`attributableAt` enforces the text-centre rule §4d actually states);
 * away-offsets step perpendicular.
 *
 * Called on demand: computing it for every label cost the sweep across all 4352
 * flow-instances.
 */
function besideRunSeats(
  ctx: LabelSeatContext,
  edge: SceneEdge,
  label: SceneLabel,
  segmentOrder: number[],
): Box[] {
  const { coversNode, straddledSeat, attributableAt } = ctx;
  const out: Box[] = [];
  for (const segment of segmentOrder) {
    const a = edge.pts[segment];
    const b = edge.pts[segment + 1];
    const vertical = segmentIsVertical(edge, segment);
    const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    const need = vertical ? label.height : label.width;
    const outer = span / 2;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    for (const along of [
      0,
      -outer / 2,
      outer / 2,
      -outer,
      outer,
      -outer - need / 2,
      outer + need / 2,
    ])
      for (const away of [0, -14, 14, -28, 28, -44, 44]) {
        const candidate = seatAt(
          label,
          midX + (vertical ? away : along),
          midY + (vertical ? along : away),
        );
        if (coversNode(candidate)) continue;
        if (away === 0 && straddledSeat(candidate, vertical, edge)) continue;
        if (!attributableAt(label, candidate, edge)) continue;
        out.push(candidate);
      }
  }
  return out;
}

/** Finds where `label` should sit on `edge`, and mutates it there. Returns
 *  `null` when the label is empty or its route has no viable host segment —
 *  the caller then leaves it unseated. */
function seatLabelOnRoute(
  ctx: LabelSeatContext,
  edge: SceneEdge,
  label: SceneLabel,
): SeatedLabel | null {
  const { leaves, overlaps, coversNode, straddledSeat } = ctx;
  if (!label.width || !label.height) return null;
  const own = boxToPolylineSq(label, edge.pts);
  // *Every* label is seated on its run — there is no "close enough".
  // Skipping labels already within a few px left them where elk parks them,
  // ~3px clear, reading as a caption beside the flow rather than a name on it.
  const host = hostSegment(label, edge);
  if (host < 0) return null;
  // Prefer a seat no foreign run crosses: host midpoint, then points along
  // it, then the other segments. Sliding *along* the run keeps the label on
  // the line, so it is exhausted before conceding a different segment.
  const segmentOrder = [
    host,
    ...Array.from({ length: edge.pts.length - 1 }, (_, i) => i).filter((i) => i !== host),
  ];

  // Every seat is pierced. On the run still beats floating beside it:
  // `labelPierced` is a ratchet, off-the-line is the invariant. Take the
  // host seat; the settler can slide along the run too.
  const seat = chooseSeat(ctx, edge, label, segmentOrder) ?? midpointSeat(label, edge, host);

  // Every on-line seat this label could take, so a collision below can be
  // answered by sliding rather than leaving the run. Two tiers: clean seats,
  // then seats overlapping only a container title. A label on a title is a
  // §4e blemish, off its run breaks §4d. Without the second tier it reverted
  // to elk's placement and took two labels off their line in `security-fr`.
  const alternatives: Box[] = [];
  const tolerated: Box[] = [];
  for (const segment of segmentOrder)
    for (const candidate of slideSeats(label, edge, segment)) {
      if (straddledSeat(candidate, segmentIsVertical(edge, segment), edge)) continue;
      if (!coversNode(candidate)) alternatives.push(candidate);
      else if (!leaves.some((node) => overlaps(candidate, node))) tolerated.push(candidate);
    }
  alternatives.push(...stretchedSeats(ctx, edge, label, segmentOrder));
  alternatives.push(...tolerated);

  const entry: SeatedLabel = {
    label,
    edge,
    from: { x: label.x, y: label.y },
    own,
    alternatives,
    besideRun: () => besideRunSeats(ctx, edge, label, segmentOrder),
  };
  label.x = seat.x;
  label.y = seat.y;
  return entry;
}

const labelsOverlap = (a: SceneLabel, b: SceneLabel) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Bigger boxes yield last — the big one is the label that cannot fit. */
const seatArea = (entry: SeatedLabel) => entry.label.width * entry.label.height;

/** Does moving this label to `at` clear every other seated label? */
const clearAt = (seated: SeatedLabel[], entry: SeatedLabel, at: { x: number; y: number }) => {
  const trial = { ...entry.label, x: at.x, y: at.y };
  return !seated.some((other) => other !== entry && labelsOverlap(trial, other.label));
};

/**
 * Separate one overlapping pair, cheapest escape first; true when something
 * moved. Both labels are offered each rung, larger first, ties breaking on flow
 * id rather than iteration order.
 *
 * 1. Slide along the run — any on-line seat clearing every placed label keeps
 *    §4d for *both* flows. Asked of each label in turn, not only the preferred
 *    yielder: `large-fr/wide` sent F04 to the settler with F07's thirteen
 *    alternatives untried, and the settler's only escape was an 86px throw
 *    landing 24px off F04's run (`labelAdrift`).
 * 2. A seat beside the run — off the line is a `labelOffLine` ratchet, off the
 *    *flow* is §4a, so only seats `attributableAt` accepts. Reached only here,
 *    so a corridor the slide solves never pays for these candidates.
 * 3. Elk's placement, and only for a label already close to its run — reverting
 *    an adrift one reintroduces §4a. Leaving the pair to the settler instead was
 *    measured on `medium` and cost 5 `overlaps` and 5 `labelAdrift`, both
 *    must-be-zero. Something has to move here.
 */
function resolveLabelCollision(seated: SeatedLabel[], a: SeatedLabel, b: SeatedLabel): boolean {
  const order = [a, b].sort(
    (x, y) => seatArea(y) - seatArea(x) || x.label.flowId.localeCompare(y.label.flowId),
  );
  for (const rung of [
    (entry: SeatedLabel) => entry.alternatives,
    (entry: SeatedLabel) => entry.besideRun(),
  ])
    for (const entry of order) {
      const free = rung(entry).find((candidate) => clearAt(seated, entry, candidate));
      if (!free) continue;
      entry.label.x = free.x;
      entry.label.y = free.y;
      return true;
    }
  const giving = order.find((entry) => entry.own <= ADRIFT * ADRIFT);
  if (!giving) return false;
  giving.label.x = giving.from.x;
  giving.label.y = giving.from.y;
  giving.done = true;
  return true;
}

/** Positions flow labels on their routes, avoiding overlaps with nodes and other labels. */
export function anchorFlowLabels(scene: Scene, titleBoxes: TitleBox[] = []): void {
  const ctx = createLabelSeatContext(scene, titleBoxes);
  const seated: SeatedLabel[] = [];

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    for (const label of edge.labels) {
      const entry = seatLabelOnRoute(ctx, edge, label);
      if (entry) seated.push(entry);
    }
  }

  // Seats are chosen one flow at a time, so two can land on each other — and a
  // collision is invariant §1, which the settler can only clear by flinging a
  // label past `ADRIFT`, trading §4d and §4a for §1. `medium`'s 12px corridor
  // cannot seat a 142px two-line label beside its neighbour at all. Each pair is
  // resolved here instead, by what §4d says the escape costs the reader.
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (let i = 0; i < seated.length; i++)
      for (let j = i + 1; j < seated.length; j++) {
        const a = seated[i];
        const b = seated[j];
        if (a.done || b.done) continue;
        if (!labelsOverlap(a.label, b.label)) continue;
        if (resolveLabelCollision(seated, a, b)) moved = true;
      }
    if (!moved) break;
  }
}
