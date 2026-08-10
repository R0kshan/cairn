# Playground bundles

The playground (`playground/`) ships two bundles compiled from `src/` via
[`scripts/build-playground.sh`](../scripts/build-playground.sh) (esbuild). Both
**inline `elkjs`** so they have zero runtime dependencies to install.

| File | Format | Minified | Runs in |
|---|---|---|---|
| `playground/cairn-engine.js` | ESM | yes (1.5 MB — elkjs is ~1.3 MB) | Browser (`index.html` via `<script type="module">`) |
| `playground/lib/engine.node.mjs` | ESM | no | Node / Vercel (`api/svg.mjs`) |

If you opened `cairn-engine.js` and saw a wall of mangled code: that is a build
artifact, not source. The readable source is `src/*.ts` — `src/playground.ts` for
the entry, `src/compile.ts` for what `compile()` actually does, `src/api.ts` for
the exported surface.

## Build

```sh
npm run build:playground
```

This regenerates both bundles. It uses the pinned `esbuild` devDependency —
**Bun is not needed** (Bun is only used for CLI release binaries).

## Why these bundles are committed and the npm ones are not

All of them are esbuild output from `src/`, but they ship differently. Vercel
deploys the playground with **no build step**, so `playground/*` has to be in the
repo. The npm bundles — `bin/cairn.mjs` (`scripts/build-cli.sh`) and
`dist/cairn.mjs` (`scripts/build-api.sh`) — are built by `prepack` on the publish
path, so committing them would only create a second copy to go stale; both are
git-ignored.

`dist/cairn.mjs` is built from `src/playground.ts` too, so this page's entry
point is also the package's `.` export. It differs only in being unminified.

## Update playground after modifying `src/`

After any change under `src/` that affects the engine:

1. Rebuild: `npm run build:playground`
2. Commit the regenerated bundles together with your source changes.

The bundles are **committed to the repo** (only `.vercel/` is git-ignored). This
is intentional — Vercel deploys the playground with **no build step**, so the
committed artifacts are what ships. Nothing rebuilds them automatically, so a
source change without a rebuild leaves the playground on stale code even though
all CLI tests pass (the test suite doesn't exercise these bundles).

**Don't read or edit the bundles by hand.** Read `src/playground.ts`
(exports `compile`, `version`, `themeNames`) and the modules it imports instead.

## No Node globals in engine code

`--platform=browser` does not shim Node globals — `process`, `Buffer`,
`require`, `__dirname` — so if any module reachable from `src/playground.ts`
references one, esbuild bundles the bare identifier and it throws
`ReferenceError` the moment a real browser hits that code path (a Node-only
test suite never sees the gap, since Node provides the global). If you need
one, reach it through `globalThis` with optional chaining so it degrades to
`undefined` in the browser instead of throwing — see
`src/scene-layout.ts`'s `CAIRN_NO_PORT_PASS` switch for the pattern.

Two guards catch a regression here: the `playground` CI job greps the built
bundle for a bare Node-global reference, and
`tests/playground.test.ts` compiles a large example through the committed
bundle with `process` deleted from `globalThis`.

## Local preview

```sh
npx serve playground              # static preview (browser bundle only)
cd playground && npx vercel dev   # full preview incl. the /api/svg function
```
