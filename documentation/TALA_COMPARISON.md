# cairn and TALA

[TALA](https://d2lang.com/tour/tala/) is a layout engine built by the makers of
[D2](https://d2lang.com) for software architecture diagrams. It is one of the
engines D2 can use to place the shapes and connections of a diagram. cairn
shares its goal of readable architecture diagrams generated from text, but
takes a different route: instead of a general layout for any diagram, it is a
language for the three views of an architecture document.

## Why cairn was made

cairn started from architecture documents whose logical, application and
infrastructure views were drawn by hand. Moving them to diagram as code had
proven hard: other notations made it difficult to keep the information those
views carry, and with many flows the generated diagrams became very large or
had overlapping labels.

When cairn's layout engine was chosen, in July 2026, TALA was evaluated and
ruled out: it was then closed-source, required a paid license for commercial
use, and was not deterministic by design, while cairn needed an engine it could
extend and that always gives the same output. cairn chose ELK and built its own
passes on top. TALA has since become open source.

## Two different jobs

| | TALA | cairn |
|---|---|---|
| **What it is** | A layout engine for D2 | A language, its validator and its renderer |
| **What it receives** | Any D2 diagram, in the notation you choose | One of three typed views: [`logical`](DSL_SPEC.md#11-logical-view--diagram-logical), [`application`](DSL_SPEC.md#12-application-view--diagram-application), [`infrastructure`](DSL_SPEC.md#13-infrastructure-view--diagram-infrastructure) |
| **What it decides** | Where shapes, connections and labels go | What each view may contain, where each kind of element goes, and what the document needs next to the diagram |

A layout engine's job is to arrange what it is given, and TALA does that for
any architecture diagram, in any style. cairn's job is the architecture
document itself, which is why it can do things that sit outside a layout
engine.

## What cairn adds

- **Views that know what they describe.** The logical view describes what the
  system does: actors, functional blocks, business objects. The application
  view describes applications and how they exchange. The infrastructure view
  describes sites, network zones, servers and what crosses them. Each one
  accepts its own element kinds and its own rules.
- **Rules checked at every edit.** A server must sit in a network zone, a site
  or a cluster; a logical flow needs a label; an infrastructure flow needs its
  protocol. `cairn validate --strict` reports each break with a code and its
  position, in an editor, a pre-commit hook or CI, and in JSON for tools and
  AI agents ([Diagnostics](DIAGNOSTICS.md)).
- **A flow matrix from the same file.** Each view exports its
  [flow matrix](DSL_SPEC.md#3-flow-matrix), the *matrice des flux techniques* of
  French dossiers, in CSV, Markdown or SVG. It can't drift from the diagram,
  and neither can the legend or the business objects.
- **A layout that follows the view.** Each view places its elements in fixed
  bands (actors, then the system, then externals; or the network zones in
  order), so successive versions of a document keep the same reading order.
  With a given cairn version, the same file always gives the same SVG, byte for
  byte, so a diff shows only real changes.
- **Views sized for their page.** `style { disposition: slide }` or
  `{ disposition: page }` fits a view to a 16:9 slide or an A4 page, reports
  the label size it reaches, and warns when the view should be split.
- **Adjustments that survive edits.** Manual placement is written in the
  `.cairn` file as an offset from the computed layout, by hand or by dragging
  in the playground, so it keeps working when the rest of the view changes,
  and cairn warns if an adjustment causes an overlap.
- **French or English output** for band titles, legend and matrix headers, with
  `style { lang: fr }`.

## When to prefer each

**D2 with TALA** suits you when you want a high-quality automatic layout for
any kind of diagram, your own notation and styles, and D2's wider language:
other diagram types, multi-board compositions and many export formats.

**cairn** suits you when:

- your document needs logical, application and infrastructure views;
- you maintain that document over time, and want its views reviewed, checked
  and rebuilt like code;
- you need a flow matrix that stays in step with each view;
- your views carry many flows and labelled exchanges on one page.
