#!/usr/bin/env bash
# Bundle the engine for the npm package (`@r0kshan/cairn`). Produces three
# artifacts from the single TypeScript entry `src/api.ts`:
#
#   lib/index.browser.js    browser ESM, unminified  (bundlers: Vite, esbuild, …)
#   lib/index.node.mjs      node ESM
#   lib/types/src/api.d.ts  type declarations (+ the tree they reference)
#
# elkjs is inlined into both bundles, so an engine-only consumer installs
# nothing at runtime. Unminified on purpose: consumers minify themselves, and a
# readable bundle is auditable (issue #38).
#
# `lib/` is NOT committed — unlike playground/, which is committed only because
# Vercel deploys it with no build step. This runs via `prepack` on publish and
# via the `package` CI job on every PR.
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD="node_modules/.bin/esbuild"

rm -rf lib

echo "• building browser bundle → lib/index.browser.js"
$ESBUILD src/api.ts \
  --bundle --format=esm --platform=browser \
  --outfile=lib/index.browser.js --log-level=warning

echo "• building node bundle    → lib/index.node.mjs"
$ESBUILD src/api.ts \
  --bundle --format=esm --platform=node \
  --outfile=lib/index.node.mjs --log-level=warning

echo "• emitting declarations   → lib/types/"
node_modules/.bin/tsc -p tsconfig.types.json

# This repo imports with explicit `.ts` extensions (no build step — see
# CONTRIBUTING.md). TypeScript carries those specifiers straight into the
# emitted .d.ts, where a consumer cannot resolve them: `allowImportingTsExtensions`
# is ours, not theirs. `rewriteRelativeImportExtensions` only rewrites emitted
# JavaScript, and we emit none. So rewrite relative `.ts` specifiers to `.js`,
# which TypeScript resolves to the sibling `.d.ts` by its normal rules.
echo "• rewriting .ts specifiers in declarations"
node scripts/rewrite-dts-extensions.mjs lib/types

echo "✓ browser: $(du -h lib/index.browser.js | cut -f1)  node: $(du -h lib/index.node.mjs | cut -f1)"
