#!/usr/bin/env bash
# Bundle the CLI for the npm channel:  src/cli-npm.ts -> bin/cairn.mjs
#
# Why a bundle at all: Node refuses to strip types for files under node_modules
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so an installed package cannot
# run `src/cli.ts` the way `bin/cairn.js` does from a checkout. The published
# package therefore ships plain JavaScript with elkjs inlined — no runtime deps.
#
# Run by `prepack`, so `npm publish` / `npm pack` always build a fresh bundle.
# bin/cairn.mjs is git-ignored; it is a build artifact, not source.
#
# NOT minified, on purpose: this is what users get a stack trace from, and the
# tarball difference after gzip is small. (The Bun release binaries are minified
# — they're opaque either way.)
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=bin/cairn.mjs

# Expect one unresolved `import(modulePath)` to survive in the output: it is
# elk-engine.ts's lazy fallback, which esbuild can't statically resolve (see
# src/cli-npm.ts). It is dead code here — cli-npm.ts injects the factory before
# anything can reach that branch — and smoke-npm.sh proves it by rendering a
# real diagram through the installed CLI.
# Bake the version in, exactly as build-binaries.sh does for the Bun binaries.
# Two reasons: the release job runs `npm version` from the tag before packing, so
# this captures the version actually being published; and it keeps package.json
# out of the bundle — esbuild can't tree-shake a JSON import down to one field,
# so without the define the whole manifest rides along. The define's value is a
# JS expression, hence the embedded quotes.
VERSION="$(node -p "require('./package.json').version")"

# The bundle inlines elkjs, so it redistributes EPL-2.0 code: the banner carries
# the notice (scripts/notice-banner.sh) behind the shebang, which must stay the
# very first line. See THIRD-PARTY-NOTICES.md.
. "$(dirname "$0")/notice-banner.sh"

npx --no-install esbuild src/cli-npm.ts \
  --bundle --format=esm --platform=node \
  --define:CAIRN_BUILD_VERSION="\"$VERSION\"" \
  --banner:js="#!/usr/bin/env node
$NOTICE_BANNER" \
  --legal-comments=eof \
  --log-level=warning \
  --outfile="$OUT"

chmod +x "$OUT"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
