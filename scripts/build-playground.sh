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
# Both bundles inline elkjs, so both redistribute EPL-2.0 code. `--minify`
# strips its plain block-comment header, so the notice is attached explicitly
# (scripts/notice-banner.sh) rather than relying on upstream punctuation.
. "$(dirname "$0")/notice-banner.sh"

$ESBUILD src/playground.ts \
  --bundle --format=esm --platform=browser --minify "$DEFINE_VERSION" \
  --banner:js="$NOTICE_BANNER" \
  --legal-comments=eof \
  --outfile=playground/cairn-engine.js --log-level=warning

echo "• building node bundle    → playground/lib/engine.node.mjs"
mkdir -p playground/lib
$ESBUILD src/playground.ts \
  --bundle --format=esm --platform=node "$DEFINE_VERSION" \
  --banner:js="$NOTICE_BANNER" \
  --legal-comments=eof \
  --outfile=playground/lib/engine.node.mjs --log-level=warning

# The deployed page serves a bundle that inlines elkjs (EPL-2.0) and the Simple
# Icons artwork, so the licence texts are part of what the site distributes.
# Copied rather than symlinked: Vercel deploys this directory as static files.
echo "• copying licence texts   → playground/"
cp LICENSE THIRD-PARTY-NOTICES.md playground/
cp licenses/elkjs-EPL-2.0.md licenses/simple-icons-CC0-1.0.md playground/

echo "✓ browser: $(du -h playground/cairn-engine.js | cut -f1)  node: $(du -h playground/lib/engine.node.mjs | cut -f1)"
echo "  local static preview:  npx serve playground"
echo "  local w/ /api/svg:     cd playground && npx vercel dev"
