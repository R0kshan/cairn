#!/usr/bin/env bash
# Bundle the engine for the npm channel:  src/playground.ts -> dist/cairn.mjs
#
# This is what `import { compile } from "@r0kshan/cairn"` resolves to. Built from
# `playground.ts` rather than `api.ts` because `api.ts` is deliberately
# environment-neutral: it injects no ELK factory, so importing it in a browser
# would fall through to `elk-worker.ts`, Node-shaped code that has no business in
# a Vite build. `playground.ts` is the browser entry — it injects elkjs and
# re-exports `api.ts` unchanged.
#
# One bundle covers both targets. `--platform=browser` keeps Node built-ins out,
# and the result still runs under Node (verified by tests/playground.test.ts,
# which drives it with `process` deleted), so a consumer doing SSR gets the same
# module. elkjs is inlined, so the package installs zero dependencies.
#
# Run by `prepack` alongside build-cli.sh, so `npm publish` / `npm pack` always
# build a fresh bundle. dist/ is git-ignored; it is a build artifact, not source.
#
# NOT minified, on purpose: consumers bundle this themselves and their own
# minifier runs over it, and an unminified dependency is far easier to debug
# through. (dbarzin asked for exactly this in issue #38.)
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist/cairn.mjs
mkdir -p dist

# Same version define as build-cli.sh and build-binaries.sh — it keeps the whole
# package.json manifest out of the bundle. See src/api.ts for why.
VERSION="$(node -p "require('./package.json').version")"

npx --no-install esbuild src/playground.ts \
  --bundle --format=esm --platform=browser \
  --define:CAIRN_BUILD_VERSION="\"$VERSION\"" \
  --log-level=warning \
  --outfile="$OUT"

echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
