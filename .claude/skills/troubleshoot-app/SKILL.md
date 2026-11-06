---
name: troubleshoot-app
description: Use when L - Whisper misbehaves — the dictation key (Fn or the chosen combo) does nothing, nothing pastes, empty or wrong transcripts, app/icon missing after restart, file transcription fails, permissions keep being asked. Diagnose with facts (processes, logs, permissions) before changing code.
---

# Troubleshooting L - Whisper

Measure first, then fix. Tell the user what you check and what you find. Check `docs/GOTCHAS.md` — the symptom may already be known.

## 1. Is everything running?
```bash
ps -axo pid,command | grep -E "L - Whisper.app/Contents/MacOS/L - Whisper$|whisper-server -m|bin/fn-listener" | grep -v grep
```
Expected (installed app): the app, `…/Resources/bin/whisper-server` (bundled), and `…/Resources/bin/fn-listener`.
Missing app after a restart → check Open at Login (tray menu / Settings page) and that `/Applications/L - Whisper.app` exists.

## 2. See the installed app's log
GUI apps' output is discarded, so run it from a terminal to watch it live:
```bash
osascript -e 'tell application "L - Whisper" to quit'; sleep 2
"/Applications/L - Whisper.app/Contents/MacOS/L - Whisper" > /tmp/whisper-desktop.log 2>&1 &
# ask the user to reproduce, then: grep -E "^\[" /tmp/whisper-desktop.log
```
Add `WHISPER_DEBUG_KEYS=1` in front to log every dictation-key event (`down` / `up` / `combo`) with timestamps. Afterwards quit it and `open "/Applications/L - Whisper.app"` normally.

Log prefixes: `[whisper]` engine, `[recorder]` mic (incl. `mic live N ms`, loudness `peak/avg dB`), `[dictation]` text + timing, `[fn]` helper/keys, `[paste]` paste result, `[file]` file transcription, `[settings]`.

## 3. Permissions
- Window → Settings page shows Microphone / Input Monitoring / Accessibility live.
- Don't trust the helper's `status` when you run it from a terminal — macOS answers for the terminal, not the app. Use the Settings page or System Settings → Privacy & Security.
- Mic in use right now? Core Audio "is running somewhere" (see task 06 notes for the small Swift check).
- Asked again after an update → the app wasn't signed with "Whisper Desktop Local": `codesign -d -r- "/Applications/L - Whisper.app"` must show `certificate leaf = H"e47d0141…"`. Reinstall with `npm run install-app`.
- Fn/🌐 system setting must be "Do Nothing": `defaults read com.apple.HIToolbox AppleFnUsageType` → `0`. If not, the user changes it in System Settings → Keyboard (system setting: user does it).

## 4. Common causes
| Symptom | Check |
|---|---|
| The dictation key does nothing | Which key is chosen? (`hotkey` in settings.json, Settings → Dictation key — try **Test**). Helper running? `[keys] helper: ready`? Input Monitoring on? For Fn: 🌐 setting must be "Do Nothing" |
| Records but nothing pastes | `[paste]` line: `paste-error: accessibility…` → Accessibility for L - Whisper |
| Empty text | `[recorder] saved … avg -5x dB` = too quiet / mic wrong (check default input device); very short holds lose the first ~250 ms |
| "Thank you." pasted from silence | VAD model missing → `~/Library/Application Support/L - Whisper/models/ggml-silero-v5.1.2.bin` |
| Engine error in Settings / red dot | model file in the data folder? bundled tools present: `ls "/Applications/L - Whisper.app/Contents/Resources/bin"` (whisper-server, whisper-cli, ffmpeg, ffprobe)? Run one by hand: `…/bin/whisper-server --help` |
| File transcription fails | `[file] … failed (code …)` + ffprobe the file manually |
| Meeting: other side silent | system-audio permission for L - Whisper (Privacy & Security → Screen & System Audio Recording / audio capture); `[meeting] … sys=-inf` the whole time |
| Meeting: your side quiet / wrong mic | menu "Recording mic: …"; log `[meeting] microphone: …`; watchdog switches after ~4 s once the call opens its mic |
| AI summary: "not found" / "isn't signed in" / usage limit | Settings → AI summary status line + Test; log `[ai] …`. Installed app has no Terminal PATH → find-cli searches `~/.local/bin`, Homebrew, npm/nvm, then `zsh -lc 'whence -p claude'`; else Choose…. Sign-in: user runs `claude` (or `codex`) once in Terminal |
| Meeting: file missing after crash | look for `.part.m4a` in `~/Documents/L - Whisper Library/` (or the old `L - Whisper Recordings/` if the one-time move failed — log `[library] could not move`); next launch recovers it |
| Tools missing or broken in the app | Bundled programs are built by `npm run build:tools` (sources in `.deps/`). Rebuild them, then `npm run install-app`. Homebrew upgrades no longer affect the app |

## 5. After fixing
Follow the `update-app` skill (task file → test → `npm run install-app` → user verifies → notes → commit). Add new traps to `docs/GOTCHAS.md`.
