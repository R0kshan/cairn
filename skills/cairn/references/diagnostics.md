# Diagnostics — the common ones and how to fix them

Run `cairn explain <CODE>` for the rationale of any code. Full catalogue:
`documentation/DIAGNOSTICS.md`. `E01xx` syntax, `E02xx` view rules, `W05xx`
warnings. Errors block the build; `--strict` makes warnings fail too.

| Code | Means | Fix |
|---|---|---|
| E0101 | Syntax error | Usually `A->B` without spaces, an unclosed `{` or `"`, or a tail in the wrong place. Write `A -> B "label" (TECH) [BO] { … }` in that order. `A->B` also reports a misleading E0202 on the same line: fix the spacing first. |
| E0104 | Unknown style key / value | Use only the keys in `references/dsl.md`; inline blocks accept `fill`, `stroke`, `text`, `label` (+ flow-only `label-offset`, `segment-offset`, `flow-label-wrap`). |
| E0107 | Unknown logo name | Pick one from `cairn logos` (the message suggests the nearest). |
| E0108 | `logo:` on a kind that takes none | Logos only on `application`, `module`, `queue`, `datastore`, `external`, in the application view. Remove it. |
| E0200 / E0201 | Unknown view / kind | Use a kind from the view's list; the message suggests the nearest. Infrastructure has no `actor-group`; logical has no `application`. |
| E0202 | Duplicate ID | IDs are flat across the file, business objects included. Rename one. |
| E0203 | Logical flow without a label | Add a verb phrase: `A -> B "Sends invoice"`. |
| E0210 | `block` misplaced | Put it in a `layer`, `system` or `external`. |
| E0211 | `actor` outside an `actor-group` | Wrap it (logical, application). In infrastructure, `actor` is at the root instead. |
| E0212 | `layer` outside a `system` | Move it into the `system`. |
| E0213 | `module` outside an `application` | Move it into its `application`. |
| E0214 | `server` misplaced | Put it in a `network-zone`, `site` or `cluster`. |
| E0215 | `app-instance` misplaced | Put it in a `server`, `network-zone` or `cluster`. |
| E0216 | `network-zone` misplaced | Put it in a `site` or another zone. |
| E0217 | `cluster` misplaced | Put it in a `network-zone` or `site`. |
| E0220 | Flow references an unknown ID | Typo, or the element is not declared in this file (there are no imports). |
| E0221 | Unknown business object | Declare it: `business-object BO_X "Name" "description"`. |
| E0222 | Business object outside the logical view | Remove the `[BO]`; in application/infrastructure the tail carries the format. |
| E0240 | Infrastructure flow without a protocol | Add `(PROTOCOL/PORT)`: `(HTTPS/443)`. |
| W0501 | Logical view with no actor | Add the `actor-group` / `actor` the system serves. |
| W0502 | Element without a label | Add a quoted label. |
| W0510 | Element no flow reaches | Connect it, or remove it if it isn't part of this view. |
| W0520 | Too dense for the slide / page | Split the view, or `flow-text: numbered`; see density in `modeling.md`. |
| W0530 | Business object no flow carries | Attach it to the flow(s) carrying it, or remove it. |
| W0540 | Application flow between non-actors with no tail | Add `(PROTOCOL, FORMAT)`: `(API_REST, JSON)`, `(JDBC)`, `(MQ, JSON)`. |
| W0570 | A side pin the layout could not honour | Remove the `.side`, or pin the other end instead. |
| W0572 | A pixel hint made things overlap | Reduce or remove that `offset:` / `label-offset:` / `size:`. |

The JSON output (`cairn validate --format json`) gives each diagnostic a
`span` (line, column) and, when the fix is deterministic, a `fix` object
(`insert`, `atEndOfLine`) you can apply directly.
