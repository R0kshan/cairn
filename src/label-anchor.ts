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

import { type Box, type TitleBox, boxToPolylineSq, boxToSegmentSq } from "./geometry.ts";
import type { Scene, SceneEdge, SceneLabel } from "./scene-layout.ts";

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
 * Inside this a label reads as sitting on its own run whatever else is nearby,
 * so a neighbour grazing nearer is not an ambiguity. Matches the sweep's
 * `LABEL_ATTACHED`, the floor under `labelOrphan`.
 */
const ATTACHED = 6;

/**
 * How far a label's *text centre* may sit from its own run and still count as
 * on it. Matches the sweep's `ON_LINE_SLACK`, which is what exempts a seated
 * label from `labelPierced`.
 */
const ON_LINE = 2;

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
  /**
   * Is a foreign run travelling **parallel** to this seat's own run and
   * passing strictly inside its box (INVARIANTS §4j)? A crossing run is masked
   * behind the label's halo and the seat still says which line is speaking; a
   * parallel one is masked the same way and emerges on both sides of the
   * words, so nothing is left to tell the two lines apart. Mirrors
   * `straddledBy` in `scripts/sweep.ts` — the guard must measure what the
   * invariant measures (§3).
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
  const seated: {
    label: SceneLabel;
    edge: SceneEdge;
    from: { x: number; y: number };
    own: number;
    alternatives: Box[];
    besideRun: () => Box[];
    done?: boolean;
  }[] = [];
  /**
   * Can a reader tell, from this seat alone, which flow the label names?
   *
   * The three sweep predicates that answer that question, in the sweep's own
   * terms — `labelAdrift`, `labelOrphan` and `labelPierced` are checked here
   * exactly as `scripts/sweep.ts` checks them, on the box for the first two and
   * on the text centre for the on-line exemption of the third (INVARIANTS §3,
   * "a guard must measure what the invariant measures"). Anything less specific
   * is how the revert below used to hand back a seat that cleared `ADRIFT` and
   * broke the other two.
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

  for (const edge of scene.edges) {
    if (edge.pts.length < 2) continue;
    for (const label of edge.labels) {
      if (!label.width || !label.height) continue;
      const own = boxToPolylineSq(label, edge.pts);
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
      // move the label off its run, so boxes are the harder constraint. A
      // *straddled* seat is refused in both sweeps: the halo masks a parallel
      // intruder the same way it masks the label's own run, and nothing is
      // left to tell the reader which line is speaking (§4j). Sliding along
      // the run to a straddle-free seat is always the cheaper fix.
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
      const segVertical = (segment: number): boolean => {
        const a = edge.pts[segment];
        const b = edge.pts[segment + 1];
        return Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
      };
      for (const wantUnpierced of [true, false]) {
        for (const segment of segmentOrder) {
          for (const candidate of seatsOf(segment)) {
            if (coversNode(candidate)) continue;
            if (straddledSeat(candidate, segVertical(segment), edge)) continue;
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
          if (straddledSeat(candidate, segVertical(segment), edge)) continue;
          if (!coversNode(candidate)) alternatives.push(candidate);
          else if (!leaves.some((node) => overlaps(candidate, node))) tolerated.push(candidate);
        }
      // Slides that let the box overhang the end of its run. `seatsOf` stops
      // where the *box* would, which is tidier but stricter than §4d, whose rule
      // is about the **text centre** — and the difference is half a label wide.
      // Capped so the text centre never leaves the segment, so these are on-line
      // seats like the ones above: `own` is 0, and §4a exempts an on-line label
      // from `labelOrphan` and `labelPierced` alike.
      //
      // Worth its own rung even though `besideRun` below regenerates the same
      // positions at `away = 0`: reaching them there costs a title-band strike,
      // because `besideRun` is only consulted once the plain slide has failed and
      // by then the neighbour has taken the seat. Removing this cost
      // `security-fr` a `titleStruck` in *page* and *tall* — invisible to
      // `npm run snapshots:report`, which renders each example in its own
      // disposition only. Only the sweep sees the other three.
      const stretched: Box[] = [];
      for (const segment of segmentOrder) {
        const a = edge.pts[segment];
        const b = edge.pts[segment + 1];
        const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
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
          stretched.push(candidate);
        }
      }
      alternatives.push(...stretched);
      // The rung between "slide along the run" and "give up": seats *beside* the
      // run that still read as belonging to it. Where two runs are closer than a
      // label is tall, no seat on the line can clear the neighbour's label — and
      // the loop below used to jump straight from there to elk's placement, which
      // is off the line *and* unattributable. `medium`'s F10/F12 sit 10px apart
      // between two nodes 181px apart while their labels are 111px and 71px wide:
      // 182px of label in 181px of corridor. F12 was handed a seat 9px off its
      // run with F06 drawn through its words — `labelOrphan` + `labelPierced`
      // across six drawings — while F10, which had thousands of clean positions,
      // kept the seat it did not need. An exhaustive search over both labels
      // confirms the pair is placeable; only this ladder was missing.
      //
      // Two dimensions, because one is not enough: the seat that solves F10 is
      // both past the end of its run and 43px below it. Along-offsets run out to
      // half a label beyond each end (the box may overhang, §4d constrains the
      // *text centre*, and `attributableAt` enforces what actually matters);
      // away-offsets step perpendicular.
      //
      // Built on demand. Every candidate costs a scan of every route, and pairs
      // that cannot slide along their own run are rare — computing this list for
      // every label eagerly made the sweep pay for it on all 4352 flow-instances.
      const besideRun = (): Box[] => {
        const out: Box[] = [];
        for (const segment of segmentOrder) {
          const a = edge.pts[segment];
          const b = edge.pts[segment + 1];
          const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
          const span = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
          const need = vertical ? label.height : label.width;
          const outer = span / 2;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          for (const along of [0, -outer / 2, outer / 2, -outer, outer, -outer - need / 2, outer + need / 2])
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
      };
      alternatives.push(...tolerated);
      seated.push({ label, edge, from: { x: label.x, y: label.y }, own, alternatives, besideRun });
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
  // So a colliding pair is resolved here instead. Three escapes, in the order
  // §4d ranks them by what they cost the reader: slide along the run (never
  // leaves the line), then a seat beside the run that keeps attribution, then
  // elk's original placement, which keeps neither.
  //
  // Both labels are offered each escape, preferring the larger one, since the
  // bigger box is the one that cannot fit. Ties break on flow id, never on
  // iteration order.
  const overlapping = (a: SceneLabel, b: SceneLabel) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const rank = (entry: (typeof seated)[number]) =>
    entry.label.width * entry.label.height;
  /** Does moving this label to `at` clear every other seated label? */
  const clearAt = (entry: (typeof seated)[number], at: { x: number; y: number }) => {
    const trial = { ...entry.label, x: at.x, y: at.y };
    return !seated.some((other) => other !== entry && overlapping(trial, other.label));
  };
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (let i = 0; i < seated.length; i++)
      for (let j = i + 1; j < seated.length; j++) {
        const a = seated[i];
        const b = seated[j];
        if (a.done || b.done) continue;
        if (!overlapping(a.label, b.label)) continue;
        const order = [a, b].sort(
          (x, y) => rank(y) - rank(x) || x.label.flowId.localeCompare(y.label.flowId),
        );
        // Slide along the run before leaving it: any other on-line seat that
        // clears every label already placed keeps §4d intact for *both* flows.
        //
        // Asked of each label in turn, not only the preferred yielder. Where the
        // larger label is boxed in and the smaller has room, offering the escape
        // to one of them and then reverting was throwing away a seat that was
        // free the whole time — `large-fr/wide` sent F04 to the settler with F07's
        // thirteen alternatives untried, and the settler's only remaining escape
        // was an 86px throw that landed 24px off F04's run (`labelAdrift`).
        let escaped = false;
        for (const entry of order) {
          const free = entry.alternatives.find((candidate) => clearAt(entry, candidate));
          if (!free) continue;
          entry.label.x = free.x;
          entry.label.y = free.y;
          escaped = true;
          break;
        }
        // Neither label can stay on its line. Step one of them off it, but only
        // onto a seat `attributableAt` accepts — off the line is a `labelOffLine`
        // ratchet, off the *flow* is §4a. Reached only here, so a corridor that
        // the slide above could solve never pays for these candidates.
        for (const entry of escaped ? [] : order) {
          const free = entry.besideRun().find((candidate) => clearAt(entry, candidate));
          if (!free) continue;
          entry.label.x = free.x;
          entry.label.y = free.y;
          escaped = true;
          break;
        }
        if (escaped) {
          moved = true;
          continue;
        }
        // Nothing on or beside either run. Elk's original placement is the last
        // resort, unchanged: only a label already close to its run may be given
        // back, since reverting one that was adrift would reintroduce §4a.
        //
        // Left as an unconditional move on purpose. Making it conditional — and
        // leaving the pair for the renderer's settler when no attributable
        // revert existed — was measured on `medium`: the settler cannot always
        // clear what it is handed, and the slice gained 5 `overlaps` and 5
        // `labelAdrift`, both must-be-zero. Something has to move here.
        const giving = order.find((entry) => entry.own <= ADRIFT * ADRIFT);
        if (!giving) continue;
        giving.label.x = giving.from.x;
        giving.label.y = giving.from.y;
        giving.done = true;
        moved = true;
      }
    if (!moved) break;
  }
}
