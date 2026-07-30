# Non-negotiable invariants

These invariants must never be broken. Every change is verified against them.

## 1. Zero label overlaps

Every example builds with `label overlaps: 0` (CI-gated).

## 2. Byte-deterministic output

Same input → identical SVG across runs and platforms. Only `+ - * /`, `round`,
`ceil`, and one normalized `Math.hypot` are allowed in the output path. Never
introduce `Date.now()`, randomness, or locale-formatted numbers.

## 3. Readability is gated by `npm run sweep`

Sweeps every `.cairn` fixture × every disposition. Six invariants must stay at
**0**: label overlaps, segments off orthogonal, runs crossing a leaf box, dead
horizontal bands, coincident segments, shared attachment points. The rest
(staircases, tight attachments, near-parallel runs, long detours) are a
**ratchet** — expressed as a rate per swept flow-instance (not a raw count) so
adding fixtures doesn't spuriously fail the gate. Current rates are ceilings
that may only fall. Lower a rate when a change earns it; never raise one to go
green.

## 4. Flow labels

Flow labels are **required** on logical view (`E0203`), optional on
application & infrastructure. Infrastructure flows must still carry
`protocol/port` (`(HTTPS/443)` — `E0240`) even when unlabelled.

## 5. Security

All user text is escaped before SVG emission (`esc()` / `escAttr()`). Reserved
keys (`__proto__`, `constructor`, `prototype`) are rejected at parse time.
Every security fix ships with its exploit as a regression test.

## 6. Diagnostics are coded, never thrown

Errors `E0xxx`, warnings `W0xxx`, each with a `span` + `help`; rationale in
`explanations` (via `cairn explain`). A user error is a `Diagnostic`, not an
exception.

## 7. Nesting rules

Element kinds are per-view (`views` registry). Nesting rules are enforced per
view (`E0210–E0218`). Business objects are logical-view only (`E0222`
elsewhere). Duplicate IDs are rejected (`E0202`). Dangling flow references are
rejected (`E0220`).

## 8. Every flow is a distinct edge

Flows are never visually merged. Each declared flow corresponds to exactly one
scene edge with its own label and arrow.

## 9. Layout reading order

For `wide`/`slide` dispositions, actor-group elements (user-facing sources) are
placed on the left; external systems stay on the right. For `tall`/`page`
dispositions, they go on the top and bottom respectively. The infrastructure
view models users as actors (person glyph) on the entry side.

## 10. Slide / page orientation

`slide` must be landscape (width ≥ height). `page` must be portrait (height ≥
width). These are hard layout constraints.

## 11. Backward flow rerouting

Backward hierarchical edges that cross container boundaries must be rerouted
through dedicated top/bottom channels, not left as elk's native wrap-around
detours. Rerouting applies to every disposition. Deterministic: no-op
(byte-identical scene) when nothing qualifies.

## 12. Element kind validity per view

Element kinds are restricted by view. Examples: `queue` is valid only in
application & infrastructure; `gateway`, `auth`, `idp` only in infrastructure;
`trust-zone`, `security-node`, `asset` only in security; `datastore` renders as
cylinder; business objects are logical-view only. Unknown element kinds for the
active view are rejected (`E0201`).

## 13. `cairn new` must not overwrite files

The `new` command uses `O_CREAT|O_EXCL` (`wx` flag) for atomic exclusive
creation. It exits with code 2 if the target file already exists, leaving the
existing file untouched.

## 14. Snapshot & corpus gates

`npm test` includes three regression layers against committed reference files:
structural digest (geom/color/text per example), example-SVG fidelity
(committed `examples/*.svg` stay in sync), and detailed snapshots (one per
view + themes + matrix exports). All snapshots are normalized to 1dp to absorb
cross-platform floating-point variation. Never regenerate to silence a diff you
don't understand.

## 15. Flow matrix export invariants

The matrix (csv/md/svg) splits protocol from port, annotates each endpoint with
its network zone (infrastructure), and localises headers via `style { lang: fr
}`. Matrix output is byte-deterministic like SVG.
