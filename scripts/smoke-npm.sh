#!/usr/bin/env bash
# Smoke-test the package as npm actually delivers it.
#
# Every other gate runs from the repo: `npm test` executes src/*.ts through
# --experimental-strip-types, and smoke-binary.sh tests the Bun binary. Neither
# can see the failure mode that matters here — Node refuses to strip types under
# node_modules, so a package that works perfectly from a checkout can still ship
# a CLI that won't start. This packs, installs into a throwaway consumer, and
# runs the *installed* command, which exercises prepack, `files`, the `bin`
# mapping and the bundle together.
#
# Usage:
#   scripts/smoke-npm.sh              # pack, install, smoke
#   scripts/smoke-npm.sh <version>    # also assert `cairn version` reports exactly this
#                                     # (the release job passes the tag here — see release.yml)
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_VERSION="${1:-}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "• packing…"
# `--silent` doesn't gag the `prepack` script, whose output lands on the same
# stdout — take the last line, which is the tarball name.
TARBALL="$(npm pack --silent --pack-destination "$TMP" | tail -n 1)"

echo "• installing $TARBALL into a scratch consumer…"
mkdir -p "$TMP/consumer"
(
  cd "$TMP/consumer"
  npm init -y >/dev/null
  npm install --no-audit --no-fund --silent "$TMP/$TARBALL"
)

PKG_DIR="$TMP/consumer/node_modules/@r0kshan/cairn"
# Read the bin target from the INSTALLED manifest rather than hardcoding it, so
# a `bin` entry pointing at a file `files` didn't ship fails right here. The
# `cd` keeps the path relative — under Git Bash, node is a Windows binary and
# can't resolve an MSYS path like /tmp/....
BIN_REL="$(cd "$PKG_DIR" && node -p "require('./package.json').bin.cairn")"
BIN_TARGET="$PKG_DIR/$BIN_REL"
[ -f "$BIN_TARGET" ] || { echo "✗ bin target missing from the tarball: $BIN_REL"; exit 1; }

BIN="$TMP/consumer/node_modules/.bin/cairn"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # npm's POSIX shim hardcodes a Windows node path Git Bash can't exec
    # ("C:/Program: No such file or directory"). Drive the installed entry
    # directly instead — that still covers prepack, `files`, the bin mapping and
    # the bundle itself; only npm's own shim goes unexercised, and CI covers it.
    # `cygpath -m` gives a forward-slash Windows path: native node understands
    # it, and unlike `-w` it survives shell quoting without backslash escapes.
    echo "⚠ Windows shell — invoking the installed entry directly; the .bin shim is covered in CI"
    BIN="$TMP/cairn-run"
    printf '#!/usr/bin/env bash\nexec node "%s" "$@"\n' "$(cygpath -m "$BIN_TARGET")" > "$BIN"
    chmod +x "$BIN"
    ;;
  *)
    [ -x "$BIN" ] || { echo "✗ npm did not link an executable at $BIN"; exit 1; }
    ;;
esac

# Reuse the binary smoke: it drives build → matrix → explain (+ version) through
# whatever executable it's handed, so the npm CLI is held to the same bar as the
# compiled binaries.
bash scripts/smoke-binary.sh "$BIN" "$EXPECTED_VERSION"

echo "✓ npm package smoke passed — the published CLI installs and runs"
