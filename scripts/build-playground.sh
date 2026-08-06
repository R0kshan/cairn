#!/usr/bin/env bash
# Bundle the engine for the playground. Produces two artifacts from the single
# TypeScript source in src/:
#
#   playground/cairn-engine.js      browser ESM, minified  (client-side render)
#   playground/lib/engine.node.mjs  node ESM               (serverless /api/svg)
#
# Uses esbuild so no bun is required. elkjs is inlined into both bundles, so the
# Vercel function has zero runtime dependencies.
#
# esbuild is a pinned devDependency rather than an `npx` fetch: the same binary
# builds the published npm bundles (scripts/build-package.sh), so it belongs in
# package-lock.json where its integrity hash is verified and `npm audit` sees it.
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD="node_modules/.bin/esbuild"

echo "• building browser bundle → playground/cairn-engine.js"
$ESBUILD src/playground.ts \
  --bundle --format=esm --platform=browser --minify \
  --outfile=playground/cairn-engine.js --log-level=warning

echo "• building node bundle    → playground/lib/engine.node.mjs"
mkdir -p playground/lib
$ESBUILD src/playground.ts \
  --bundle --format=esm --platform=node \
  --outfile=playground/lib/engine.node.mjs --log-level=warning

echo "✓ browser: $(du -h playground/cairn-engine.js | cut -f1)  node: $(du -h playground/lib/engine.node.mjs | cut -f1)"
echo "  note: the npm package bundles are separate — npm run build:package"
echo "  local static preview:  npx serve playground"
echo "  local w/ /api/svg:     cd playground && npx vercel dev"
