#!/usr/bin/env bash
# Smoke-test a compiled cairn binary.
#
# `npm test` runs under Node (--experimental-strip-types) and can prove the
# SOURCE is correct — but it cannot prove the bun-COMPILED binary actually runs.
# The compiled binary bundles its own module graph (incl. elkjs's worker), so a
# loader/bundling bug can break the binary while every Node test stays green.
# This script closes that gap: it runs the real binary through the whole pipeline
# (parse → validate → elkjs layout → render, plus the matrix and explain paths)
# and fails if any of it doesn't work.
#
# Usage:
#   scripts/smoke-binary.sh                # compile the HOST target with Bun, then smoke it
#   scripts/smoke-binary.sh <path-to-bin>  # smoke an ALREADY-built binary (used by the release job)
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="${1:-}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [ -z "$BIN" ]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "⚠ bun not installed — skipping binary smoke (this runs for real in CI, or install bun locally)"
    exit 0
  fi
  echo "• compiling host binary with bun…"
  bun install >/dev/null 2>&1 || true
  BIN="$TMP/cairn"
  bun build --compile --minify src/cli.ts --outfile "$BIN"
fi

[ -x "$BIN" ] || { echo "✗ binary not found or not executable: $BIN"; exit 1; }
echo "• smoking: $BIN"
fail() { echo "✗ $1"; exit 1; }

# 1) build a diagram — exercises lex → parse → validate → layout (elkjs) → render
out="$("$BIN" build examples/small.cairn -o "$TMP/out.svg")" || fail "build exited non-zero"
echo "$out" | grep -q "label overlaps: 0" || fail "build did not report 'label overlaps: 0' — got: $out"
head -c 5 "$TMP/out.svg" | grep -q "<svg" || fail "build output is not an SVG"

# 2) matrix export — exercises the flow-matrix code path
"$BIN" matrix examples/infrastructure.cairn --format csv -o "$TMP/m.csv" >/dev/null || fail "matrix exited non-zero"
[ -s "$TMP/m.csv" ] || fail "matrix produced no output"

# 3) explain — exercises the diagnostics table
"$BIN" explain E0203 >/dev/null || fail "explain exited non-zero"

echo "✓ binary smoke passed — layout, render, matrix, and explain all work in the compiled binary"
