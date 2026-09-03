#!/usr/bin/env sh
# curl installer: curl -fsSL https://raw.githubusercontent.com/R0kshan/cairn/main/packaging/install.sh | sh
set -eu

REPO="R0kshan/cairn"
INSTALL_DIR="${CAIRN_INSTALL_DIR:-$HOME/.local/bin}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in
  linux) os=linux ;;
  darwin) os=darwin ;;
  *) echo "unsupported OS: $os (use the Windows .exe from the releases page)"; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $arch"; exit 1 ;;
esac

# GitHub's /releases/latest endpoint only ever returns a non-prerelease, so it
# 404s until a real (non-RC) release exists. Fetch the full release list instead
# and let the user choose: newest release regardless of type, or stable-only.
releases_json=$(curl -fsSL "https://api.github.com/repos/$REPO/releases")
pairs=$(printf '%s' "$releases_json" | grep -E '"tag_name":|"prerelease":' | paste -d' ' - - \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*"prerelease": *\([a-z]*\).*/\1 \2/p')

latest_any_tag=$(printf '%s\n' "$pairs" | head -n1 | awk '{print $1}')
latest_stable_tag=$(printf '%s\n' "$pairs" | awk '$2=="false"{print $1; exit}')

CAIRN_CHANNEL="${CAIRN_CHANNEL:-}"
if [ -z "$CAIRN_CHANNEL" ]; then
  # Probe tty availability in a subshell first: `exec 3</dev/tty` is a special
  # built-in, so a failed redirect on it would kill a non-interactive dash
  # script outright even inside `if`. Testing in a subshell avoids that.
  if ( : < /dev/tty ) 2>/dev/null; then
    exec 3</dev/tty
    printf 'Install the latest release, even if it is a pre-release? [Y/n] (n = require a stable release): ' >&2
    read -r reply <&3
    exec 3<&-
    case "$reply" in
      [Nn]*) CAIRN_CHANNEL=stable ;;
      *) CAIRN_CHANNEL=latest ;;
    esac
  else
    echo "note: no interactive terminal detected - defaulting to the latest release (pre-releases included)." >&2
    echo "      set CAIRN_CHANNEL=stable to require an actual stable release instead." >&2
    CAIRN_CHANNEL=latest
  fi
fi

case "$CAIRN_CHANNEL" in
  stable)
    tag="$latest_stable_tag"
    if [ -z "$tag" ]; then
      echo "no stable release yet - only pre-releases are available right now (latest: ${latest_any_tag:-none})." >&2
      echo "re-run and answer 'y' (or set CAIRN_CHANNEL=latest) to install ${latest_any_tag:-it} instead." >&2
      exit 1
    fi
    ;;
  *)
    tag="$latest_any_tag"
    [ -n "$tag" ] || { echo "could not determine latest release" >&2; exit 1; }
    ;;
esac
version=${tag#v}
asset="cairn-${version}-${os}-${arch}"

base="https://github.com/$REPO/releases/download/$tag"
sums="cairn-${version}-checksums.txt"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "downloading cairn $tag ($os-$arch)…"
curl -fsSL -o "$tmp/cairn" "$base/$asset"

# --- verify the download against the published sha256 checksums (fail closed) ---
if ! curl -fsSL -o "$tmp/$sums" "$base/$sums"; then
  echo "error: could not fetch $sums to verify the binary — aborting for safety" >&2
  exit 1
fi
expected=$(awk -v f="$asset" '{n=$2; sub(/^\*/,"",n); if (n==f) print $1}' "$tmp/$sums" | head -n1)
[ -n "$expected" ] || { echo "error: $asset not listed in $sums — aborting" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/cairn" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/cairn" | awk '{print $1}')
else
  echo "error: no sha256 tool (sha256sum/shasum) available to verify — aborting" >&2
  exit 1
fi
if [ "$expected" != "$actual" ]; then
  echo "error: checksum mismatch for $asset — refusing to install" >&2
  echo "  expected: $expected" >&2
  echo "  actual:   $actual" >&2
  exit 1
fi
echo "✓ sha256 verified"

mkdir -p "$INSTALL_DIR"
mv "$tmp/cairn" "$INSTALL_DIR/cairn"
chmod +x "$INSTALL_DIR/cairn"

# --- the licence texts travel with the binary ---------------------------------
# It inlines elkjs (EPL-2.0) and the Simple Icons artwork, so the notices are
# part of what this script distributes: EPL-2.0 §3.1(b) wants a copy of the
# Agreement alongside each copy of the program, and six of the vendored icons
# carry terms that require attribution. Best-effort — a missing notice must not
# leave a half-installed binary behind, so a failed fetch warns and moves on.
DOC_DIR="${CAIRN_DOC_DIR:-$INSTALL_DIR/../share/doc/cairn}"
if mkdir -p "$DOC_DIR" 2>/dev/null; then
  missing=""
  for doc in LICENSE THIRD-PARTY-NOTICES.md elkjs-EPL-2.0.md simple-icons-CC0-1.0.md; do
    curl -fsSL -o "$DOC_DIR/$doc" "$base/$doc" 2>/dev/null || missing="$missing $doc"
  done
  if [ -n "$missing" ]; then
    echo "note: could not fetch:$missing — read them at https://github.com/$REPO" >&2
  else
    echo "✓ licences: $DOC_DIR"
  fi
else
  echo "note: could not write $DOC_DIR — licences are at https://github.com/$REPO" >&2
fi

# macOS quarantines files downloaded via curl; strip it so Gatekeeper doesn't
# block the unsigned binary on first run. (Homebrew does this automatically.)
if [ "$os" = darwin ]; then
  xattr -d com.apple.quarantine "$INSTALL_DIR/cairn" >/dev/null 2>&1 || true
fi

echo "✓ installed: $INSTALL_DIR/cairn"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "note: add $INSTALL_DIR to your PATH" ;;
esac
"$INSTALL_DIR/cairn" explain E0203 >/dev/null 2>&1 && echo "✓ cairn runs"