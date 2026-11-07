# Changelog

What changed in each version of L - Whisper, in plain words. Newest first.
Versions: MAJOR.MINOR.PATCH — see the `release-app` skill for when each number goes up.

## Unreleased

- Settings is split into tabs: General · Dictation · Models · AI summary · Permissions. Links like "Settings → AI summary" open the right tab (#3).

## 1.1.1 — 2026-11-07

- Open-source ready: MIT licence (© DoLogics), README, contributing guide, security policy and issue templates.
- About window and Settings now show "© DoLogics · MIT License", the GitHub link and "Built by Mohsin Shoaib"; licences of whisper.cpp, FFmpeg, Silero VAD and the Whisper models ship inside the app.
- Settings → AI summary shows the tool's location as `~/…` instead of your full home folder path.

## 1.1.0 — 2026-11-06

- **Library** (replaces the Meetings page): recorded meetings and transcribed files in one list, newest first, with an All / Meetings / Files filter. A dropped file's transcript is saved there automatically — the file itself is never copied or moved; if you move it, the transcript stays readable. Your recordings folder is now `~/Documents/L - Whisper Library` (moved once, automatically).
- **AI summary:** in the Library, click **Summarize** to get a short summary with key points and action items, made by your own **Claude Code** (Claude subscription) or **Codex** (ChatGPT subscription) — choose it in Settings → AI summary. Saved next to the transcript. Off by default; only the transcript text is sent, and only when you click.

Under the hood: `library://` player protocol, `item.json` per Library item, AI tools run with no shell, tools off, in an empty folder. Settings, model and permissions carry over from 1.0.0.

## 1.0.0 — 2026-11-05

First version shared with other Macs. Two downloads: **Apple Silicon** and **Intel**. Needs macOS 14.2 or newer.

- **Dictation:** hold your dictation key, speak, and the text is pasted where your cursor is. Double-tap for hands-free. The key is **fn** or any **two modifier keys** (⌃ ⌥ ⇧ ⌘), with a live test in Settings.
- **File transcription:** drop an audio or video file → timestamped transcript → copy or save as .txt, .srt or .vtt.
- **Meeting recording:** your microphone + the other side (any app) into one audio file per meeting; follows the microphone your call uses.
- **Meetings page:** play, transcribe (Auto / English / Urdu, translate to English), rename, delete; transcripts saved next to the audio.
- **Whisper models:** choose and download a model in the app (Tiny … Large v3 Turbo), switch any time, delete unused ones. Downloads resume and are checked for damage.
- **First-run setup:** permissions, dictation key and model, step by step; "Run setup again" in Settings.
- **Private:** everything runs on your Mac. The only internet use is downloading model files.
- **Credits:** Developed by Mohsin Shoaib · Powered by DoLogics (About window and Settings).

Under the hood: TypeScript; whisper.cpp v1.9.5 and FFmpeg 9.0.2 (LGPL) built into the app (no Homebrew); app ID `com.dologics.lwhisper`.
