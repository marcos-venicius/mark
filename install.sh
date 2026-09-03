#!/usr/bin/env sh
# Build mark and put the binary somewhere on your PATH.
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
BINDIR="$PREFIX/bin"

cd "$(dirname "$0")"

echo "Building..."
cargo build --release

mkdir -p "$BINDIR"
install -m 755 target/release/mark "$BINDIR/mark"
echo "Installed $BINDIR/mark"

case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "Note: $BINDIR is not on your PATH." ;;
esac
