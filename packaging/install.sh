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

tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
[ -n "$tag" ] || { echo "could not determine latest release"; exit 1; }
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
