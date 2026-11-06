#!/bin/bash
# Build the two Swift helpers for Apple Silicon and/or Intel.
#   bin/<arch>/fn-listener       modifier keys + paste + permission status
#   bin/<arch>/meeting-recorder  mic + system audio for meeting recording
# Run: npm run build:native            (both: arm64 and x64)
#      bash scripts/build-native.sh arm64
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHS=("$@")
[ $# -eq 0 ] && ARCHS=(arm64 x64)

for ARCH in "${ARCHS[@]}"; do
  case "$ARCH" in
    arm64) TARGET="arm64-apple-macos14.2" ;; # 14.2: meeting recording's process tap
    x64) TARGET="x86_64-apple-macos14.2" ;;
    *) echo "unknown arch: $ARCH (use arm64 or x64)"; exit 1 ;;
  esac
  mkdir -p "bin/$ARCH"
  for helper in fn-listener meeting-recorder; do
    # stop on a compile error (Swift 6 *warnings* also contain the word "error", so look for ": error:")
    if ! out=$(swiftc -O -target "$TARGET" "native/$helper.swift" -o "bin/$ARCH/$helper" 2>&1); then
      echo "$out" | grep ": error:"
      exit 1
    fi
  done
  echo "▸ Swift helpers built for $ARCH → bin/$ARCH/"
done
