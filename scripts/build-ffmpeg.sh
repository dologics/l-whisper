#!/bin/bash
# Build ffmpeg + ffprobe as SELF-CONTAINED programs for the app. Output: bin/<arch>/ffmpeg, ffprobe
# Run: npm run build:tools   (both chips)   or: bash scripts/build-ffmpeg.sh arm64 | x64
#
#   - LGPL only (no --enable-gpl / --enable-nonfree), so L - Whisper can use a permissive
#     licence. Homebrew's ffmpeg is a GPL build — that's one reason we build our own.
#   - static, and no external libraries except macOS's own zlib (--disable-autodetect)
#   - everything for READING audio/video (all decoders, demuxers, filters), but only what the
#     app WRITES: AAC in .m4a (meetings), 16-bit WAV (for Whisper), to files or pipes
#   - pinned version + checksum → the source can't silently change
#   - Intel (x64) is cross-compiled on Apple Silicon (clang -arch x86_64); its hand-written x86
#     assembly is left out (needs nasm) — the C code is plenty fast for audio
# Needs (build time only): curl, make, Xcode command-line tools. ~2–5 minutes per chip.
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG_VERSION="9.0.2"
FFMPEG_SHA256="8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e"
TARBALL=".deps/ffmpeg-$FFMPEG_VERSION.tar.xz"
ARCHS=("$@")
[ $# -eq 0 ] && ARCHS=(arm64 x64)

mkdir -p .deps
if [ ! -f "$TARBALL" ]; then
  echo "▸ downloading FFmpeg $FFMPEG_VERSION"
  curl -fsSL -o "$TARBALL" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
fi
echo "$FFMPEG_SHA256  $TARBALL" | shasum -a 256 -c --quiet || { echo "checksum mismatch — delete $TARBALL"; exit 1; }

for ARCH in "${ARCHS[@]}"; do
  SRC=".deps/ffmpeg-$FFMPEG_VERSION-$ARCH" # one source copy per chip (ffmpeg builds in place)
  LOG="$PWD/.deps/ffmpeg-build-$ARCH.log"
  case "$ARCH" in
    arm64) CHIP=(--arch=arm64 --cc=clang) ;;
    x64) CHIP=(--arch=x86_64 --enable-cross-compile --target-os=darwin "--cc=clang -arch x86_64" --disable-x86asm) ;;
    *) echo "unknown arch: $ARCH (use arm64 or x64)"; exit 1 ;;
  esac
  if [ ! -d "$SRC" ]; then
    mkdir -p "$SRC"
    tar -xf "$TARBALL" -C "$SRC" --strip-components 1
  fi

  echo "▸ configuring FFmpeg for $ARCH (LGPL, static)"
  (
    cd "$SRC"
    ./configure "${CHIP[@]}" \
      --extra-cflags="-mmacosx-version-min=14.0" --extra-ldflags="-mmacosx-version-min=14.0" \
      --enable-static --disable-shared \
      --disable-autodetect --enable-zlib \
      --disable-doc --disable-ffplay --disable-debug \
      --disable-network --disable-devices --disable-hwaccels \
      --disable-encoders --enable-encoder=aac,pcm_s16le \
      --disable-muxers --enable-muxer=ipod,mp4,mov,wav,null \
      --disable-protocols --enable-protocol=file,pipe \
      > "$LOG" 2>&1 || { tail -20 "$LOG"; exit 1; }
    echo "▸ compiling for $ARCH (a few minutes the first time)"
    make -j "$(sysctl -n hw.ncpu)" ffmpeg ffprobe >> "$LOG" 2>&1 || { grep -E "error:" "$LOG" | head -20; exit 1; }
  )

  # Safety check: the result must be LGPL (no GPL / nonfree parts). Reads the configure
  # result, so it also works for the Intel build on an Apple Silicon Mac.
  if grep -qE "^#define CONFIG_(GPL|NONFREE) 1" "$SRC/config.h" \
    || ! grep -q 'FFMPEG_LICENSE "LGPL' "$SRC/config.h"; then
    echo "ffmpeg ($ARCH) is not an LGPL build — refusing to use it"; exit 1
  fi
  mkdir -p "bin/$ARCH"
  cp "$SRC/ffmpeg" "$SRC/ffprobe" "bin/$ARCH/"
  echo "▸ done: bin/$ARCH/ffmpeg, ffprobe (FFmpeg $FFMPEG_VERSION, LGPL)"
done
