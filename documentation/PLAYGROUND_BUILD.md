# Playground bundles

The playground (`playground/`) ships two bundles compiled from `src/` via
[`scripts/build-playground.sh`](../scripts/build-playground.sh) (esbuild). Both
**inline `elkjs`** so they have zero runtime dependencies to install.

| File | Format | Minified | Runs in |
|---|---|---|---|
| `playground/cairn-engine.js` | ESM | yes (1.5 MB — elkjs is ~1.3 MB) | Browser (`index.html` via `<script type="module">`) |
| `playground/lib/engine.node.mjs` | ESM | no | Node / Vercel (`api/svg.mjs`) |

If you opened `cairn-engine.js` and saw a wall of mangled code: that is a build
artifact, not source. The readable source is `src/*.ts`.

## Build

```sh
npm run build:playground
```

This regenerates both bundles. It uses esbuild via `npx` — **Bun is not needed**
(Bun is only used for CLI release binaries).

## Update playground after modifying `src/`

After any change under `src/` that affects the engine:

1. Rebuild: `npm run build:playground`
2. Commit the regenerated bundles together with your source changes.

The bundles are **committed to the repo** (only `.vercel/` is git-ignored). This
is intentional — Vercel deploys the playground with **no build step**, so the
committed artifacts are what ships. Nothing rebuilds them automatically, so a
source change without a rebuild leaves the playground on stale code even though
all CLI tests pass (the test suite doesn't exercise these bundles).

**Don't read or edit the bundles by hand.** Read `src/playground-entry.ts`
(exports `compile`, `version`, `themeNames`) and the modules it imports instead.

## Local preview

```sh
npx serve playground              # static preview (browser bundle only)
cd playground && npx vercel dev   # full preview incl. the /api/svg function
```
