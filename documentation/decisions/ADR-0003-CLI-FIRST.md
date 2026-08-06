# ADR-0003: CLI-first, playground deferred to post-launch

Status: **Amended** · Date: 2026-07-11 · Amended 2026-08-06

> **Amendment.** The "playground deferred to post-launch" framing is now
> historical: `playground/` ships with committed browser/node bundles and a
> Vercel serverless function (`/api/svg`), linked live from the README. The
> CLI-first *sequencing* decision below was fulfilled as written — phases 1–4
> shipped before phase 5 — this amendment records that phase 5 is no longer
> future work.

## Context

Cairn targets two user-facing interfaces:
1. **CLI** — `cairn validate`, `cairn build`, `cairn watch`, `cairn new`,
 `cairn explain` — the primary workflow for architecture authors.
2. **Browser playground** — live editor with Monaco, inline diagnostics, SVG
 preview, shareable links — the discovery and demo channel.

Building both simultaneously risks shipping nothing — the classic startup trap of breadth over depth. An explicit decision was needed on where to invest first.

The deciding factor: **the CLI validates the product concept end-to-end.** If the CLI cannot produce labeled, zero-overlap, compact architecture diagrams from the DSL, the product does not work regardless of how polished the playground is. Conversely, a well-functioning CLI with a minimal playground is launchable; a polished playground without a reliable CLI is not.

## Options considered

| Option | Rationale |
|---|---|
| **CLI-first** | Focus all phase 1–4 investment on the terminal workflow. Playground = post-launch adoption amplifier. |
| Playground-first | "Better demo" for stakeholders and initial users. |
| Both simultaneously | Maximum surface area but maximum risk — the concept goes unvalidated until both are done. |

## Decision

**Prioritise the CLI. Build it to production quality first. Defer the playground to phase 5 (post-launch).**

The playground reuses the same engine (parser, views, layout, diagnostics) bundled via esbuild — no architectural dependency, just a packaging step and a UI. The deferred timeline is:

| Phase | CLI | Playground |
|---|---|---|
| 1 (core, one type deep) | DSL parser, logical view, validate/build/new/explain | — |
| 2 (CLI DX) | watch (terminal graphics + SVG fallback + error-panel SVG), explain, exit codes | — |
| 3 (breadth) | All 4 views, templates, view format stabilized | — |
| 4 (polish & launch) | Binary builds, packaging, CI/release workflows | — |
| **5 (playground)** | — | **Browser app: Monaco + live render + inline diagnostics + share links** |

### What this means for watch mode

Two additions were planned early for `watch` (they are implemented, not deferred):

1. **Errors rendered into SVG** — on failure, emit an SVG error panel with
 codes and source excerpts instead of leaving a stale diagram. This is implemented in `watch.ts` and already shipping.
2. **`--serve` opt-in flag** — localhost hot-reload for terminals without
 graphics support. Deferred — the SVG-error-panel + editor-auto-refresh fallback covers this use case without the infrastructure cost.

## Consequences

### Positive
- All phase 1–4 effort lands in the product's core value proposition.
- The CLI ships self-contained binaries — users can install and use cairn without ever opening a browser.
- The engine is built once and shared; the playground bundles it client-side with no changes to the engine code.
- The /api/svg serverless endpoint is already functional — embedded diagram URLs work from launch day.

### Negative
- The discovery/demo surface is weaker at launch. Users must install a binary to try cairn, rather than visiting a URL.
- Some features are playground-specific (interactive clickable diagnostics, visual template gallery, "try in your browser" for README badges).

### Neutral
- The playground build infrastructure is already set up (esbuild bundling, Vercel + GitHub Pages CI workflows) — it can be activated when ready without re-engineering.
- Playground development can proceed independently by a contributor or in a later sprint — the engine API is stable.

## Links

- [Playground README](/playground/README.md) — current state (now shipping, see Status above)
- [`src/watch.ts`](/src/watch.ts) — error-panel SVG implementation
