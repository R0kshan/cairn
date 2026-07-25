# Playground build & bundles

The `playground/` folder ships a browser playground and a Vercel serverless
renderer. Both run the **same engine as the CLI**, compiled from `src/` into two
bundles. This document explains what those bundles are, why `cairn-engine.js`
looks minified, why the Node bundle is a `.mjs` file, and how to regenerate them.

If you are reading this because you opened `playground/cairn-engine.js` and found
a 1.5 MB wall of mangled code: that file is a build **artifact**, not source. It
is not meant to be read or edited by hand. The readable source is `src/*.ts`.

## Artifacts at a glance

| File | Format | Minified | Built for | Consumed by |
|---|---|---|---|---|
| `playground/cairn-engine.js` | browser ESM | **yes** | the browser | `index.html` via `<script type="module">` |
| `playground/lib/engine.node.mjs` | Node ESM | no | Node (serverless) | `api/svg.mjs` (Vercel function) |

Both are produced from a single entry point, `src/playground-entry.ts`, by
`scripts/build-playground.sh` (esbuild). `elkjs` — the only runtime dependency —
is **inlined** into each bundle, so the deployed playground and the serverless
function have zero dependencies to install.

## Why `cairn-engine.js` is minified and unreadable

`cairn-engine.js` is the browser bundle. It is downloaded by every visitor to the
playground, so it is built with esbuild's `--minify` flag: whitespace stripped,
identifiers shortened (`Object.create` → `oLn`, etc.). That is why it opens with
`var oLn=Object.create;var ffn=Object.defineProperty;…` and weighs ~1.5 MB — the
bulk of the size is the inlined `elkjs` layout engine, not cairn's own code.

Minification is a size/latency optimisation for the client, nothing more. The
logic is identical to `src/`; only the presentation is mangled.

The Node bundle, `playground/lib/engine.node.mjs`, is built from the **same
source with the same inlining but *without* `--minify`**, because it runs
server-side where download size does not matter. If you want to skim the bundled
engine in a readable form, open that file — its identifiers are intact
(`var __create = Object.create;…`).

## Why the Node bundle is a `.mjs` file

Both bundles are ES modules (esbuild `--format=esm`). The extensions differ by
consumer:

- **`cairn-engine.js` keeps `.js`** — it is loaded in the browser via
  `import { compile } from './cairn-engine.js'` inside a `<script type="module">`.
  In the browser the extension carries no meaning; the `type="module"` attribute
  is what makes it ESM.
- **`engine.node.mjs` uses `.mjs`** — the `.mjs` extension makes Node (and
  Vercel's function runtime) treat the file as an ES module unambiguously, per
  file, regardless of package resolution. It also matches the function that
  imports it, `api/svg.mjs`.

`playground/package.json` does set `"type": "module"`, so in principle a plain
`.js` would also be treated as ESM here. `.mjs` is kept deliberately because
Vercel bundles each serverless function independently at deploy time, and a
per-file `.mjs` guarantee does not depend on which `package.json` happens to be
resolved in that context. It is a robustness choice, not a different or
lower-quality format.

## How to (re)build the bundles

```sh
npm run build:playground     # runs scripts/build-playground.sh
```

This regenerates both `cairn-engine.js` and `lib/engine.node.mjs`. It uses
esbuild via `npx`, so **Bun is not required** (Bun is only used for the CLI
release binaries — see [ADR-0002](./decisions/ADR-0002-TYPESCRIPT-STACK.md)).

Local preview:

```sh
npx serve playground              # static preview (browser bundle only)
cd playground && npx vercel dev   # full preview incl. the /api/svg function
```

## The bundles are committed — keep them in sync

The two bundles are **checked into the repo** (only `.vercel/` is git-ignored).
This is intentional: Vercel deploys the playground as static files plus a
serverless function with **no build step**, so the committed artifacts are what
ships.

The trade-off is that the bundles can silently drift out of sync with `src/`.
Because nothing rebuilds them automatically, a change to the engine that is not
followed by `npm run build:playground` leaves the playground running stale code
even though every CLI test passes (the Node-only test suite does not exercise
these bundles).

**Therefore: after any change under `src/` that affects the engine, rerun
`npm run build:playground` and commit the regenerated bundles in the same
change.** Review them as generated output, not as source.

> If tracking a 1.5 MB minified blob in git becomes undesirable, the alternative
> is to git-ignore both bundles and build them in CI / on Vercel instead. That
> removes the drift risk at the cost of a build step in the deploy path.

## Where to read the real engine

Do not reverse-engineer the bundles. The un-minified, authoritative source is:

- `src/playground-entry.ts` — the browser/serverless entry point (exports
  `compile`, `version`, `themeNames`)
- the modules it imports: `parse.ts` → `validate.ts` → `layout.ts` →
  `render.ts`, plus `model.ts` (types, views, themes)

## Links

- [`scripts/build-playground.sh`](../scripts/build-playground.sh) — the build commands
- [ADR-0002 — TypeScript stack & Bun binaries](./decisions/ADR-0002-TYPESCRIPT-STACK.md) — why the CLI and playground share one engine
- [`playground/README.md`](../playground/README.md) — playground overview and deployment
