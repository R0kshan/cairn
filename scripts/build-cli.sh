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
npx --no-install esbuild src/cli-npm.ts \
  --bundle --format=esm --platform=node \
  --banner:js='#!/usr/bin/env node' \
  --log-level=warning \
  --outfile="$OUT"

chmod +x "$OUT"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
