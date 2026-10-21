#!/bin/bash
# Install the GitHub CLI (gh) for the current user on macOS or Linux, no admin password needed.
# Usage: install-gh.sh [--force] [--no-brew]
set -euo pipefail

PREFIX="${AIM_PREFIX:-$HOME/.local}"
FORCE=0; BREW=1
for arg in "$@"; do
  case "$arg" in --force) FORCE=1 ;; --no-brew) BREW=0 ;; esac
done

add_path() {
  local rc="$HOME/.zshrc"
  case "${SHELL:-}" in */bash) rc="$HOME/.bashrc" ;; esac
  local line="export PATH=\"$1:\$PATH\""
  touch "$rc"
  grep -qxF "$line" "$rc" || echo "$line" >> "$rc"
  export PATH="$1:$PATH"
}

if [ "$FORCE" = 0 ] && command -v gh >/dev/null 2>&1; then
  echo "gh already installed: $(gh --version | head -1)"; exit 0
fi

OS="$(uname -s)"; ARCH="$(uname -m)"
if [ "$OS" = Darwin ] && [ "$BREW" = 1 ] && command -v brew >/dev/null 2>&1; then
  brew install gh
  echo "gh installed with Homebrew: $(gh --version | head -1)"; exit 0
fi

case "$ARCH" in arm64|aarch64) CPU=arm64 ;; x86_64|amd64) CPU=amd64 ;; *) echo "unsupported CPU: $ARCH" >&2; exit 1 ;; esac
TAG="$(curl -fsSI https://github.com/cli/cli/releases/latest | grep -i '^location:' | sed 's|.*/tag/||' | tr -d '\r\n')"
VERSION="${TAG#v}"
[ -n "$VERSION" ] || { echo "could not find the latest gh version" >&2; exit 1; }

TMP="$(mktemp -d)"
BASE="https://github.com/cli/cli/releases/download/$TAG"
case "$OS" in
  Darwin)
    curl -fsSL "$BASE/gh_${VERSION}_macOS_${CPU}.zip" -o "$TMP/gh.zip"
    unzip -q "$TMP/gh.zip" -d "$TMP" ;;
  Linux)
    curl -fsSL "$BASE/gh_${VERSION}_linux_${CPU}.tar.gz" -o "$TMP/gh.tar.gz"
    tar -xzf "$TMP/gh.tar.gz" -C "$TMP" ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac
mkdir -p "$PREFIX/bin"
cp "$TMP"/gh_*/bin/gh "$PREFIX/bin/gh"
chmod +x "$PREFIX/bin/gh"
add_path "$PREFIX/bin"
echo "gh installed in $PREFIX/bin: $("$PREFIX/bin/gh" --version | head -1)"
