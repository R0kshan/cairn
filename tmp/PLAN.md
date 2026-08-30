# Plan — Issue #23: distinct visuals for auth, gateway/proxy and firewall (infrastructure view)

## Problem

The infrastructure view cannot express a firewall at all, and three of the
kinds it does have are hard to tell apart at a glance:

| Kind | Today's shape | Today's colour |
|---|---|---|
| `gateway` | rounded rect + chevron glyph, top-left | orange-brown (theme accent `auth` / `authF`) |
| `auth` | rounded rect + padlock glyph, top-left | orange (theme accent `node` / `nodeF`, shared with the security view's `security-node`) |
| `idp` | rounded rect, **no glyph** — identical to any plain box | teal |
| firewall | *does not exist* | — |

Two independent causes:

1. **Colour collision.** `gateway` and `auth` sit in the same orange hue family
   in every theme, so colour carries no information between them.
2. **Missing glyph.** `idp` renders exactly like `server`, `app-instance` or any
   other default box.

A third, pre-existing defect surfaces once glyphs matter: node width is measured
from the label only (`scene-layout.ts:206-216`), while the renderer hard-shifts
the label by `+10` to dodge the glyph (`svg-render.ts:424`, `:441`). A long
label therefore overlaps its own glyph.

## Decisions taken with the maintainer

| Question | Decision |
|---|---|
| Firewall | New `firewall` kind in the infrastructure view |
| Nesting | Free placement — no nesting rule, like `gateway` / `auth` / `idp` |
| Validation | Isolated-element warning only (add to the existing `W0510` kind list) |
| Visual language | Icon glyph inside the rounded rect — no new silhouettes |
| Glyph set | `auth` = padlock, `gateway` = two arrows through gate posts, `idp` = ID badge with head, `firewall` = brick wall |
| Glyph scope | Redraw all four as one family (same 18x18 box, stroke weight and inset) |
| Colours | `firewall` red, `auth` blue, `gateway` keeps orange, `idp` keeps teal |
| Legend | Per-kind key: the legend swatch draws the kind's real shape, in every view |
| Node sizing | Reserve a glyph gutter in the measured node width |
| Examples | New `examples/infrastructure-security-edge.cairn`; do not add a firewall to the existing examples |

Note on "leave existing examples alone": the existing infrastructure examples
keep their current *content*, but their rendered SVGs still change — the glyph
redraw, the `auth` recolour, the legend keys and the sizing gutter all touch
them. Every view's SVG changes, because the legend key is view-agnostic.

## Constraints this plan must respect

- **INVARIANTS §14 (DSL-agnostic layout).** No positioning pass may read
  `kind`. Only `svg-render.ts` picks a shape from `kind`, and
  `tests/dsl-agnostic.test.ts` fails if a kind name leaks into
  `route-detour.ts`, `edge-tidy.ts` or `compact.ts`. The sizing gutter is the
  one risk here — see Phase 1.
- **INVARIANTS §12 (kind validity per view).** A new kind is one registry
  entry in `views.ts`; the validator reads the registry, never a hardcoded list.
- **Determinism budget (ARCHITECTURE §6).** Glyph geometry uses only
  `+ - * /`, `Math.round`, `Math.ceil`. No trig, no floats from measurement.
- **Zero label overlaps.** `scripts/sweep.ts` gates it; the gutter must not
  introduce a new overlap anywhere in the corpus.

## Phase 1 — Glyph gutter in node sizing

*Goal: make room for a glyph before drawing new ones, so the later phases can
be attributed cleanly.*

- `src/scene-layout.ts` — node width for a glyph-bearing kind adds a fixed
  gutter to the measured label width, replacing the renderer's `+10` shift.
- **§14 check:** `scene-layout.ts` already reads `element.kind` (it partitions
  by kind through the registry), so this stays legal — but the gutter must be
  driven by a registry field, not a `kind === "auth"` test. Add
  `glyphKinds: string[]` (or a per-kind `glyph` marker) to the `View`
  interface in `views.ts`, and have the layout read it from the active view.
- `src/svg-render.ts` — label x offset derives from the same gutter constant
  instead of the hardcoded `+10`.

**Verify:** `npm test` (sweep ratchets + corpus), `npm run snapshots:report` to
confirm the only geometry changes are the widths of `gateway` / `auth` / `idp`
nodes and their downstream layout, `npm run typecheck`, `npm run lint`.
Re-baseline with `npm run snapshots` in the same commit.

## Phase 2 — Glyph family for the four kinds

- `src/svg-render.ts` — one shared glyph helper (position, box, stroke weight),
  then four glyph paths: padlock (`auth`), gate arrows (`gateway`), ID badge
  (`idp`), brick wall (`firewall`, unused until Phase 3 lands the kind).
- `renderIdp` stops being a copy of `renderPlainBox`.
- The four renderers collapse into one `renderGlyphBox(node, style, lines,
  glyph)` — clean-code rule against four near-identical functions.

**Verify:** as Phase 1, plus visual inspection of the rendered examples at
100 % and at slide scale.

## Phase 3 — The `firewall` kind

- `src/views.ts` — add `firewall` to `infrastructureView.kinds`,
  `legendNames` (`"Firewall"`) / `legendNamesFr` (`"Pare-feu"`),
  `isolatedWarn.kinds`, `defaults` and `defaultsDark` (the `classic` /
  `classic-dark` themes read these directly).
- `src/themes.ts` — `KIND_ROLE_MAP.firewall = "firewall"`, a `firewall` role in
  `buildTheme`, and a red accent pair (`fw` / `fwF`) in all 7 theme specs.
- `src/svg-render.ts` — dispatch `firewall` to the brick-wall glyph.
- No parser change: kinds are data, the parser is generic.

**Verify:** a scratch `.cairn` outside the repo exercising `firewall` in every
theme; `npm test`; check `E0201` suggests `firewall` on a typo, and that
`W0510` fires for a firewall with no flows.

## Phase 4 — Colour tuning

- `src/themes.ts` — `auth` role moves off the shared `node` / `nodeF` accent to
  its own blue pair in all 7 themes. `gateway` keeps `auth` / `authF`.
  (The accent key names are already confusing — role `authGateway` reads accent
  `auth`. Renaming them touches all 7 theme blocks for no behaviour change, so
  it is deliberately **not** in scope; a comment records the mapping instead.)
- `src/views.ts` — matching `auth` and `firewall` entries in `defaults` /
  `defaultsDark`.
- Contrast check: every new fill/stroke pair against its theme background, in
  all 7 themes plus `classic` / `classic-dark`.

**Verify:** `npm run snapshots:report` — changes here must show up as
**colour-only** in the corpus digest. Any geometry delta in this phase is a bug.

## Phase 5 — Legend per-kind keys

- `src/svg-render.ts` `renderLegendBand` — the swatch calls the same glyph
  helper as the node renderer instead of always drawing a plain rect, so the
  legend key and the node cannot drift apart. `actor` keeps its existing
  special case; kinds with no glyph keep the plain rect.
- Legend width bookkeeping (`lx` advance, wrap at `scene.width - 220`) stays
  correct with the wider swatches.

**Verify:** legend band renders without overlap in the densest examples
(`large`, `application-large`, `infrastructure`) and in `fr`; `npm test`.

## Phase 6 — Example and documentation

- `examples/infrastructure-security-edge.cairn` — firewall, gateway, auth and
  idp side by side at a zone edge. Auto-discovered by `scripts/render-examples.mjs`,
  `tests/corpus.ts` and `scripts/sweep.ts`; no registration needed.
- `documentation/DSL_SPEC.md:26` — kind table row for `infrastructure`
  (currently claims "gateway (shield hexagon), auth (lock badge), idp") and
  `:37` nesting-convention row.
- `documentation/INVARIANTS.md:561` — the per-view kind list.
- `README.md` — if it enumerates infrastructure kinds.
- `THIRD-PARTY-NOTICES.md` — unaffected (no new dependency).

**Verify:** full gate — `npm test`, `npm run typecheck`, `npm run lint`,
`npm run examples`, `npm run snapshots`. `npm run test:binary` and
`npm run test:npm` are not required: no bundling or packaging surface changes.

## Risks

| Risk | Mitigation |
|---|---|
| Gutter widens nodes enough to push a diagram past a disposition's page fit | Phase 1 is isolated; `snapshots:report` shows per-example geometry deltas, and the slide/page candidate layouts re-run automatically |
| Sweep readability ratchets move | Expected in Phase 1 only. If they worsen, narrow the gutter rather than raising the ceiling (methodology: narrow scope, don't weaken thresholds) |
| A glyph reads as noise at slide scale | Glyphs are stroke-only in the kind's stroke colour, at a fixed size — they do not scale down with the node |
| Red for `firewall` collides with the security view's `untrusted` red | Different views; `firewall` is a leaf, `untrusted` a dashed container |

## Commit shape

One commit per phase, each with a passing `npm test` and its re-baselined
references in the same commit (methodology: intent cannot be inferred from a
diff, so the baseline moves with the change that caused it).
