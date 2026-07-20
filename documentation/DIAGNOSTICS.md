# Diagnostic codes

Every issue cairn reports carries a stable code. Codes are namespaced by severity and phase: `E01xx` = syntax, `E02xx` = view schema, `W05xx` = completeness / best-practice warnings. Gaps in numbering are reserved for future codes — a gap does not mean a code was removed.

Run `cairn explain <CODE>` for the rationale behind any rule (e.g. `cairn explain E0240`).

## JSON output (`cairn validate --format json`)

```json
{
  "file": "my-system.cairn",
  "diagnostics": [
    {
      "code": "E0203",
      "severity": "error",
      "span": { "file": "my-system.cairn", "line": 14, "col": 3, "len": 13 },
      "message": "flow without a label",
      "note": "the `logical` view forbids unlabelled arrows",
      "help": "add a label describing the exchange: `A -> B : \"…\"`",
      "fix": { "insert": " : \"…\"", "atEndOfLine": true }
    }
  ],
  "summary": { "errors": 1, "warnings": 0 }
}
```

The `span.file` field is set from the CLI argument — `cairn validate <file>`. Every diagnostic with a deterministic fix carries a `fix` entry for tooling.

## Code table

Errors block a build; warnings are printed but do not (unless `--strict` is set).

| Code | Severity | Meaning |
|---|---|---|
| E0101–E0104 | error | Syntax / style-value errors |
| E0200 / E0201 | error | Unknown diagram type / element kind (with did-you-mean) |
| E0202 | error | Duplicate identifier (flat ID namespace, shared with business objects) |
| E0203 | error | Flow without a label |
| E0210–E0218 | error | Nesting violations, per view (blocks / actors / layers / modules / servers / app-instances / network-zones / assets / security-nodes) |
| E0220 / E0221 | error | Unknown flow reference / unknown business-object reference |
| E0222 | error | Business object used outside the logical view (business objects are logical-view only) |
| E0240 | error | Infrastructure flow without a protocol (required in this view, even when the label is omitted) |
| E0250 | error | Trust zone without a valid sensitivity level (security view) |
| W0501 | warning | No actor declared (logical) |
| W0502 | warning | Element without a label (its ID is displayed as-is) |
| W0510 | warning | Isolated element (no incoming or outgoing flow) |
| W0520 | warning | Too dense for a readable slide / page — split the view |
| W0530 | warning | Business object never carried by any flow |
| W0540 | warning | Application system-to-system flow without a protocol (actor flows exempt) |
| W0560 | warning | Flow enters a more-trusted zone without a security-node (security view) |
| W0561 | warning | Cross-zone flow without stated encryption/protocol (security view) |

## Exit codes

- `0` — clean, or warnings only
- `1` — errors (or warnings with `--strict`)
- `2` — usage / file problems
