# Readability benchmark: cairn and D2 (dagre, ELK, TALA)

Does cairn draw dense architecture views more readably than D2? This folder
answers with measurements anyone can rerun, instead of a claim.

## Method

1. **Same content.** Six real cairn views, two per view type, a medium and a
   large one: `medium` and `large` (logical, 20 and 42 flows),
   `application-medium` and `application-large` (15 and 27),
   `infrastructure` and `infrastructure-large` (13 and 20). Each is translated
   to D2 by [`to-d2.ts`](to-d2.ts), mechanically: same elements, same nesting,
   same text on every arrow (label, technology, business objects), dashed and
   dotted flows kept, left to right. Where D2 has a shape with the same meaning
   it is used (actor → `person`, datastore → `cylinder`, queue → `queue`);
   nothing else is styled or hinted. The translations are committed in [`d2/`](d2/)
   so they can be reviewed and improved.
2. **Every engine.** D2 renders each translation with dagre (its default), ELK
   and TALA, with default settings. cairn renders the original file.
3. **One ruler.** [`measure.py`](measure.py) reads the final SVGs, cairn's and
   D2's alike, and computes the same metrics for both.

## Metrics

| Metric | What it counts | Why it matters |
|---|---|---|
| `text_overlaps` | Pairs of text lines whose boxes intersect | Overlapping text can't be read |
| `text_crossed` | Text lines crossed by a line that isn't their own | A line through a label hides words |
| `edge_crossings` | Pairs of flows that cross each other | Each crossing makes a flow harder to follow |
| `through_boxes` | A flow passing through a box that is neither its source nor its target | It looks connected to that box |
| `width`, `height` | The canvas | How much room the view needs |
| `a4_min_px`, `slide_min_px` | Height of the smallest text once the whole canvas is fitted to an A4 landscape page or a 16:9 slide | Whether the view stays readable on the medium it is meant for |

Text boxes are measured with each SVG's own font: D2 embeds its fonts, and
cairn's Helvetica/Arial is measured with Liberation Sans or Arial, which share
the same metrics. A text line belongs to the flow within 8 px of it (flow
labels sit on or beside their line), and that flow is not counted as crossing
it. D2 groups each connection with its label, which allows checking this rule:
`owner_agreement` is how often it matches D2's own grouping.

## Running it

On a machine with node ≥ 22.6, D2 ≥ 0.9 (TALA is bundled from v0.9.0) and
python3 with fonttools (`pip3 install fonttools`):

```sh
documentation/research/tala-benchmark/run.sh
```

It writes `results.tsv`, `results.json` and every SVG into `out/`.

## Preliminary results (no TALA yet)

These come from D2's JavaScript build, **v0.1.33, which predates TALA's
release**, so they cover dagre and ELK only. They are here to show the method
works; the published comparison should come from `run.sh` with D2 ≥ 0.9.

| | cairn | D2 + dagre | D2 + ELK |
|---|---|---|---|
| Text overlaps (total) | **0** | 2 | 12 |
| Text crossed by a line (total) | **4** | 17 | 16 |
| Flow crossings (total) | 95 | **65** | 102 |
| Flows through an unrelated box (total) | **0** | 5 | **0** |
| Canvas area (median) | **1.47 M px²** | 7.24 M px² | 5.45 M px² |
| Smallest text on A4 (median) | **5.1 px** | 4.65 px | 4.05 px |

Per view:

| View | Tool | Text overlaps | Text crossed | Flow crossings | Through boxes | Canvas | A4 min px |
|---|---|---|---|---|---|---|---|
| medium (logical, 20 flows) | cairn | 0 | 2 | 1 | 0 | 2200 × 856 | 4.8 |
| | D2 + dagre | 2 | 2 | 3 | 1 | 3787 × 1845 | 4.7 |
| | D2 + ELK | 0 | 3 | 8 | 0 | 4323 × 1220 | 4.2 |
| large (logical, 42 flows) | cairn | 0 | 2 | 80 | 0 | 3542 × 1431 | 3.0 |
| | D2 + dagre | 0 | 12 | 39 | 3 | 5109 × 3772 | 3.4 |
| | D2 + ELK | 12 | 9 | 77 | 0 | 7891 × 2858 | 2.3 |
| application-medium (15 flows) | cairn | 0 | 0 | 3 | 0 | 1570 × 549 | 7.2 |
| | D2 + dagre | 0 | 0 | 4 | 1 | 3326 × 1120 | 5.4 |
| | D2 + ELK | 0 | 1 | 3 | 0 | 3264 × 844 | 5.5 |
| application-large (27 flows) | cairn | 0 | 0 | 9 | 0 | 2418 × 639 | 4.6 |
| | D2 + dagre | 0 | 3 | 14 | 0 | 3942 × 1899 | 4.6 |
| | D2 + ELK | 0 | 1 | 10 | 0 | 4587 × 1301 | 3.9 |
| infrastructure (13 flows) | cairn | 0 | 0 | 0 | 0 | 1385 × 610 | 8.1 |
| | D2 + dagre | 0 | 0 | 3 | 0 | 2650 × 1704 | 6.8 |
| | D2 + ELK | 0 | 1 | 1 | 0 | 3628 × 1029 | 5.0 |
| infrastructure-large (20 flows) | cairn | 0 | 0 | 2 | 0 | 2083 × 674 | 5.4 |
| | D2 + dagre | 0 | 0 | 2 | 0 | 4514 × 1773 | 4.0 |
| | D2 + ELK | 0 | 1 | 3 | 0 | 5099 × 1104 | 3.5 |

What they show so far:

- On every view, cairn has no overlapping text, never more labels crossed by
  a line than D2, and the smallest canvas. Its text is the largest once fitted
  to A4 on four views, tied on a fifth.
- On the densest view (`large`, 42 flows), dagre does better than cairn: half
  as many flow crossings, and slightly larger text on A4, at the cost of a
  canvas almost four times larger and twelve labels crossed by a line.

## Limits

- **Font sizes are each tool's defaults** (about 12.5 px for cairn's element
  labels, 16 px for D2's). That is what each tool draws, but it weighs on the A4 measure.
- **cairn's canvas includes its title and legend**, which D2's doesn't have.
  That counts against cairn on size and A4 legibility.
- **The translation is a choice.** It is mechanical and uses no D2 styling or
  layout hints; a D2 author could tune `direction`, `near` or `grid` per
  diagram, as a cairn author could add hints. Improvements to `to-d2.ts` are
  welcome.
- **Six views** is a sample, not a proof; adding more is a matter of listing
  them in `run.sh`.
- **The label-ownership rule is a heuristic**: on D2's output it agrees with
  D2's own grouping 78 to 100 % of the time, so `text_crossed` can be off by a
  few lines either way.
- **TALA's default seeds**: TALA tries several seeds and keeps the best; other
  seeds may give other results.
