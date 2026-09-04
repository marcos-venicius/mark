#!/usr/bin/env sh
# Build mark, put the binary somewhere on your PATH, and register it with the
# desktop so a Markdown file opens here from a file manager.
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
BINDIR="$PREFIX/bin"
DATADIR="$PREFIX/share"
APPDIR="$DATADIR/applications"
ICONDIR="$DATADIR/icons/hicolor"
MIMEDIR="$DATADIR/mime"

cd "$(dirname "$0")"

echo "Building..."
cargo build --release

mkdir -p "$BINDIR"
install -m 755 target/release/mark "$BINDIR/mark"
echo "Installed $BINDIR/mark"

# The icon goes in before the desktop entry that names it: an entry pointing at
# an icon the theme does not have yet shows up blank, and some shells cache that
# blank for the session.
mkdir -p "$ICONDIR/256x256/apps" "$ICONDIR/scalable/apps"
install -m 644 assets/mark.png "$ICONDIR/256x256/apps/mark.png"
install -m 644 assets/mark.svg "$ICONDIR/scalable/apps/mark.svg"

# Exec gets the absolute path rather than the bare command. A file manager does
# not read a login shell's PATH, so "Exec=mark" would work or not depending on
# how the session was started -- and fail in exactly the case this script warns
# about at the end.
mkdir -p "$APPDIR"
sed "s|^Exec=.*|Exec=$BINDIR/mark %f|" linux/mark.desktop > "$APPDIR/mark.desktop"
chmod 644 "$APPDIR/mark.desktop"

mkdir -p "$MIMEDIR/packages"
install -m 644 linux/mark.xml "$MIMEDIR/packages/mark.xml"

echo "Installed the desktop entry and the icon"

# Three caches, none of them essential: without the refresh the entry appears at
# the next login instead of now. That is not worth aborting an install that has
# otherwise succeeded, so each one is optional and each one is allowed to fail.
if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database "$MIMEDIR" || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPDIR" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICONDIR" || true
fi

echo
echo "Right-click a Markdown file and choose Open With to pick mark once."

case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "Note: $BINDIR is not on your PATH, so 'mark file.md' in a terminal will not work yet." ;;
esac
