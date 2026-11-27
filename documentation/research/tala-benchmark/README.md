# Readability benchmark: cairn and D2 (TALA, ELK, dagre)

How readable are the views cairn draws, compared with D2 and its three layout
engines? This folder answers with measurements anyone can rerun.

## Method

1. **Every view in the repository.** `run.sh` takes every `.cairn` file tracked
   in git (94 today; `examples/broken.cairn` is invalid on purpose and is
   skipped).
2. **Same content in D2.** [`to-d2.ts`](to-d2.ts) translates each view
   mechanically: same elements, same nesting, the same text on every arrow
   (label, technology, business objects), dashed and dotted flows kept, left to
   right. Where D2 has a shape with the same meaning it is used (actor →
   `person`, datastore → `cylinder`, queue → `queue`); nothing else is styled
   or hinted.
3. **Every engine, default settings.** D2 renders each translation with TALA,
   ELK and dagre. cairn renders the original file, as its author wrote it.
4. **One ruler.** [`measure.py`](measure.py) reads the final SVGs, cairn's and
   D2's alike, and computes the same metrics for both.

## Metrics

| Metric | What it counts | Why it matters |
|---|---|---|
| `text_overlaps` | Pairs of texts whose boxes intersect | Overlapping text can't be read |
| `text_crossed` | Text lines crossed by a flow that isn't their own | A line through a label hides words |
| `edge_crossings` | Pairs of flows that cross each other | Each crossing makes a flow harder to follow |
| `through_boxes` | A flow passing through a box that is neither its source nor its target | It looks connected to that box |
| `width`, `height` | The canvas | How much room the view needs |
| `a4_min_px`, `slide_min_px` | Height of the smallest text once the whole canvas is fitted to an A4 landscape page, or a 16:9 slide | Whether the view stays readable on the medium it is meant for |

How text is read:

- **Sizes** use each SVG's own font: D2 embeds its fonts, and cairn's
  Helvetica/Arial is measured with Liberation Sans or Arial, which share the
  same metrics.
- **Lines of the same label** are not compared with each other, and a text
  drawn twice in place (a halo under the visible copy) counts once.
- **A flow's own label** is not counted as crossed by it. Which label belongs to
  which flow comes from each tool: D2 groups a connection with its label in the
  SVG, and [`owners.ts`](owners.ts) writes a sidecar file for each cairn SVG
  from cairn's own layout. Guessing by proximity proved unreliable for both
  tools, so `owner_agreement` in `results.json` reports how often a proximity
  rule would have agreed.

## Results

Run on 2026-11-27 with cairn 1.0.0 and D2 0.9, built from source
(d2lang/d2@adad396, 2026-11-22). The headline numbers cover the 45 views with
distinct content. The theme, disposition and placement variants give D2 the same
input as their base example, so they are summarized separately in
`summary.txt`.

| 45 views | cairn | D2 + TALA | D2 + ELK | D2 + dagre |
|---|---|---|---|---|
| Overlapping text (total) | **0** | 2 | 20 | 45 |
| Views with no overlapping text | **45** | 44 | 37 | 28 |
| Labels crossed by another flow (total) | 36 | **31** | 92 | 207 |
| Flow crossings (total) | 443 | **231** | 405 | 304 |
| Flows through an unrelated box (total) | **0** | **0** | **0** | 60 |
| Canvas area (median) | **0.86 M px²** | 3.15 M px² | 3.66 M px² | 4.52 M px² |
| Smallest text on A4 (median) | 7.1 px | **7.2 px** | 5.7 px | 5.8 px |
| Smallest text on a 16:9 slide (median) | **8.0 px** | 6.7 px | 6.5 px | 5.7 px |

cairn against D2 + TALA, view by view:

| | cairn better | equal | TALA better |
|---|---|---|---|
| Overlapping text | 1 | 44 | 0 |
| Labels crossed by another flow | 7 | 31 | 7 |
| Flow crossings | 12 | 13 | 20 |
| Flows through an unrelated box | 0 | 45 | 0 |
| Canvas area | 45 | 0 | 0 |
| Smallest text on A4 | 18 | 2 | 25 |

What they show:

- **Against dagre and ELK**, cairn draws text more cleanly: no overlapping text,
  and two and a half to six times fewer labels crossed by a flow, on a much
  smaller canvas.
- **Against TALA, it is a trade-off.** cairn fits the same content in a canvas
  about 3.7 times smaller, with no overlapping text. TALA spreads it out and
  has half as many flow crossings. Once each is fitted to a page, their text
  ends up about the same size: TALA is slightly larger on A4, cairn on a slide.
- **The densest view is where TALA does best.** On `large` (logical, 42 flows),
  TALA has 46 crossings and cairn 80: cairn's default wide disposition sends
  long flows across the whole canvas. That is where cairn's layout has the most
  to gain.

## Limits

- **Font sizes are each tool's defaults** (about 12.5 px for cairn's element
  labels, 16 px for D2's). That is what each tool draws, and it weighs on
  canvas size.
- **cairn's canvas includes its title, legend and business-object table**,
  which D2's doesn't have. That counts against cairn on size and page fit.
- **The translation is a choice.** It is mechanical and uses no D2 styling or
  layout hints; a D2 author could tune `direction`, `near` or `grid` per
  diagram, as a cairn author could add hints. Improvements to `to-d2.ts` are
  welcome.
- **TALA ran with its default seeds**; other seeds give other layouts.
- **The examples were written for cairn**, so they reflect the views cairn is
  meant for, not every kind of architecture diagram.

## Running it

On a machine with node ≥ 22.6, git, D2 ≥ 0.9 (TALA is bundled from v0.9.0) and
python3 with fonttools (`pip3 install fonttools`):

```sh
documentation/research/tala-benchmark/run.sh
```

It writes the D2 translations to `d2/`, every SVG to `out/`, the measurements
to `results.json` and the summary to `summary.txt`. `JOBS=8` runs more views in
parallel; `ENGINES="tala"` limits the D2 engines.
