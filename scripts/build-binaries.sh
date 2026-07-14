#!/usr/bin/env bash
# Build self-contained cairn binaries for all release platforms (requires bun).
# Feasibility validated in documentation/DESIGN_BRIEF.md §2.3: elkjs runs in-process via its
# synchronous fake worker; the compiled binary needs no external dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
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
  bun build --compile --minify --target="$target" src/cli.ts --outfile "$OUT/$name"
done

(cd "$OUT" && shasum -a 256 cairn-* > "cairn-${VERSION}-checksums.txt" 2>/dev/null || sha256sum cairn-* > "cairn-${VERSION}-checksums.txt")
echo "done — $OUT/"
