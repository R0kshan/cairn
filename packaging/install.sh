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

echo "installing cairn $tag ($os-$arch) to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
curl -fsSL -o "$INSTALL_DIR/cairn" "https://github.com/$REPO/releases/download/$tag/$asset"
chmod +x "$INSTALL_DIR/cairn"

echo "✓ installed: $INSTALL_DIR/cairn"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "note: add $INSTALL_DIR to your PATH" ;;
esac
"$INSTALL_DIR/cairn" explain E0203 >/dev/null 2>&1 && echo "✓ cairn runs"
