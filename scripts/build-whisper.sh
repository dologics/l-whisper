#!/bin/bash
# Build whisper.cpp's whisper-server + whisper-cli as SELF-CONTAINED programs for the app
# (no Homebrew libraries needed on the user's Mac). Output: bin/<arch>/whisper-server, whisper-cli
# Run: npm run build:tools   (both chips)   or: bash scripts/build-whisper.sh arm64 | x64
#
#   - pinned version (WHISPER_TAG) → updates are deliberate; change the tag to update
#   - static libraries (BUILD_SHARED_LIBS=OFF) → one file per program, no .dylib files
#   - macOS 14 target, GGML_NATIVE=OFF → runs on any Mac of that kind, not only the one that built it
#   - Apple Silicon (arm64): Metal on the GPU, shaders embedded in the program
#   - Intel (x64): CPU + Apple's Accelerate, AVX2/FMA/F16C (every Intel Mac that runs macOS 14 has
#     them); no Metal — Intel/AMD GPUs aren't reliable with ggml-metal
# Needs (build time only, on the developer's Mac): git, cmake, Xcode command-line tools.
set -euo pipefail
cd "$(dirname "$0")/.."

WHISPER_TAG="v1.9.5"
SRC=".deps/whisper.cpp"
ARCHS=("$@")
[ $# -eq 0 ] && ARCHS=(arm64 x64)

if [ ! -d "$SRC/.git" ] || [ "$(git -C "$SRC" describe --tags 2>/dev/null)" != "$WHISPER_TAG" ]; then
  echo "▸ downloading whisper.cpp $WHISPER_TAG"
  rm -rf "$SRC"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp.git "$SRC"
fi

for ARCH in "${ARCHS[@]}"; do
  BUILD="$SRC/build-$ARCH"
  case "$ARCH" in
    arm64) CHIP=(-DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON) ;;
    x64) CHIP=(-DCMAKE_OSX_ARCHITECTURES=x86_64 -DGGML_METAL=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON) ;;
    *) echo "unknown arch: $ARCH (use arm64 or x64)"; exit 1 ;;
  esac

  echo "▸ configuring whisper.cpp for $ARCH"
  cmake -S "$SRC" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF "${CHIP[@]}" -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF \
    > "$BUILD.log" 2>&1 || { tail -20 "$BUILD.log"; exit 1; }

  echo "▸ compiling for $ARCH (a few minutes the first time)"
  cmake --build "$BUILD" --config Release -j "$(sysctl -n hw.ncpu)" --target whisper-server whisper-cli \
    >> "$BUILD.log" 2>&1 || { grep -E ": error:" "$BUILD.log" | head -20; exit 1; }

  mkdir -p "bin/$ARCH"
  cp "$BUILD/bin/whisper-server" "$BUILD/bin/whisper-cli" "bin/$ARCH/"
  echo "▸ done: bin/$ARCH/whisper-server, whisper-cli ($WHISPER_TAG)"
done

# Silero VAD model (~1 MB): shipped inside the app so dictation can skip silence.
# Official whisper.cpp copy, checksum pinned. (The big Whisper models are NOT shipped.)
VAD="models/ggml-silero-v5.1.2.bin"
VAD_SHA256="29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf"
if [ ! -f "$VAD" ]; then
  echo "▸ downloading $VAD"
  mkdir -p models
  curl -fsSL -o "$VAD" "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"
fi
echo "$VAD_SHA256  $VAD" | shasum -a 256 -c --quiet || { echo "checksum mismatch — delete $VAD"; exit 1; }
echo "▸ VAD model ok: $VAD"
