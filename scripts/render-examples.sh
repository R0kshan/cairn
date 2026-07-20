#!/usr/bin/env bash
# Regenerate every committed artifact under examples/ from its .cairn source:
#   - <name>.svg          for each diagram          (cairn build)
#   - <name>.flow.<fmt>   matrix companions, where one already exists (cairn matrix)
#
# PNGs are left untouched (the CLI emits SVG; PNGs are exported separately).
# Output is byte-deterministic, so this is safe to run any time. It also warns
# if any diagram fails the zero-overlap invariant.
#
# Usage: npm run examples   (or: bash scripts/render-examples.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
CAIRN="node --experimental-strip-types src/cli.ts"

echo "• rebuilding diagram SVGs…"
n=0 warn=0
for f in examples/*.cairn examples/dispositions/*.cairn examples/themes/*.cairn; do
  case "$f" in *broken*) continue;; esac
  out=$($CAIRN build "$f" -o "${f%.cairn}.svg")
  echo "$out" | grep -q "label overlaps: 0" || { echo "  ⚠ overlaps in $f — $out"; warn=$((warn + 1)); }
  n=$((n + 1))
done
echo "  ✓ $n diagrams${warn:+, $warn with overlaps}"

echo "• rebuilding matrix companions…"
m=0
shopt -s nullglob
for flow in examples/*.flow.*; do
  fmt="${flow##*.}"                 # csv | md | svg
  src="${flow%.flow.*}.cairn"       # examples/infrastructure.flow.csv -> examples/infrastructure.cairn
  [ -f "$src" ] || { echo "  ! no source for $flow — skipped"; continue; }
  $CAIRN matrix "$src" --format "$fmt" -o "$flow" >/dev/null
  m=$((m + 1))
done
echo "  ✓ $m matrix files"

[ "${warn:-0}" -eq 0 ] && echo "✓ examples regenerated" || { echo "✗ $warn diagram(s) have label overlaps — fix before committing"; exit 1; }
