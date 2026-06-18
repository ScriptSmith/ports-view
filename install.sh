#!/bin/bash

# Install script for the Ports View GNOME extension

EXTENSION_UUID="ports-view@local"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Installing Ports View extension..."

# Create extension directory
mkdir -p "$EXTENSION_DIR/schemas"

# Copy files
cp metadata.json "$EXTENSION_DIR/"
cp extension.js "$EXTENSION_DIR/"
cp prefs.js "$EXTENSION_DIR/"
cp stylesheet.css "$EXTENSION_DIR/"
cp schemas/*.xml "$EXTENSION_DIR/schemas/"

# Compile schemas in the extension directory
glib-compile-schemas "$EXTENSION_DIR/schemas/"

echo "Extension installed to: $EXTENSION_DIR"
echo ""
echo "To enable the extension:"
echo "  1. Log out and log back in (on Wayland), or press Alt+F2, type 'r', Enter (on X11)"
echo "  2. Enable it with: gnome-extensions enable $EXTENSION_UUID"
echo "  3. Or use the GNOME Extensions app to enable it"
echo ""
echo "To configure it:"
echo "  - Run: gnome-extensions prefs $EXTENSION_UUID"
echo ""
echo "To test it in a nested session:"
echo "  - Run: dbus-run-session gnome-shell --devkit --wayland"
