---
name: test-app
description: Use to test or verify L - Whisper (dictation, file transcription, UI, paste, permissions) WITHOUT disturbing the user — fake microphone, dry paste, DevTools screenshots of the window. Use before installing any change.
---

# Testing L - Whisper safely

**Hard rule:** tests must never type, paste or press keys in the user's apps, and never use their real microphone/speakers unless they asked. The user wears a headset, so `say` through speakers does NOT reach the mic.

Only one copy can run (dev and installed app share a lock). Before a dev test:
```bash
osascript -e 'tell application "L - Whisper" to quit'; pkill -f "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"  # run from the project folder
```
Afterwards, restart the installed app: `open "/Applications/L - Whisper.app"`.

## Unit tests
```bash
npm test          # gestures, dictation, transcript formats, library, models, AI summary (66 tests, .ts via tsx)
npm run typecheck # TypeScript check;  npm run lint  # ESLint
```

## Whisper engine alone (no Electron)
```bash
npx tsx scripts/test-whisper.ts [file.wav]   # starts whisper-server, transcribes twice, stops
```

## Dictation pipeline (fake mic, no real paste)
```bash
WHISPER_FAKE_MIC=samples/test-speech.wav WHISPER_RECORD_TEST=6 npm start > /tmp/app.log 2>&1 &
# wait for "[paste]" in the log, then read "[dictation] … ms: \"text\""
```
- `WHISPER_RECORD_TEST=N` records N s after launch → transcribes → **dry** paste (clipboard only, no ⌘V).
- `WHISPER_RECORD_TEST_REPEAT=4` repeats (mic start delay cold vs warm).
- `WHISPER_KEEP_AUDIO=1` keeps `samples/last-recording.wav` (check loudness: `ffmpeg -i f.wav -af volumedetect -f null -`).
- `samples/silence.wav` should give empty text (VAD).
- Sounds: log shows `[sound] start` → `[sound] done` (speech) or `[sound] none` (silence). The user will hear them in their headset — tell them first.
- Fake mic loops the file — an extra repeated word at the end is expected.

## Meeting recording (system audio + mic)
System-audio permission belongs to the app that launches the helper, so test **inside the installed app**, never from a terminal:
```bash
npm run install-app
osascript -e 'tell application "L - Whisper" to quit'; sleep 3
open -n --env WHISPER_MEETING_TEST=20 --stdout /tmp/m.log --stderr /tmp/m.log "/Applications/L - Whisper.app"
# when "[meeting] started" appears: afplay -v 0.3 samples/test-speech.wav   (user hears it — tell them)
# wait for "[meeting] saved …"; check: ffprobe (mono), ffmpeg → 16 kHz wav → whisper-cli (speech present, no invented words)
```
Log shows `microphone: <device>`, per-second `mic=… sys=…` dB, `saved … (N s, MB)`. Delete test files from `~/Documents/L - Whisper Library/` afterwards and `open` the app normally.
Crash test: `pkill -9 -f "L - Whisper.app/Contents/MacOS/L - Whisper$"` mid-recording → `.part.m4a` must be playable → next launch makes "(recovered)".
Following a call's mic needs a real call — ask the user.

## Library page (meetings + files)
**Never test in the user's real Library.** Run dev with a stand-in Documents folder and its own data folder (then the installed app can keep running — separate single-instance lock):
```bash
T=<scratch folder>; mkdir -p "$T/docs/L - Whisper Recordings" "$T/userdata"
cp "$HOME/Library/Application Support/L - Whisper/settings.json" "$T/userdata/"   # skips first-run setup
cp -R "$HOME/Documents/L - Whisper Library/<a small meeting>" "$T/docs/L - Whisper Recordings/"  # a COPY — tests the one-time move too
WHISPER_USER_DATA="$T/userdata" WHISPER_DOCUMENTS_DIR="$T/docs" npm start -- --remote-debugging-port=9222 > "$T/app.log" 2>&1 &
```
Log: `[library] moved … → … L - Whisper Library`. File items: `eval:startFile('<copy of samples/x.mp4>')` → `#libraryNote` shows → `#openLibraryItem` click. Missing original: move the source file away, `openItem(id)` → `#mMissing` visible, `#mPlayer` hidden, `#mTranscribe` disabled.
AI summary (task 26) in the same stand-in setup: unit tests use **fake CLIs** (`test/ai.test.ts`) — never the real AI. A real check sends text to the user's subscription, so keep it to the test copies: Settings `#aiProvider` → 'claude' (change event) → `#aiTest` click → `#aiTestResult`; `openItem(id)` → `#mSummarize` click → log `[library] saved the claude summary` → `<item>/<base>.summary.md`. Cancel: `#mSummaryCancel` while `#mSummaryBusy` shows.
`eval:showPage('library')`, `eval:openItem('<folder name>')`, `eval:showLibraryList()`, mute before playing (`audio.muted=true; audio.play()`), check seeking with `print:[audio.currentTime, audio.readyState, audio.error]`. Transcribe by clicking `#mTranscribe` (writes real files into that meeting's folder). Rename/delete tests: make a throwaway folder (`ZZ Test meeting/ZZ Test meeting.m4a`) and remove it after; Delete opens a native dialog (user test).

## Window / UI (screenshots without screen-recording permission)
```bash
npm start -- --remote-debugging-port=9222 > /tmp/app.log 2>&1 &
npx tsx scripts/ui-check.ts <outDir> light \
  "eval:startFile('$PWD/samples/long-speech.mp3')" wait:9000 shot:done \
  "eval:showPage('settings')" shot:settings dark shot:settings-dark
```
Steps: `shot:<name>`, `eval:<js in the page>`, `print:<js>` (logs the value), `wait:<ms>`, `dark`, `light`. `UI_TARGET=recorder/recorder.html` connects to the hidden recorder window instead (e.g. `print:sfx && sfx.state` → `"running"` means sounds can play). Useful page functions: `startFile(path)`, `showPage('transcribe'|'dictation'|'settings')`, `showSaved(path)`, buttons `#newBtn #cancelBtn #copyBtn #saveBtn`. Shrink before viewing: `sips -Z 700 f.png --out f.png`. Only use the debugging port for tests — relaunch without it after.

## Release DMGs (`npm run release`) as a brand-new user
Mount (`hdiutil attach -nobrowse -readonly <dmg>`), check contents + `Info.plist` (id `com.dologics.lwhisper`, version, copyright, min 14.2) + `codesign --verify --deep --strict`. Then `ditto` the app out, run its binary with `WHISPER_USER_DATA=<scratch>` and `--remote-debugging-port=9223` (ui-check uses 9222 — make a copy with the port changed), go through setup, download **tiny**, transcribe `samples/test-speech.wav`, read `#aboutBox`. The x64 DMG runs under Rosetta (works; speed not representative). The real Gatekeeper "Open Anyway" flow only happens for downloaded (quarantined) files — user/friend test.

## First-run setup (brand-new user, without touching the real settings)
```bash
WHISPER_USER_DATA=<scratch folder> npm start -- --remote-debugging-port=9222 > <log> 2>&1 &
```
Separate settings.json + single-instance lock (can run next to the installed app). Dev models still come from the project `models/` (hide `ggml-large-v3-turbo.bin` to test the no-model case). Page functions: `setupShown`, `api.setup.goTo(n)`, click `#setupNext` / `#setupBack`, `#runSetup` in Settings. Check `#hotkeyCard` / `#modelsCard` parents (setup slots while open, Settings `.content` after). Real Allow buttons / prompts = user test in the installed app (Settings → Run setup again).

## Dictation key (Settings → Dictation key)
Matcher + gestures are unit-tested (`test/hotkey.test.ts`, `test/hotkey-gesture.test.ts`). In dev (debug port): set `#hotkeyKind` / `#hotkeyA` / `#hotkeyB` and dispatch `change`; check `.hotkey-label` texts and `hotkey` in settings.json. **Set it back to the user's key (Fn) afterwards** — settings are shared with the installed app. Real key presses = user test, in the installed app (dev Electron has no Input Monitoring): Settings → Test → hold the key → lamp turns green.

## Models page (Settings → Whisper models)
Dev downloads go to the project `models/` (git-ignored). With the debugging port: rows are `[data-model="<id>"]`; click `.btn.primary` (Download / Use), `.btn` (Cancel / Delete — Delete opens a native dialog = user test). Progress text: `[data-model="tiny"] .model-progress .hint`. Use **tiny** (78 MB) for real download tests and delete it afterwards (`rm models/ggml-tiny.bin`), then switch back to the user's model (`large-v3-turbo`) so the shared `activeModel` stays valid for the installed app. Downloader logic (resume, checksum, cancel) is covered by `npm test` with a local server.

## Test files (`samples/`, not in git)
`test-speech.wav` (7 s), `long-speech.mp3` / `long-speech.mp4` (45 s, mp4 has video), `no-audio.mp4` (no sound → error), `silence.wav`. Regenerate with `say -o x.aiff "…"` + ffmpeg if missing.

## Clipboard checks
Save and restore the user's clipboard around any test that touches it:
```bash
export LANG=en_US.UTF-8; pbpaste > /tmp/clip.txt; …test…; pbcopy < /tmp/clip.txt
```
Swift helper directly (careful — see GOTCHAS about Input Monitoring prompts): `(sleep 0.5; echo "paste-dry $(printf 'x' | base64)"; sleep 1) | ./bin/arm64/fn-listener` → `pasted`. `echo status` → `status input=1 accessibility=1`.

## What only the user can test
Holding/tapping the real Fn key, real speech, real ⌘V into apps, native Open/Save dialogs, real drag-and-drop, macOS permission prompts, behaviour after a restart.
