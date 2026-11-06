#!/bin/bash
# Sign a built "L - Whisper.app" with the local self-signed certificate.
# Used by install-app.sh (this Mac) and release.sh (the DMGs).   Usage: bash scripts/sign-app.sh <path/to/L - Whisper.app>
#
# Always the SAME certificate and identifiers → macOS keeps the user's permissions (Microphone,
# Input Monitoring, Accessibility) across updates. Identifiers: com.dologics.lwhisper (+ .helper,
# .meeting, .<tool>) — changed once, in task 22, from local.whisper-desktop. Keep them stable.
# The certificate's name keeps its old name on purpose (a new certificate = new permission prompts).
set -euo pipefail

APP="$1"
IDENTITY="Whisper Desktop Local"
ID="com.dologics.lwhisper"
BIN="$APP/Contents/Resources/bin"

security find-identity -p codesigning | grep -q "\"$IDENTITY\"" \
  || { echo "Signing certificate \"$IDENTITY\" not found in the keychain."; exit 1; }

# app + Electron's internal parts, then our programs, then re-seal the app.
codesign --force --deep --sign "$IDENTITY" --identifier "$ID" "$APP"
codesign --force --sign "$IDENTITY" --identifier "$ID.helper" "$BIN/fn-listener"
codesign --force --sign "$IDENTITY" --identifier "$ID.meeting" "$BIN/meeting-recorder"
for tool in whisper-server whisper-cli ffmpeg ffprobe; do
  codesign --force --sign "$IDENTITY" --identifier "$ID.$tool" "$BIN/$tool"
done
codesign --force --sign "$IDENTITY" --identifier "$ID" "$APP"
codesign --verify --deep --strict "$APP" && echo "signature valid"
