#!/bin/bash
# Install the Stripe CLI for the current user on macOS or Linux, no admin password needed.
# Usage: install-stripe.sh [--force] [--no-brew]
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

if [ "$FORCE" = 0 ] && command -v stripe >/dev/null 2>&1; then
  echo "stripe already installed: $(stripe --version)"; exit 0
fi

OS="$(uname -s)"; ARCH="$(uname -m)"
if [ "$OS" = Darwin ] && [ "$BREW" = 1 ] && command -v brew >/dev/null 2>&1; then
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
