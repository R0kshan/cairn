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
# esbuild is a pinned devDependency (it's also the publish path — see
# scripts/build-cli.sh), so run the installed copy rather than fetching a
# floating version: one version builds every bundle, `package-lock.json` locks
# its integrity hash, and `npm audit` covers it.
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD="npx --no-install esbuild"

# Bake the version in rather than letting api.ts read package.json at runtime.
# esbuild can't tree-shake a JSON import down to the one field used, so without
# this the whole manifest — devDependencies, scripts, keywords — ends up in the
# browser bundle. With it the ternary in api.ts folds and the import is dropped.
# Same mechanism as scripts/build-binaries.sh, which passes it to `bun build`.
# The define's value is a JS expression, hence the embedded quotes.
VERSION="$(node -p "require('./package.json').version")"
DEFINE_VERSION="--define:CAIRN_BUILD_VERSION=\"$VERSION\""

echo "• building browser bundle → playground/cairn-engine.js"
$ESBUILD src/playground.ts \
  --bundle --format=esm --platform=browser --minify "$DEFINE_VERSION" \
  --outfile=playground/cairn-engine.js --log-level=warning

echo "• building node bundle    → playground/lib/engine.node.mjs"
mkdir -p playground/lib
$ESBUILD src/playground.ts \
  --bundle --format=esm --platform=node "$DEFINE_VERSION" \
  --outfile=playground/lib/engine.node.mjs --log-level=warning

echo "✓ browser: $(du -h playground/cairn-engine.js | cut -f1)  node: $(du -h playground/lib/engine.node.mjs | cut -f1)"
echo "  local static preview:  npx serve playground"
echo "  local w/ /api/svg:     cd playground && npx vercel dev"
