#!/bin/bash
# Install the Stripe CLI for the current user on macOS or Linux, the same way on every machine.
# Usage: install-stripe.sh [--force] [--no-brew]
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

if [ "$FORCE" = 0 ] && command -v stripe >/dev/null 2>&1; then
  echo "stripe already installed: $(stripe --version)"; exit 0
fi

OS="$(uname -s)"; ARCH="$(uname -m)"
if [ "$OS" = Darwin ] && [ "$BREW" = 1 ]; then
  if ! find_brew; then
    echo "homebrew missing: install it first (setup-node skill), or rerun with --no-brew" >&2
    exit 3
  fi
  brew install stripe/stripe-cli/stripe
  echo "stripe installed with Homebrew: $(stripe --version)"; exit 0
fi

case "$OS" in Darwin) PLATFORM=mac-os ;; Linux) PLATFORM=linux ;; *) echo "unsupported OS: $OS" >&2; exit 1 ;; esac
case "$ARCH" in arm64|aarch64) CPU=arm64 ;; x86_64|amd64) CPU=x86_64 ;; *) echo "unsupported CPU: $ARCH" >&2; exit 1 ;; esac
TAG="$(curl -fsSI https://github.com/stripe/stripe-cli/releases/latest | grep -i '^location:' | sed 's|.*/tag/||' | tr -d '\r\n')"
VERSION="${TAG#v}"
[ -n "$VERSION" ] || { echo "could not find the latest Stripe CLI version" >&2; exit 1; }

TMP="$(mktemp -d)"
curl -fsSL "https://github.com/stripe/stripe-cli/releases/download/$TAG/stripe_${VERSION}_${PLATFORM}_${CPU}.tar.gz" -o "$TMP/stripe.tar.gz"
tar -xzf "$TMP/stripe.tar.gz" -C "$TMP"
mkdir -p "$PREFIX/bin"
cp "$TMP/stripe" "$PREFIX/bin/stripe"
chmod +x "$PREFIX/bin/stripe"
add_path "$PREFIX/bin"
echo "stripe installed in $PREFIX/bin: $("$PREFIX/bin/stripe" --version)"
