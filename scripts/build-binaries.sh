#!/usr/bin/env bash
# Build self-contained cairn binaries for all release platforms (requires bun).
# Feasibility validated in documentation/DESIGN_BRIEF.md §2.3: elkjs runs in-process via its
# synchronous fake worker; the compiled binary needs no external dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

# VERSION is set by the release workflow from the pushed tag (GITHUB_REF_NAME),
# which is the single source of truth for release version numbers — it's what
# render-packaging.mjs, the checksums filename, and the GitHub Release all key
# off of. Falls back to package.json for local/manual builds.
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
OUT=dist
mkdir -p "$OUT"

TARGETS=(
  "bun-linux-x64:cairn-${VERSION}-linux-x64"
  "bun-linux-arm64:cairn-${VERSION}-linux-arm64"
  "bun-darwin-x64:cairn-${VERSION}-darwin-x64"
  "bun-darwin-arm64:cairn-${VERSION}-darwin-arm64"
  "bun-windows-x64:cairn-${VERSION}-windows-x64.exe"
)

for t in "${TARGETS[@]}"; do
  target="${t%%:*}"; name="${t##*:}"
  echo "→ $name"
  # CAIRN_BUILD_VERSION is baked into the binary at compile time (see the
  # `declare const` in src/cli.ts) so `cairn version` reports this exact
  # VERSION — the tag, not whatever package.json happened to say.
  # CAIRN_EMBEDS_BUN is what makes `cairn licenses` tell the truth per artifact.
  # `--compile` packages the Bun runtime into the executable, so these binaries
  # redistribute JavaScriptCore's LGPL-2.1 portions; the esbuild-built npm and
  # playground bundles do not, and must not claim to. See src/notice.ts.
  bun build --compile --minify --target="$target" \
    --define CAIRN_BUILD_VERSION="\"$VERSION\"" \
    --define CAIRN_EMBEDS_BUN="true" \
    src/cli.ts --outfile "$OUT/$name"
done

# The licence bundle is a release artifact like any other, so it is built here
# and checksummed with the binaries — install.sh verifies it against the same
# checksums file, and render-packaging.mjs reads its hash from there rather than
# recomputing one from the repo.
VERSION="$VERSION" bash scripts/build-licenses.sh

(cd "$OUT" && shasum -a 256 cairn-* > "cairn-${VERSION}-checksums.txt" 2>/dev/null || sha256sum cairn-* > "cairn-${VERSION}-checksums.txt")
echo "done — $OUT/"
