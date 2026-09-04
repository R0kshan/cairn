#!/usr/bin/env bash
# Bundle everything the binary channel owes a user into one release asset:
#
#   dist/cairn-<version>-licenses.tar.gz
#     LICENSE                  cairn's own Apache-2.0 grant
#     THIRD-PARTY-NOTICES.md   the long form, incl. the LGPL-2.1 relink offer
#     licenses/                full text of every third-party licence
#
# One asset rather than one per file, because the alternative does not hold.
# The Homebrew formula, the Scoop manifest, install.sh and release.yml each
# have to name what they carry; with loose files that is four places to edit
# every time a licence text is added, and the failure mode when someone forgets
# is silent — a notice that names a text nobody ships. A tarball makes the
# packaging blind to how many texts there are.
#
# Deliberately NOT wrapped in a top-level directory: Homebrew's `stage` descends
# into a lone top-level dir but not into three entries, and Scoop would need a
# matching `extract_dir`. Flat means every consumer sees the same three paths.
set -euo pipefail
cd "$(dirname "$0")/.."

# Same contract as build-binaries.sh: the release workflow passes the tag, local
# runs fall back to package.json.
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
OUT=dist
mkdir -p "$OUT"

ARCHIVE="$OUT/cairn-${VERSION}-licenses.tar.gz"

# The notice is generated from src/notice.ts, so a stale checked-in copy cannot
# ship: regenerate nothing here, just refuse to bundle a tree whose notice does
# not match its source. (`npm test` runs the same assertion.)
node --experimental-strip-types scripts/print-notice.mjs >/dev/null

tar -czf "$ARCHIVE" LICENSE THIRD-PARTY-NOTICES.md licenses

echo "✓ $ARCHIVE"
tar -tzf "$ARCHIVE" | sed 's/^/    /'
