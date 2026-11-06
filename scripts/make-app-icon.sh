#!/bin/bash
# Builds assets/icon.icns (+ assets/icon-preview.png) from scripts/make-app-icon.swift.
# Run: bash scripts/make-app-icon.sh
set -euo pipefail
cd "$(dirname "$0")/.."

WORK=$(mktemp -d)
swift scripts/make-app-icon.swift "$WORK/master.png"

# macOS .iconset naming: icon_<size>x<size>[@2x].png
mkdir "$WORK/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/master.png" --out "$WORK/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$WORK/master.png" --out "$WORK/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/icon.iconset" -o assets/icon.icns
sips -z 256 256 "$WORK/master.png" --out assets/icon-preview.png >/dev/null
rm -rf "$WORK"
echo "Wrote assets/icon.icns (+ assets/icon-preview.png)"
