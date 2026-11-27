#!/bin/sh
# Render one .cairn (repo-relative path) with cairn and with each D2 engine in
# $ENGINES, into out/. Called by run.sh, from this folder.
set -u
ROOT=../../..
file="$1"
name=$(echo "$file" | sed 's|^examples/||; s|^documentation/research/||; s|/|__|g; s|\.cairn$||')
if ! node --experimental-strip-types to-d2.ts "$ROOT/$file" > "d2/$name.d2" 2>/dev/null; then
  echo "skipped $file (not a valid view)"
  rm -f "d2/$name.d2"
  exit 0
fi
node --experimental-strip-types "$ROOT/src/cli.ts" build "$ROOT/$file" -o "out/$name.cairn.svg" >/dev/null
node --experimental-strip-types owners.ts "$ROOT/$file" "out/$name.cairn.owners.json"
for engine in ${ENGINES:-dagre elk tala}; do
  d2 --layout="$engine" "d2/$name.d2" "out/$name.d2-$engine.svg" >/dev/null 2>&1 \
    || echo "d2 --layout=$engine failed on $file" >&2
done
