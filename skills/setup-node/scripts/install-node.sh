#!/bin/bash
# Install Node.js LTS for the current user on macOS or Linux, the same way on every machine.
# Usage: install-node.sh [--force] [--no-brew]
# On macOS it uses Homebrew and exits with code 3 when Homebrew is missing;
# --no-brew installs the official release into ~/.local instead (no admin rights).
set -euo pipefail

PREFIX="${AIM_PREFIX:-$HOME/.local}"
FORCE=0; BREW=1
for arg in "$@"; do
  case "$arg" in --force) FORCE=1 ;; --no-brew) BREW=0 ;; esac
done

# Write a line once into every shell config a new terminal or agent session reads.
persist() {
  local files="$HOME/.zprofile $HOME/.zshrc"
  case "${SHELL:-}" in */bash) files="$HOME/.bash_profile $HOME/.bashrc" ;; esac
  for rc in $files; do
    touch "$rc"
    grep -qxF "$1" "$rc" || echo "$1" >> "$rc"
  done
}

add_path() {
  persist "export PATH=\"$1:\$PATH\""
  export PATH="$1:$PATH"
}

# Homebrew lives in /opt/homebrew (Apple Silicon) or /usr/local (Intel), often not on PATH yet.
find_brew() {
  for b in "$(command -v brew 2>/dev/null)" /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -n "$b" ] && [ -x "$b" ]; then
      persist "eval \"\$($b shellenv)\""
      eval "$("$b" shellenv)"
      return 0
    fi
  done
  return 1
}

if [ "$FORCE" = 0 ] && command -v node >/dev/null 2>&1; then
  echo "node already installed: $(node --version)"; exit 0
fi

OS="$(uname -s)"; ARCH="$(uname -m)"
if [ "$OS" = Darwin ] && [ "$BREW" = 1 ]; then
  if ! find_brew; then
    echo "homebrew missing: install it first (setup-node skill), or rerun with --no-brew" >&2
    exit 3
  fi
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
