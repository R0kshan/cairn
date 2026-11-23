#!/bin/sh
# Render the benchmark views with cairn and with D2 (dagre, ELK, TALA), then
# measure every SVG with the same script. Needs: node >= 22.6, d2 >= 0.9
# (TALA is bundled from 0.9.0), python3 with fonttools (pip3 install fonttools).
#
#     documentation/research/tala-benchmark/run.sh
set -eu
cd "$(dirname "$0")"
ROOT=../../..
VIEWS="medium large application-medium application-large infrastructure infrastructure-large"
ENGINES="${ENGINES:-dagre elk tala}"

command -v d2 >/dev/null || { echo "d2 not found: brew install d2" >&2; exit 1; }
python3 -c "import fontTools" 2>/dev/null || { echo "fonttools missing: pip3 install fonttools" >&2; exit 1; }
echo "$(d2 --version) / cairn $(node --experimental-strip-types "$ROOT/src/cli.ts" version | head -1)"

mkdir -p d2 out
FILES=""
for view in $VIEWS; do
  node --experimental-strip-types to-d2.ts "$ROOT/examples/$view.cairn" > "d2/$view.d2"
  node --experimental-strip-types "$ROOT/src/cli.ts" build "$ROOT/examples/$view.cairn" -o "out/$view.cairn.svg" >/dev/null
  FILES="$FILES out/$view.cairn.svg"
  for engine in $ENGINES; do
    d2 --layout="$engine" "d2/$view.d2" "out/$view.d2-$engine.svg" >/dev/null 2>&1 \
      || { echo "d2 --layout=$engine failed on $view" >&2; exit 1; }
    FILES="$FILES out/$view.d2-$engine.svg"
  done
done

# shellcheck disable=SC2086
python3 measure.py $FILES | tee results.tsv
# shellcheck disable=SC2086
python3 measure.py --json $FILES > results.json
echo "wrote results.tsv and results.json; SVGs are in out/"
