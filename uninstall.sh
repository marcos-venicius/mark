#!/usr/bin/env sh
# Undo install.sh. Set PREFIX to the same value it was installed with.
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
BINDIR="$PREFIX/bin"
DATADIR="$PREFIX/share"
APPDIR="$DATADIR/applications"
ICONDIR="$DATADIR/icons/hicolor"
MIMEDIR="$DATADIR/mime"

rm -f \
  "$BINDIR/mark" \
  "$APPDIR/mark.desktop" \
  "$ICONDIR/256x256/apps/mark.png" \
  "$ICONDIR/scalable/apps/mark.svg" \
  "$MIMEDIR/packages/mark.xml"

echo "Removed mark from $PREFIX"

# Same three caches as install.sh, and optional for the same reason. The MIME
# one matters slightly more here: until it runs, the extensions mark added stay
# in the database pointing at a type nothing handles any more.
if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database "$MIMEDIR" || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPDIR" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICONDIR" || true
fi

# What is left is the reader's own choice of default application, which lives in
# ~/.config/mimeapps.list and belongs to them, not to this script.
echo "If mark was set as the default for a file type, clear it in mimeapps.list."
