#!/bin/bash
# Install Node.js LTS for the current user on macOS or Linux, no admin password needed.
# Usage: install-node.sh [--force] [--no-brew]
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

if [ "$FORCE" = 0 ] && command -v node >/dev/null 2>&1; then
  echo "node already installed: $(node --version)"; exit 0
fi

OS="$(uname -s)"; ARCH="$(uname -m)"
if [ "$OS" = Darwin ] && [ "$BREW" = 1 ] && command -v brew >/dev/null 2>&1; then
  brew install node
  echo "node installed with Homebrew: $(node --version)"; exit 0
fi

case "$OS" in Darwin) PLATFORM=darwin ;; Linux) PLATFORM=linux ;; *) echo "unsupported OS: $OS" >&2; exit 1 ;; esac
case "$ARCH" in arm64|aarch64) CPU=arm64 ;; x86_64|amd64) CPU=x64 ;; *) echo "unsupported CPU: $ARCH" >&2; exit 1 ;; esac

VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | tr '{' '\n' | grep -v '"lts":false' | grep -o '"version":"v[0-9.]*"' | head -1 | cut -d'"' -f4)"
[ -n "$VERSION" ] || { echo "could not find the latest Node LTS version" >&2; exit 1; }

TMP="$(mktemp -d)"
curl -fsSL "https://nodejs.org/dist/$VERSION/node-$VERSION-$PLATFORM-$CPU.tar.gz" -o "$TMP/node.tar.gz"
mkdir -p "$PREFIX"
[ -d "$PREFIX/node" ] && mv "$PREFIX/node" "$TMP/old-node"
mkdir -p "$PREFIX/node"
tar -xzf "$TMP/node.tar.gz" -C "$PREFIX/node" --strip-components 1
add_path "$PREFIX/node/bin"
echo "node installed in $PREFIX/node: $("$PREFIX/node/bin/node" --version), open a new terminal or session to use it"
