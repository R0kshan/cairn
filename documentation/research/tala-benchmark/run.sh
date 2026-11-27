#!/bin/sh
# Render every .cairn in the repository with cairn and with D2 (dagre, ELK,
# TALA), measure every SVG with the same script, and summarize.
# Needs: node >= 22.6, git, d2 >= 0.9 (TALA is bundled from 0.9.0), python3
# with fonttools (pip3 install fonttools).
#
#     documentation/research/tala-benchmark/run.sh
set -eu
cd "$(dirname "$0")"
ENGINES="${ENGINES:-dagre elk tala}"
JOBS="${JOBS:-4}"
export ENGINES

command -v d2 >/dev/null || { echo "d2 not found: brew install d2" >&2; exit 1; }
python3 -c "import fontTools" 2>/dev/null || { echo "fonttools missing: pip3 install fonttools" >&2; exit 1; }
echo "$(d2 --version) / $(node --experimental-strip-types ../../../src/cli.ts version | head -1)"

rm -rf d2 out && mkdir -p d2 out
git ls-files --full-name ../../../ | grep '\.cairn$' | xargs -P "$JOBS" -n 1 ./render-one.sh

python3 measure.py --json out/*.svg > results.json
python3 summarize.py results.json | tee summary.txt
echo "wrote results.json and summary.txt; SVGs are in out/"
