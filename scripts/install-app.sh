#!/bin/bash
# Build "L - Whisper.app", sign it with the local certificate, and install it into
# /Applications (replacing the old copy). Run with: npm run install-app
#
# Signing with the same certificate every time keeps macOS permissions
# (Microphone, Input Monitoring, Accessibility) across updates.
# NOTE: the certificate keeps its original name "Whisper Desktop Local" on purpose —
# a new certificate would make macOS ask for all permissions again.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="Whisper Desktop Local"
APP_NAME="L - Whisper"
ARCH="arm64" # this Mac (Apple Silicon); release DMGs: npm run release
BUILT="dist/mac-arm64/$APP_NAME.app"
TARGET="/Applications/$APP_NAME.app"
DATA="$HOME/Library/Application Support/$APP_NAME"
MODELS="$DATA/models"

# The app was called "Whisper Desktop" before task 12 — migrate once, then remove.
OLD_NAME="Whisper Desktop"
OLD_DATA="$HOME/Library/Application Support/$OLD_NAME"
OLD_TARGET="/Applications/$OLD_NAME.app"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "0/6 Migrating from \"$OLD_NAME\" (one-time)"
if [ -d "$OLD_DATA/models" ] && [ ! -d "$MODELS" ]; then
  mkdir -p "$MODELS"
  cp -c "$OLD_DATA/models/"*.bin "$MODELS/" # APFS clone: instant, no extra disk space
  # keep the language etc., but drop launchedBefore so the renamed app sets up Open at Login
  [ -f "$OLD_DATA/settings.json" ] && node -e '
    const s = require(process.argv[1]); delete s.launchedBefore;
    require("fs").writeFileSync(process.argv[2], JSON.stringify(s, null, 2));' \
    "$OLD_DATA/settings.json" "$DATA/settings.json"
  echo "models + settings copied to $DATA"
else
  echo "nothing to migrate"
fi
if [ -d "$OLD_TARGET" ]; then
  osascript -e "tell application \"$OLD_NAME\" to quit" 2>/dev/null || true
  sleep 2
  rm -rf "$OLD_TARGET" && echo "removed $OLD_TARGET"
fi

step "1/6 Checking prerequisites"
security find-identity -p codesigning | grep -q "\"$IDENTITY\"" \
  || { echo "Signing certificate \"$IDENTITY\" not found in the keychain."; exit 1; }
# Whisper models are not shipped in the app: the user downloads them in Settings → Models.
FOUND=""
for f in "$MODELS"/ggml-*.bin; do
  [ -f "$f" ] && [[ "$f" != *silero* ]] && FOUND="$FOUND $(basename "$f")"
done
echo "certificate found; Whisper models on this Mac: ${FOUND:-none (choose one in Settings → Models)}"

step "2/6 Swift helpers + bundled tools (whisper.cpp, ffmpeg, VAD model)"
if [ ! -x bin/$ARCH/fn-listener ] || [ native/fn-listener.swift -nt bin/$ARCH/fn-listener ] \
  || [ ! -x bin/$ARCH/meeting-recorder ] || [ native/meeting-recorder.swift -nt bin/$ARCH/meeting-recorder ]; then
  bash scripts/build-native.sh $ARCH && echo "helpers rebuilt"
else
  echo "helpers up to date"
fi
# Programs shipped inside the app (no Homebrew needed on the Mac that runs it).
if [ ! -x bin/$ARCH/whisper-server ] || [ ! -x bin/$ARCH/whisper-cli ] || [ ! -x bin/$ARCH/ffmpeg ] || [ ! -x bin/$ARCH/ffprobe ] \
  || [ ! -f models/ggml-silero-v5.1.2.bin ]; then
  bash scripts/build-whisper.sh $ARCH && bash scripts/build-ffmpeg.sh $ARCH && echo "tools built"
else
  echo "tools present (rebuild: npm run build:tools)"
fi

step "3/6 Building the .app (TypeScript → build/, then electron-builder)"
npm run --silent build
rm -rf "$BUILT"
npx electron-builder --mac dir --arm64 --publish never 2>&1 | grep -vE "^\s*$" | sed 's/^/  /' | tail -6

step "4/6 Signing with \"$IDENTITY\""
bash scripts/sign-app.sh "$BUILT"

step "5/6 Replacing $TARGET"
osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || true
# also stop a dev run (`npm start`) from THIS project folder (works whatever the folder is called)
pkill -f "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" 2>/dev/null || true
sleep 2
rm -rf "$TARGET"
ditto "$BUILT" "$TARGET"
echo "installed ($(du -sh "$TARGET" | cut -f1))"

step "6/6 Launching"
open "$TARGET"
echo "done — look for the waveform icon in the menu bar"
