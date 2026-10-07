# cairn

Diagram-as-code for enterprise-architecture views — `logical`, `application`,
`infrastructure` — rendered to SVG, with a flow matrix export per view.
Dense diagrams that stay readable: overlap-free labels, typed views,
deterministic output.

Try it without installing: [playground](https://cairn-psi-five.vercel.app/).

## Preview

Each image is rendered by the cairn CLI from a `.cairn` source in
[`examples/`](https://github.com/R0kshan/cairn/tree/main/examples).

### Logical view

![Small logical view](examples/small.svg)

### Application view

![Small application view](examples/application-small.svg)

### Infrastructure view

![Small infrastructure view](examples/infrastructure-small.svg)

Its flow matrix, from `cairn matrix examples/infrastructure-small.cairn --format svg`:

![Flow matrix of the infrastructure view](examples/infrastructure-small.flow.svg)

## Install

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/R0kshan/cairn/main/packaging/install.sh | sh
brew install R0kshan/tap/cairn

# Windows
scoop bucket add cairn https://github.com/R0kshan/scoop-bucket
scoop install cairn
```

## Commands

```text
cairn new (-L|-A|-I) <file.cairn>          scaffold a logical / application / infrastructure template
cairn validate <file.cairn> [--format json] [--strict]
cairn build <file.cairn> [-o output.svg] [--theme <name|file.json>]
cairn matrix <file.cairn> [--format csv|md|svg] [-o out] [--theme <name|file.json>]
cairn watch <file.cairn> [-o output.svg] [--theme <name|file.json>]
cairn explain <code>                       rule rationale (e.g. E0203)
cairn logos                                list the built-in `logo:` names
cairn themes                               list the built-in theme names
cairn version [--licenses]
```

## First diagram

```sh
cairn new -L my-system.cairn
cairn build my-system.cairn
```

Then read the [DSL reference](DSL_SPEC.md). Every error and warning code is in
[Diagnostics](DIAGNOSTICS.md).
