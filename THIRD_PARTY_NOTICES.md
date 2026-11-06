# Third-party notices

L - Whisper's own code is MIT-licensed (see [`LICENSE`](LICENSE)). The app also ships or downloads the
open-source software below. Each keeps its own licence; the full texts are in [`licenses/`](licenses/)
and, in the installed app, in `L - Whisper.app/Contents/Resources/licenses/`.

Thank you to everyone behind these projects — L - Whisper would not exist without them.

| Component | What L - Whisper uses it for | Licence | How it's included |
|---|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) v1.9.5 (incl. ggml) | Speech recognition engine (`whisper-server`, `whisper-cli`) | MIT | Built from source, bundled |
| [FFmpeg](https://ffmpeg.org) 9.0.2 | Reads audio/video files, encodes meeting audio (`ffmpeg`, `ffprobe`) | LGPL v2.1 or later | Built from source (LGPL-only), bundled as separate programs |
| [Silero VAD](https://github.com/snakers4/silero-vad) v5.1.2 (ggml conversion) | Detects speech vs. silence during dictation | MIT | Bundled model file |
| [OpenAI Whisper](https://github.com/openai/whisper) models (ggml conversions from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)) | The speech recognition models | MIT | **Not bundled** — downloaded by the user in the app |
| [Electron](https://www.electronjs.org) (incl. Chromium and Node.js) | App framework | MIT (Electron); Chromium's components under their own licences | Bundled; its notices are `LICENSE.electron.txt` and `LICENSES.chromium.html` in `Contents/Resources/` |

Development-only tools (TypeScript, ESLint, Prettier, electron-builder, tsx) are used to build the app
and are not shipped inside it.

## FFmpeg (LGPL) — details

The LGPL lets L - Whisper ship FFmpeg as long as users can see its source and replace it with their own build.

- **Licence:** GNU Lesser General Public License v2.1 or later — full text in
  [`licenses/FFmpeg-LGPL-2.1.txt`](licenses/FFmpeg-LGPL-2.1.txt).
- **Source:** unmodified FFmpeg 9.0.2 release, <https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz>.
- **How it's built:** [`scripts/build-ffmpeg.sh`](scripts/build-ffmpeg.sh) — LGPL only (no `--enable-gpl`,
  no `--enable-nonfree`; the script refuses a GPL/non-free result). Configure flags:
  `--enable-static --disable-shared --disable-autodetect --enable-zlib --disable-doc --disable-ffplay
  --disable-debug --disable-network --disable-devices --disable-hwaccels --disable-encoders
  --enable-encoder=aac,pcm_s16le --disable-muxers --enable-muxer=ipod,mp4,mov,wav,null
  --disable-protocols --enable-protocol=file,pipe` (plus the chip flags in the script).
- **Replacing it:** L - Whisper runs `ffmpeg` and `ffprobe` as separate programs from
  `L - Whisper.app/Contents/Resources/bin/`. You can put your own builds there (then re-sign the app,
  see [`scripts/sign-app.sh`](scripts/sign-app.sh)).
- FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

## Names

"Whisper" is the name of OpenAI's speech recognition model; L - Whisper uses it to describe what it runs.
L - Whisper is an independent project and is not affiliated with or endorsed by OpenAI, Anthropic
(Claude Code) or any other company named here. Claude Code and Codex are only used if you install and
sign in to them yourself (optional AI summary).
