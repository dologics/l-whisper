#!/bin/bash
# Build the DMGs to share L - Whisper with other Macs:
#   dist/release/L-Whisper-<version>-arm64.dmg   Apple Silicon (M1, M2, M3, M4…)
#   dist/release/L-Whisper-<version>-x64.dmg     Intel
# Run: npm run release            (both)      or: bash scripts/release.sh arm64
#
# Each DMG: the signed app + an Applications shortcut + "How to open.txt".
# No Whisper model inside — users pick one in the app's first-run setup.
# Signed with the local self-signed certificate (no Apple Developer ID), so macOS asks the
# user to allow the app once (System Settings → Privacy & Security → Open Anyway).
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="L - Whisper"
VERSION="$(node -p "require('./package.json').version")"
OUT="dist/release"
ARCHS=("$@")
[ $# -eq 0 ] && ARCHS=(arm64 x64)

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "Programs for: ${ARCHS[*]}"
for ARCH in "${ARCHS[@]}"; do
  [ -x "bin/$ARCH/fn-listener" ] && [ -x "bin/$ARCH/meeting-recorder" ] || bash scripts/build-native.sh "$ARCH"
  [ -x "bin/$ARCH/whisper-server" ] && [ -x "bin/$ARCH/whisper-cli" ] || bash scripts/build-whisper.sh "$ARCH"
  [ -x "bin/$ARCH/ffmpeg" ] && [ -x "bin/$ARCH/ffprobe" ] || bash scripts/build-ffmpeg.sh "$ARCH"
  echo "$ARCH ok"
done
[ -f models/ggml-silero-v5.1.2.bin ] || bash scripts/build-whisper.sh "${ARCHS[0]}" # fetches the VAD model

step "TypeScript → build/"
npm run --silent build

mkdir -p "$OUT"
for ARCH in "${ARCHS[@]}"; do
  step "$ARCH: building the app"
  # electron-builder puts Apple Silicon in dist/mac-arm64, Intel in dist/mac
  if [ "$ARCH" = arm64 ]; then BUILT="dist/mac-arm64/$APP_NAME.app"; else BUILT="dist/mac/$APP_NAME.app"; fi
  rm -rf "$BUILT"
  npx electron-builder --mac dir "--$ARCH" --publish never 2>&1 | grep -E "packaging|error" | sed 's/^/  /' || true
  [ -d "$BUILT" ] || { echo "build failed: $BUILT missing"; exit 1; }

  step "$ARCH: signing"
  bash scripts/sign-app.sh "$BUILT"

  step "$ARCH: checking every program is built for $ARCH"
  WANT="$([ "$ARCH" = arm64 ] && echo arm64 || echo x86_64)"
  for f in "$BUILT/Contents/MacOS/$APP_NAME" "$BUILT"/Contents/Resources/bin/*; do
    [ "$(lipo -archs "$f")" = "$WANT" ] || { echo "wrong chip type: $f ($(lipo -archs "$f"))"; exit 1; }
  done
  echo "all $WANT"

  step "$ARCH: making the DMG"
  STAGE="dist/dmg-$ARCH"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  ditto "$BUILT" "$STAGE/$APP_NAME.app"
  ln -s /Applications "$STAGE/Applications"
  sed "s/{{VERSION}}/$VERSION/; s/{{CHIP}}/$([ "$ARCH" = arm64 ] && echo 'Apple Silicon' || echo 'Intel')/" \
    scripts/dmg/how-to-open.txt > "$STAGE/How to open.txt"
  DMG="$OUT/L-Whisper-$VERSION-$ARCH.dmg"
  rm -f "$DMG"
  hdiutil create -quiet -volname "$APP_NAME $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO "$DMG"
  rm -rf "$STAGE"
  echo "$DMG ($(du -h "$DMG" | cut -f1))"
done

step "Done"
(cd "$OUT" && shasum -a 256 L-Whisper-"$VERSION"-*.dmg | tee "L-Whisper-$VERSION-SHA256.txt")
