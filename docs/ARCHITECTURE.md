# L - Whisper — Architecture

A macOS menu bar app (Electron + Node.js, written in **TypeScript**) that runs OpenAI Whisper **locally** (whisper.cpp on the GPU) for:

1. **Dictation** — hold the dictation key (Fn, or two modifiers like ⌃⌥ — chosen in Settings; double-tap for hands-free) → speak → text is pasted where the cursor is.
2. **File transcription** — drop an audio/video file in the window → timestamped transcript → Copy / Save; also saved to the Library automatically (the file itself is never copied).
3. **Meeting recording** — audio only: your mic + everything the Mac plays → `~/Documents/L - Whisper Library/<meeting>/<meeting>.m4a` (no automatic transcription).
4. **Library page** (task 25, was the Meetings page) — meetings **and** transcribed files, newest first (All / Meetings / Files): play (meeting audio or a file item's original), transcribe (Auto/English/Urdu, translate to English) → `.txt/.srt/.vtt/.json` in the item's folder; rename, delete (Trash), show in Finder, copy.

5. **AI summary** (task 26) — on click, a Library item's transcript text is summarized by the user's own **Claude Code** or **Codex** CLI (their subscription) → `<name>.summary.md` beside it.

Named after L from Death Note (renamed from "Whisper Desktop" in task 12; bundle ID and signing cert kept the old names on purpose).

Built for macOS 14.2+, as **two builds**: Apple Silicon (arm64, whisper.cpp on Metal) and Intel (x64, whisper.cpp on CPU + Accelerate). **Self-contained** since task 18: whisper.cpp, ffmpeg/ffprobe and the VAD model ship inside the app (no Homebrew needed). The big Whisper model is not shipped — it lives in the app data folder.

---

## 1. Processes at runtime

```
L - Whisper.app (Electron main process, src/main/main.ts → WhisperApp in app.ts)
├── Main window            renderer: src/renderer/*        (sidebar UI: Transcribe File / Library / Dictation / Settings)
├── Hidden recorder window renderer: src/recorder/*        (microphone → 16 kHz WAV)
├── whisper-server         Resources/bin (bundled)          (model kept loaded; used by DICTATION)
├── fn-listener            native/fn-listener.swift → bin/  (modifier keys held + paste + permission status)
├── (while recording) meeting-recorder  native/meeting-recorder.swift → bin/  (mic + system audio → PCM)  ──► ffmpeg (mix + encode .m4a)
└── (on demand) ffprobe, ffmpeg, whisper-cli   Resources/bin (FILE transcription, one run per file)
```

## 2. File map

| File | Role |
|---|---|
| `src/main/main.ts` | Entry point: what must happen before Electron is ready (`library://` scheme, fake-mic switches, single-instance lock), then `new WhisperApp()` |
| `src/main/app.ts` | `WhisperApp` — the app's wiring: tray menu, main window, state pushed to the window, settings changes, dictation/meeting handlers, startup + dev test modes, quit |
| `src/main/ipc.ts` | `registerIpc()` — every request the window can make (`ipcMain.handle`) |
| `src/main/system-settings.ts` | `openSystemSettings(kind)` — opens the Privacy pane for a permission, or Keyboard |
| `src/main/about.ts` | Credits in one place ("© DoLogics · MIT License", repo link, "Built by Mohsin Shoaib", version): macOS About window (tray → About L - Whisper) + the About page in the sidebar |
| `src/main/dev-overrides.ts` | Imported first by main.ts: `WHISPER_USER_DATA` (separate data folder incl. the installed app's models — fresh-user tests), `WHISPER_DOCUMENTS_DIR` (stand-in ~/Documents → test Library, never the user's) |
| `src/main/paths.ts` | Where models, Swift helpers and the Library live (dev vs packaged); `LIBRARY_DIR` + `OLD_RECORDINGS_DIR` |
| `src/main/library-protocol.ts` | `library://audio/<id>` for the player, with byte ranges (seeking): a meeting's .m4a, or a file item's original — only the exact path in its `item.json` |
| `src/main/util.ts` | Small shared helpers: `sleep`, `errorMessage`, `run` (execFile → stdout), `onLines` |
| `src/main/whisper.ts` | `WhisperEngine` — starts/stops `whisper-server` on a free localhost port, `transcribe(wav)` via HTTP, auto-restart on crash. Plain Node (testable without Electron) |
| `src/main/recorder.ts` | `MicRecorder` — controls the hidden recorder window, mic permission, saves WAVs to `$TMPDIR/whisper-desktop/` |
| `src/main/dictation.ts` | `Dictation` — one dictation start→stop→transcribe; skips < 0.3 s, 300 ms tail after release, serialises recordings. Tested in `test/dictation.test.ts` |
| `src/main/hotkey.ts` | The dictation key: `HotkeyMatcher` (held modifiers → `down` / `up` / `combo` for Fn or a two-key combo), `parseHotkey` (validation), `hotkeyLabel` ("fn", "⌃⌥"). Tested in `test/hotkey.test.ts` |
| `src/main/hotkey-gesture.ts` | `HotkeyGesture` — pure state machine: hold / tap / double-tap / key+other key. Tested in `test/hotkey-gesture.test.ts` |
| `src/main/key-listener.ts` | `KeyListener` — runs the Swift helper, parses its stdout (`mods …`, `key`, status), `paste(text)`, `requestPermissions()` (typed events) |
| `src/main/speakers.ts` | Speaker labels (task 27): `channelLevels()` (who is talking each 30 ms, each side vs its own speech level, first talker keeps an overlap), `assignSpeakers()` (word → side, split segments), `dtwPreset()`. Tested in `test/speakers.test.ts` |
| `src/main/file-transcriber.ts` | `FileTranscriber` — ffprobe info → ffmpeg to WAV → whisper-cli with progress + JSON segments; meetings with the Speakers track → DTW word times + `speakers.ts` → `speaker` per segment; cancel; temp cleanup |
| `src/main/meeting.ts` | `MeetingRecorder` — runs meeting-recorder | ffmpeg, start/stop, timer, levels, mic name, crash recovery (`recover()`); `recordArgs()` = Mix + hidden Speakers track |
| `native/meeting-recorder.swift` | Core Audio **process tap** (all system audio) + the **call's mic** in a private aggregate device; follows mic switches (2 s watchdog); resamples to 48 kHz; stereo PCM on stdout (L = you, R = others) |
| `src/main/ai/find-cli.ts` | Finds `claude` / `codex` without the Terminal's PATH: hand-picked path → `~/.local/bin`, `~/.claude/local`, Homebrew, npm/bun/volta/nvm folders → login shell `whence -p` (real file, never a shell function). Tested in `test/ai.test.ts` |
| `src/main/ai/summarizer.ts` | `Summarizer.ask(provider, cli, prompt)` — spawns the CLI (no shell) in an empty temp folder, prompt on stdin, tools off, 5-min timeout, cancel; claude `-p --output-format json` (`is_error`/`result`), codex `exec … --output-last-message`; `friendlyError` (not signed in / usage limit). Tested with fake CLIs |
| `src/main/ai/prompt.ts` | The summary instructions (simple English, third person, Summary / Key points / Action items / Open questions) |
| `src/main/ai/ai-summary.ts` | `AiSummary` — settings (`aiProvider`, `aiCliPath`) + status + Test + `summarize(id)` (Library transcript → Summarizer → `saveSummary`) |
| `src/main/user-name.ts` | `cleanUserName()` — the optional "Your name" setting (task 28) made safe: one line, no `:`, max 40. Tested in `test/user-name.test.ts` |
| `src/main/transcript-formats.ts` | Segments `{start,end,text}` → `txt` (`[mm:ss] text`), `srt`, `vtt`, `json`. Used by Copy / Save (and meeting transcripts). Tested in `test/transcript-formats.test.ts` |
| `src/main/library.ts` | `Library` — one folder per item (meeting or file) with `item.json`: `prepareLibraryDir()` (one-time move of the old folder), `migrate()` (loose files → folders), `list()` (newest first, ffprobe duration cached; writes `item.json` for old meetings), `get()`, `rename()` (folder + files), `transcribe()` (meeting audio or the file's original → txt/srt/vtt/json), `createFromFile()`, `audioPath()`, `readSavedFile()` (Files tab: only txt/srt/vtt/json/summary of that item, big files cut at 2 MB); ids are checked to stay inside the library folder. Tested in `test/library.test.ts` |
| `src/main/settings.ts` | JSON settings in the app data folder (`language`, `sounds`, `launchedBefore`, `activeModel`, `hotkey`, `onboarded`, `setupStep`), typed get/set |
| `src/main/models/catalog.ts` | The 6 offered Whisper models (tiny … large-v3-turbo): file, exact size, **SHA-256** (from the official repo), note; `recommendedModelId(RAM)` |
| `src/main/models/model-store.ts` | `ModelStore` — what's in the models folder (downloaded / `.part` / missing), the active model (`settings.activeModel`), `setActive`, `delete` (not the active one), `migrate()` (existing file → active). Tested in `test/model-store.test.ts` |
| `src/main/models/model-downloader.ts` | `ModelDownloader` — the app's **only network access**: free-space check → `<file>.part` with progress → **resume** via HTTP Range → SHA-256 check → rename; cancel keeps the `.part`. Tested against a local server in `test/model-downloader.test.ts` |
| `src/shared/types.ts` | **Types only**: settings, app state, transcripts, meetings, IPC replies (`Outcome`), and the window APIs (`WhisperAppApi`, `RecorderBridge`). Used by main, preloads and both windows |
| `src/preload/preload.ts` | The **only** API the main window can call (`window.whisperApp.*`); `satisfies WhisperAppApi` checks it against the shared types |
| `src/preload/recorder-preload.ts` | IPC bridge for the hidden recorder window (`satisfies RecorderBridge`) |
| `src/recorder/recorder.ts` + `recorder-worklet.ts` | getUserMedia → AudioContext(16 kHz, prepared once, suspended while idle) → AudioWorklet → WAV encoder. Also generates the feedback sounds (`playSound`, separate AudioContext). `globals.d.ts` = types for `window.recorder` + the worklet scope |
| `src/renderer/index.html`, `renderer.ts`, `styles.css` | Main window UI (follows system light/dark). `globals.d.ts` = types for `window.whisperApp`. Design source: `design/mockup.html` |
| `native/fn-listener.swift` | Swift helper (file name kept so macOS keeps its permissions): CGEventTap (listen-only) → `mods fn,control,…` on every modifier change, `key` when a normal key is pressed **while a modifier is held** (no key code); `paste`/`paste-dry` (NSPasteboard save → ⌘V → restore); `status`; `ask-accessibility` (first-run setup: macOS prompt + lists the app) |
| `scripts/install-app.sh` | Build (arm64) → sign → install to /Applications on this Mac (`npm run install-app`) |
| `scripts/release.sh` | `npm run release`: for arm64 and x64 — electron-builder `dir` → `sign-app.sh` → check every program's chip type (`lipo`) → `hdiutil` DMG (app + Applications shortcut + `scripts/dmg/how-to-open.txt`) → `dist/release/` + SHA-256 file |
| `scripts/sign-app.sh` | Signs an app: certificate "Whisper Desktop Local", ids `com.dologics.lwhisper` (+ `.helper`, `.meeting`, `.<tool>`) — keep stable (permissions) |
| `scripts/build-native.sh` | `npm run build:native`: both Swift helpers for arm64 + x64, target macOS 14.2 (process tap) |
| `scripts/build-whisper.sh` | `npm run build:tools` (1/2): whisper.cpp **v1.9.5** (pinned) → static `bin/<arch>/whisper-server` + `whisper-cli` (arm64: Metal, shaders embedded; x64: CPU + Accelerate, AVX2/FMA/F16C; macOS 14+, any Apple Silicon); also fetches the VAD model (checksum pinned). Source in `.deps/` (git-ignored) |
| `scripts/build-ffmpeg.sh` | `npm run build:tools` (2/2): FFmpeg **9.0.2** (pinned + checksum) → static **LGPL** `bin/<arch>/ffmpeg` + `ffprobe` (x64 cross-compiled, no x86 asm); only system zlib; all decoders/filters, encoders aac + pcm_s16le only; refuses a GPL build |
| `scripts/build.ts` | `npm run build`: TypeScript → `build/` (3 tsc projects) + copies HTML/CSS |
| `scripts/ui-check.ts` | Drives the window over DevTools protocol, saves screenshots (testing) — `npx tsx scripts/ui-check.ts` |
| `scripts/test-whisper.ts` | Terminal test of `WhisperEngine` — `npx tsx scripts/test-whisper.ts` |
| `scripts/make-tray-icon.ts` | Generates the waveform menu bar icon `assets/trayTemplate*.png` |
| `scripts/make-app-icon.sh` + `make-app-icon.swift` | Renders the app icon (white bold-Fraktur 𝕷 on near-black) → `assets/icon.icns` |
| `CHANGELOG.md` | What changed per version (plain words); `## Unreleased` collects finished tasks until the next release |
| `docs/beta-tester-checklist.md` | Checklist sent to friends with the DMGs (task 24) |
| `tasks/` (local only, git-ignored) | The maintainer's task notes: measurements and decisions per task. "Task NN" in these docs refers to them; `CHANGELOG.md` has the public summary |

## 2b. Build (TypeScript → build/)

```
src/ (TypeScript)  ──npm run build (scripts/build.ts)──►  build/ (JavaScript Electron runs)
  tsconfig.build.json          src/main, src/preload, src/shared → build/main, build/preload, build/shared  (CommonJS)
  src/renderer/tsconfig.json   renderer.ts → build/renderer/renderer.js   (plain browser script)
  src/recorder/tsconfig.json   recorder.ts + recorder-worklet.ts → build/recorder/  (plain browser scripts)
  + index.html, styles.css, recorder.html copied
```
- `package.json` `main` = `build/main/main.js`; electron-builder packages `build/**` + `assets/**`. `build/` is git-ignored.
- `npm start` and `npm run install-app` build first. Tests and scripts run the `.ts` files directly with **tsx** (no build).
- The two window scripts are compiled as **plain scripts** (no `import`): their top-level functions stay global, which `scripts/ui-check.ts` relies on (`showPage`, `startFile`, `openMeeting`, `audio`, `sfx`…). Their types come from `globals.d.ts` (`import('../shared/types')` type references only).
- Checks: `npm run typecheck` (all 3 projects + tests/scripts), `npm run lint` (ESLint + typescript-eslint), `npm run format` (Prettier: single quotes, 120 columns; HTML/CSS/Markdown left alone).

## 3. Dictation flow

```
keys ──► fn-listener (Swift) ──"mods …" / "key"──► KeyListener ──► HotkeyMatcher ──down/up/combo──► HotkeyGesture
                                                    (chosen key: settings.hotkey)  └──► window (Settings key test)
                                                                                   │ onStart / onStop / onCancel
                                                                                   ▼
                       hidden recorder window ◄── MicRecorder ◄──────────────── Dictation
                       (mic → 16 kHz WAV)  ──► temp WAV ──► WhisperEngine ──► whisper-server (HTTP, VAD on)
                                                                                   │ text
                                                                                   ▼
                       fn-listener "paste <base64>" ◄── KeyListener.paste ◄── WhisperApp.onText (+ history)
                       (save clipboard → ⌘V → restore after 0.5 s)
```

- Gestures: hold ≥ 300 ms = push-to-talk; double-tap ≤ 500 ms = hands-free; tap = stop hands-free; single tap or key+other key = cancel.
- Dictation key (task 20): `settings.hotkey` = `{kind:'fn'}` (default) or `{kind:'combo', keys:[a,b]}` from ⌃ ⌥ ⇧ ⌘. **Down** = exactly those keys held (no extra modifier; three modifiers like ⌃⌥⌘ never trigger); **up** = one released; **combo** = another key/modifier while held (a shortcut like ⌃⌥T → cancel, the shortcut still works). Settings → Test: key events only light the lamp, no dictation (auto-off 20 s). Fn chosen + macOS 🌐 setting not "Do Nothing" (`AppleFnUsageType` ≠ 0) → hint in Settings.
- Tray title: ` ●` recording (only once mic is live), ` ● hands-free`, ` …` transcribing.
- Sounds (if Settings → Sounds is on): rising **start** beep when the mic is live, falling **done** beep after paste, low **none** note when nothing was heard. A quick tap/Fn+key never beeps (Dictation only reports "recording" if not cancelled meanwhile).

## 4. File transcription flow

```
renderer (drop / Choose File…) ──IPC file:transcribe──► FileTranscriber
   ffprobe (duration, has audio?) → ffmpeg → 16 kHz WAV (progress 0–10 %)
   → whisper-cli -pp -oj --prompt "…" (progress 10–100 %) → JSON segments
   ──► result {segments[{start,text}], durationSec, elapsedMs, language} ──► renderer + recentFiles
   ──► Library.createFromFile(path, result) → <Library>/<file name>/ transcripts + item.json {kind:'file', source}
       (the file is NOT copied or moved) → libraryId → "✓ Saved to Library — Open"
```

## 4b. Meeting recording flow

```
menu "Start Meeting Recording" → MeetingRecorder.start()
  meeting-recorder (Swift): mic the call uses (else default) + process tap → 48 kHz stereo PCM
  └─► ffmpeg: you: highpass 80 Hz + afftdn denoise + dynaudnorm │ others: dynaudnorm
             → track 1 "Mix": amix → limiter → mono AAC 64 kbps (default, what you hear)
             → track 2 "Speakers (L mic, R system)": the raw input as stereo AAC (hidden, task 27)
             → fragmented "Meeting <date>.part.m4a" (5 s fragments)
menu "Stop" → helper stops → ffmpeg ends → remux `-map 0` (no re-encode, keeps both tracks) → "Meeting <date>.m4a" + notification
transcribe a meeting → Speakers track found (handler_name) → whisper-cli on the Mix with DTW word times
             (-nfa -dtw <preset> -ojf) + the Speakers track as 8 kHz stereo → speakers.ts: each word goes
             to the side talking at that moment (who was talking first keeps an overlap) → segments split
             where the speaker changes → mic = your name / "Speaker 1", system = "Speaker 2"
crash → .part.m4a stays playable → next launch: recover() → "… (recovered).m4a"
```
- Menu bar: ` ◉ 12:34` (dictation ●/… takes priority while active); menu shows "Recording mic: <device>".
- Mac kept awake (`powerSaveBlocker`), quit during recording saves first, < 1 GB free disk refuses to start.

## 4c. Library page (meetings + transcribed files)

```
renderer (Library page) ──IPC library:list/get/rename/delete/reveal/transcribe/cancel──► main ──► Library
<audio src="library://audio/<id>">  ──► protocol.handle('library') ──► byte-range stream of
      meeting → <item>/<item>.m4a      file → item.json "source" (that exact path only; gone → 404)
transcribe: FileTranscriber.transcribe(audio or source, onProgress, {language, translate}) → formats → <item>/<base>.{txt,srt,vtt,json}
   <base> = the meeting audio's name, or the folder name for a file item

<Library>/<id>/item.json  {version:1, kind:'meeting'|'file', createdAt, source?, durationSec?}
start: prepareLibraryDir(LIBRARY_DIR, OLD_RECORDINGS_DIR) before MeetingRecorder/Library are created:
   only old exists → rename (instant) · both → use new (an EMPTY old one is removed, otherwise left alone) · rename fails → keep old
```
- `library:changed` is sent after start/stop/file transcribed/rename/delete/transcribe → the list refreshes.
- A meeting without `item.json` (recorded before task 25, or just now) gets one when the list is read. A damaged `item.json` is never overwritten.
- File item whose original is gone: transcript still shown/copyable, "Original file not found" note, player hidden, Transcribe disabled. Delete trashes only the item folder — never the original (the dialog says so).
- Formats Chromium can't play (mkv, avi, wma…) → "Can't play this format here" under the player; transcription still works (ffmpeg).
- Tray "Open Library" shows the window on the Library page (was "Show Meeting Recordings" → Finder).
- The meeting being recorded shows as "● Recording…" (not openable). Delete uses a native confirmation + `shell.trashItem` (recoverable).
- Urdu transcripts are shown right-to-left. One transcription at a time (shared with the Transcribe File page).

## 4c-2. AI summary (task 26)

```
Library detail → Summarize ──IPC library:summarize──► AiSummary.summarize(id)
   provider 'off' / CLI not found → {needsSetup} → window opens Settings → AI summary (nothing sent)
   Library.transcriptText(id)  (segments' text, no timestamps)
   → Summarizer.ask(provider, cli, buildSummaryPrompt(text, title))
        spawn(cli, args) cwd = empty temp folder, stdin = prompt, PATH += cli's folder + Homebrew
        claude: -p --output-format json --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence
        codex:  exec --skip-git-repo-check --sandbox read-only --color never --output-last-message <tmp> -
   → Library.saveSummary → <item>/<base>.summary.md (tmp + rename) + item.json summary {provider, createdAt}
```
- Settings → AI summary: Off (default) / Claude Code / Codex; status (path + version), **Choose…** (hand-picked program), **Test** ("Reply with exactly: OK"), privacy line naming Anthropic / OpenAI.
- Detail view: AI summary card — Summarize / Regenerate, Copy, Cancel while running, "from an older transcript" note when `transcribedAt` (transcript .json) is newer than the summary. List rows get a **Summary** tag. Markdown shown with a tiny DOM renderer (headings, bullets, numbered, **bold**) — never as HTML.
- Not `--bare` for claude: it skips the keychain, where the subscription login lives. Claude uses the user's default model (claude 2.1.309: ~4 s for Test, ~6 s for a 45 s transcript).

## 4d. Whisper models (Settings → Models)

```
Settings → Download ──IPC models:download──► WhisperApp.downloadModel ──► ModelDownloader (fetch, Range, SHA-256)
   progress ◄── models:progress (every 250 ms) ──┘          │ done
                                                           ▼
                        ModelStore.setActive → settings.activeModel → engine.setModel() → whisper-server restarts
File / meeting transcription read the active model per run (FileTranscriber.getModelPath).
```
- No model shipped. First start of task 19: an existing `ggml-large-v3-turbo.bin` is made active (`migrate()`).
- No active model → footer "No model — see Settings"; Fn opens Settings (soft "none" note, at most every 5 s); file/meeting transcription answer "Choose a Whisper model first".
- Switching is refused during a dictation or transcription. Delete asks first (native dialog) and refuses the active model.
- Source: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>` (same as whisper.cpp's own download script).

## 4e. First-run setup

```
start: models.migrate() → existing install (launchedBefore + a model) → onboarded = true (no setup)
!onboarded → window shown with a full-window overlay (index.html #setup), page = settings.setupStep
  0 Welcome → 1 Permissions (Allow buttons, re-checked every 1 s) → 2 Dictation key → 3 Model → 4 Done (try-it box)
  pages 2/3 MOVE the Settings cards (#hotkeyCard, #modelsCard) into the overlay; closing puts them back
Finish → onboarded = true · Settings → "Run setup again" → onboarded = false, page 0
```
- Every page change is saved (`setupStep`), so quitting midway resumes there. Next on the Model page needs an active model.
- Allow: microphone → macOS prompt (or its pane if denied before); Input Monitoring → pane (the helper already asked at start); Accessibility → helper `ask-accessibility` + pane. "Recording other apps' audio" can't be checked by apps — shown as optional; macOS asks at the first meeting recording.
- Dev: `WHISPER_USER_DATA=<folder> npm start` = separate settings + single-instance lock (see test-app).

## 5. Where data lives

| What | Where | Persisted? |
|---|---|---|
| Settings | `~/Library/Application Support/L - Whisper/settings.json` | yes |
| Whisper models (installed app) | `~/Library/Application Support/L - Whisper/models/` (downloads; `<file>.part` while downloading) | yes |
| Active model | `settings.json` → `activeModel` (id from the catalogue) | yes |
| VAD model (installed app) | inside the app: `Resources/models/ggml-silero-v5.1.2.bin` | shipped |
| Programs (installed app) | inside the app: `Resources/bin/` (Swift helpers, whisper-server/cli, ffmpeg/ffprobe — only that build's chip) | shipped |
| Programs (dev) | `bin/arm64/`, `bin/x64/` (git-ignored, built by `build:native` / `build:tools`) | rebuilt |
| Models (dev) | `models/` in the project | yes, not in git |
| Recent dictations / recent files | memory only (max 20 / 10) | **no — by design (privacy)** |
| Recordings / extracted audio | `$TMPDIR/whisper-desktop*/` | deleted after use |
| Saved transcripts | wherever the user saves (default `~/Documents`) | yes |
| Library: meetings | `~/Documents/L - Whisper Library/<meeting>/` — audio (`.part.m4a` while recording) + transcripts `.txt/.srt/.vtt/.json` + `item.json` | yes |
| Library: transcribed files | `~/Documents/L - Whisper Library/<file name>/` — transcripts + `item.json` (points at the original; no audio copy) | yes |
| AI summaries | `<item>/<base>.summary.md` (+ `item.json` → `summary`) — only after the user clicks Summarize | yes |
| AI summary settings | `settings.json` → `aiProvider` ('off' / 'claude' / 'codex'), `aiCliPath` (only if chosen by hand) | yes |

## 6. Key decisions (don't undo without asking the user)

| Decision | Why |
|---|---|
| Electron + Node, macOS only | User's choice (task discussion) |
| **TypeScript (strict)**, built with plain `tsc` (no bundler); window scripts compiled as plain scripts | User's choice for open-sourcing (task 17); no bundler keeps the output readable and the page functions reachable for UI tests |
| whisper.cpp + ffmpeg **bundled in the app** (built from pinned sources), no Homebrew | So the app installs on other Macs with nothing else (task 18; replaced task 11's Homebrew choice). Our own ffmpeg build is **LGPL** (Homebrew's is GPL) so the project can use a permissive licence |
| Models **downloaded in the app**, not shipped; user picks the **active** model (tiny … large-v3-turbo), switchable any time | User's choice (task 19). Multilingual models only (Urdu). Recommended: Large v3 Turbo compact (q5, 547 MB), Small on < 8 GB Macs. The user's own choice: `large-v3-turbo` (best quality, ~1 s for 7 s of English on M1 Pro) |
| One network exception: model downloads (official repo, SHA-256 checked, resumable) | User-approved exception to "everything local" (task 19); audio never leaves the Mac |
| Second exception: **AI summary** via the user's own **Claude Code / Codex CLI** (their subscription, no API keys), only on click, default Off, text only, tools off | User's choice (task 26). Desktop apps (Claude/Codex) can't be called by other apps; their CLIs use the same subscription |
| **Swift helper** for keys + paste | Electron can't see the Fn key or hold/release of modifiers; NSPasteboard can save/restore *all* clipboard formats |
| Dictation key = **Fn or exactly two modifiers** (no letters/F-keys) | User's choice (task 20): modifiers type nothing, so the helper stays **listen-only** (never blocks keys). Helper reports modifier sets; the TypeScript side decides — changing the key needs no Swift rebuild |
| Dictation via **whisper-server**, files via **whisper-cli** | Server keeps model loaded (fast dictation); CLI gives progress + timestamps |
| **VAD on for dictation, off for files** | VAD stops "Thank you." hallucinations on silence; on files it dropped whole phrases |
| `--prompt "Hello. Welcome, everyone."` for files | Without it, timestamp mode returned lowercase/no punctuation |
| Language sent **per request** | Switching is instant; English ≈ 2× faster than auto |
| History **memory-only** | Privacy default; persisting history is an open question for the user |
| Mic stays **off** while idle | User didn't want the mic always on; costs ~200–300 ms start delay |
| Name **"L - Whisper"**, gothic 𝕷 app icon, waveform kept in the menu bar | User's choice (task 12); waveform says what the app does |
| Feedback sounds generated with Web Audio (sine, ~10 % volume), no files | Soft and tweakable in code (`SOUNDS` in `src/recorder/recorder.ts`); user approved (task 13) |
| Meeting: **process tap** for system audio (not BlackHole, not Screen Recording) | One permission, any app, any output device (task 14) |
| Meeting: record **the mic the call uses**, follow switches | User switches between Mac mic, headset, hands-free; default input is often the wrong one |
| Meeting: **mono, both voices levelled** (not L/R split) for listening | User's choice — normal listening |
| Meeting: **hidden 2nd track** (raw stereo, L = mic, R = system) + **word-level** speaker assignment (DTW word times × each side's loudness) | Task 27 (user approved): labels by source — mic = your name or "Speaker 1", system = "Speaker 2". `whisper -di` was tried first and failed on a real call (one label per segment; segments held both people). Per-turn transcription was tried and rejected (invented words on short clips, 3× slower). Cost: +~29 MB/h (meetings ~58 MB/h in all), ~+20 % transcription time |
| Meeting `.txt` **without timestamps**, one paragraph per speaker turn; srt/vtt/json keep timestamps; dropped files keep timestamps everywhere | User's choice (task 27): the timed files exist for times; "Me/Other" rejected — confusing when shared |
| Meeting: mic side `highpass + afftdn` denoise, `dynaudnorm t=0.002` | Without them the leveller boosted mic hiss/room noise (user heard constant noise; Whisper invented words) |
| Meeting: fragmented .m4a while recording | Crash/power loss keeps everything up to the last ~5 s |
| Meeting: Fn dictation keeps working during a recording | My default (quick notes); user didn't object |
| **One folder per item**; transcripts saved in it in txt/srt/vtt/json | User's choice (task 16); json lets the app reload timestamps |
| **Library** = meetings + transcribed files in one page/folder (`~/Documents/L - Whisper Library`, old folder moved once); `item.json` per folder (not one central index) | User's choice (task 25). Per-folder JSON: one broken file can't break the list |
| Dropped files are **never copied or moved**; the item points at the original | User's choice (task 25): no duplicate audio. Moved original → transcript still readable, play/re-transcribe off |
| Per-meeting language **Auto / English / Urdu + Translate to English** (`whisper -tr`); no English punctuation prompt for Urdu | User's calls are often in Urdu (task 16) |
| Player audio via private `library://` protocol with range support | Window can't read arbitrary files; ranges make seeking work. A file item's original is served only by the exact path in its `item.json` |
| Waveform tray icon (not a mic) | Mic icon was confused with macOS's mic-in-use indicator |
| Self-signed cert "Whisper Desktop Local" | Stable signature → macOS keeps permissions across updates |
| **Two DMGs** (arm64 + x64), not one universal; app ID `com.dologics.lwhisper`; version 1.0.0; macOS 14.2+ | User's choice (task 22): friends on both chip types, each downloads only their own. No Apple Developer ID → one-time "Open Anyway" (explained in the DMG). Intel recommends the Small model (no GPU acceleration) |
| Credits: copyright **DoLogics** (MIT, `LICENSE`), one quiet "Built by Mohsin Shoaib" line | User's request (task 22, changed in task 23 for open source): About window, About page in the sidebar (task 31), Info.plist copyright "© 2026 DoLogics · MIT License", README footer. Third-party licences ship in `Contents/Resources/licenses/` (`THIRD_PARTY_NOTICES.md` + `licenses/`) |
| Copy/Save keep **timestamps** (txt `[mm:ss]`); Save offers txt / srt / vtt | User's request (task 15) — formats in `src/main/transcript-formats.ts` |

## 7. macOS permissions

| Permission | Needed by | Shown in Settings page via |
|---|---|---|
| Microphone | hidden recorder window, meeting-recorder | `systemPreferences.getMediaAccessStatus` |
| System audio recording ("audio from other apps") | meeting-recorder (process tap) | not shown; silence on the "others" side if missing (`NSAudioCaptureUsageDescription` in Info.plist) |
| Input Monitoring | fn-listener (see the dictation key) | helper `status` command |
| Accessibility | fn-listener (post ⌘V) | helper `status` command |

All are granted to **L - Whisper** (installed) and separately to **Electron** (dev `npm start`).
