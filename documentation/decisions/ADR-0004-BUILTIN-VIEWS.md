# ADR-0004: Ship typed diagram views as built-in compiled views

## Context

Cairn's core differentiator is that it knows what kind of diagram it is rendering. General-purpose diagram tools work with generic shapes and edges; cairn's views instead define:

- **What elements are valid** per diagram type (an `actor` is not valid in an infrastructure view; a `network-zone` is not valid in a logical view).
- **How elements nest** (a `block` must be inside a `layer`, `system`, or `external`; a `server` must be inside a `network-zone` or `site`).
- **What flows must carry** (logical: label required; infrastructure: label + protocol required).
- **Visual defaults** (colors, strokes, shapes per element kind per theme).
- **Layout conventions** (actors left, externals right; zones band in declaration order; trust zones ordered by sensitivity).

The question: how should these views be defined and delivered?

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Compiled built-in views (selected)** | Zero configuration, always available, deterministic, versioned with the binary | Not extensible by users without a view mini-DSL |
| External view files (YAML/TOML) | Users can create custom views without rebuilding | Design surface for a generic extensible system before we know what users need; risk of view fragmentation |
| Lua/Python scripting for views | Maximum flexibility | Over-engineered for v0.1; performance and sandboxing complexity |
| No views (generic tool) | Simpler implementation | No differentiator — back to a generic graph tool |

## Decision

**Ship four built-in views compiled into the engine, bound to the `diagram <type>` header and the `cairn new --<type>` flags. Defer the custom-view mini-DSL to post-launch.**

The four built-in views are:

| View | CLI flag | Element kinds |
|---|---|---|
| `logical` | `-L` / `--logical-architecture` | actor-group, actor, system, layer, block, external |
| `application` | `-A` / `--application-architecture` | actor-group, actor, application, module, datastore, external |
| `infrastructure` | `-I` / `--infrastructure-architecture` | site, network-zone, server, app-instance, external |
| `security` | `-S` / `--security-architecture` | trust-zone, security-node, asset, actor-group, actor, external |

### What each view defines

1. **Valid element kinds** and their nesting rules.
2. **Flow validation rules** — which attributes are required (label: all views; protocol: infra view required, application view recommended on system flows; encryption tail: recommended on cross-zone security flows).
3. **Visual defaults per kind** — fill, stroke, text colors for `light` and
 `dark` themes.
4. **Layout partitions** — which band each kind belongs to (actors: 0, systems/applications: 1, externals: 2; or declaration-order for infra zones and security trust zones).
5. **Mandatory element attributes** — e.g. trust-zone sensitivity level (public/internal/restricted/secret) in the security view.
6. **Cross-cutting lint rules** — e.g. trust-boundary crossing without a security-node (W0560), cross-zone flow without encryption (W0561).

### What is deferred

The view mini-DSL sketched in the DESIGN_BRIEF (§3.2) — a selector-based rule language that allows extending built-in views with custom rules:

```
view acme-application extends application
  disable W0501
  severity E0203 warn
  rule E0901 error flow[!protocol] "protocol required (ACME-42 standard)"
```

This is deferred because:
- We don't yet know what extensions real users need.
- The built-in views cover the three standard French EA views plus security.
- Adding a DSL parser + rule engine for custom views is a significant investment that distracts from proving the core concept.
- The validation engine (`validate.ts`) is already generic — adding a view mini-DSL later means adding a parser for the DSL format and a compiler that generates the same `View` objects. The engin itself does not change.

## Consequences

### Positive
- Zero configuration — `cairn new -L my-file.cairn` just works.
- views are versioned with the binary — no fragmentation across installations.
- The engine is view-agnostic — community can add C4, ArchiMate, AWS views later through the same `View` interface.
- Validation rules are declarative (`NestingRule[]`, `minCounts[]`, `isolatedWarn`, `attrSpec`) rather than procedural — easy to audit and extend even without the mini-DSL.

### Negative
- Organizations with different conventions cannot customize view rules without forking or waiting for the mini-DSL.
- Adding a new built-in view requires changing `src/model.ts` (the `View` object) and adding a template to `src/cli.ts` — a code change, not a configuration change.

### Neutral
- The view mini-DSL, when built, can compile down to the same `View` interface that built-in views use — making them indistinguishable to the engine.
- The `cairn new` scaffolding generates templates that match the view — users never write the `diagram <type>` header by hand.

## Links

- [Design brief §3.2](/documentation/DESIGN_BRIEF.md#32-diagram-views-the-guidance-system) — view concept and mini-DSL sketch
- [src/model.ts](/src/model.ts) — View interface and built-in view definitions
- [src/validate.ts](/src/validate.ts) — generic validation engine driven by View objects
- [DSL_SPEC.md §1](/documentation/DSL_SPEC.md#1-structure) — element kinds per view
