# Gotchas — traps already hit in this project

Read before debugging. Each one cost real time once.

## Shell & tooling
| Symptom | Cause | Fix |
|---|---|---|
| A command "silently" produces no output / whisper-cli prints its help | The shell is **zsh**: `$VAR` holding several words is passed as ONE argument | Use arrays: `A=(-m x -f y); cmd "${A[@]}"` |
| `pbpaste` shows `?` instead of `✓` / Urdu | Shell has no UTF-8 locale | `export LANG=en_US.UTF-8` before `pbpaste` |
| `security import` → "MAC verification failed" | OpenSSL 4 writes `.p12` with algorithms macOS can't read | `openssl pkcs12 -export -legacy …` |
| Foreground `sleep` blocked in tool shell | Harness rule | Use polling loops with short sleeps inside one command, or background runs |
| `npx electron -e …` hangs | Electron has no `-e` flag | Don't; use the app itself or `scripts/ui-check.ts` |

## Testing
| Symptom | Cause | Fix |
|---|---|---|
| Test text appeared in the user's focused app | Test runs went through real paste (⌘V) | Test modes (`WHISPER_RECORD_TEST`) use `paste-dry`. **Never** send real ⌘V or key events in tests |
| `say` test sentence not recorded | User's audio is a **headset** (speaker = headphones) | Use `WHISPER_FAKE_MIC=samples/x.wav` instead of speakers |
| Fake mic records silence; log says "Failed to read … fake device" | Chromium audio-service sandbox can't read files | Already handled: fake-mic mode adds `--disable-features=AudioServiceSandbox` |
| Can't screenshot the screen (`could not create image from display`) | No Screen Recording permission (don't ask for it) | Screenshot the window via `npm start -- --remote-debugging-port=9222` + `npx tsx scripts/ui-check.ts` |
| First run of a freshly compiled helper ignores stdin briefly | macOS scans new binaries on first launch | Warm it up once (`(sleep 2) \| ./bin/arm64/fn-listener`) before timing-sensitive tests |
| `node --test test/` fails "Cannot find module" | Node 24 needs files/globs | `npm test` (`node --import tsx --test test/*.test.ts`) |
| UI test: the first `audio.play()` after a new source sometimes fires `pause` at 0:00 by itself | Chromium media quirk in automated runs (no app code calls pause; a second play() works, clicking ▶ works) | Check playback with events (`play/playing/pause`) and retry once; don't chase it in the app code |
| A dev test would move/fill the user's real `~/Documents/L - Whisper Library` | Dev and installed app share Documents | `WHISPER_DOCUMENTS_DIR=<scratch>` (+ `WHISPER_USER_DATA`) — see test-app "Library page" |

## Whisper
| Symptom | Cause | Fix |
|---|---|---|
| Silent recording → "Thank you." / "you" | Whisper hallucinates on silence | Dictation server runs with Silero VAD (`models/ggml-silero-v5.1.2.bin`) |
| File transcript misses a phrase; progress 133 % | VAD with whisper-cli on long files | **No VAD for files** |
| File transcript lowercase, no punctuation | large-v3-turbo in timestamp mode | `--prompt "Hello. Welcome, everyone."` |
| First-ever whisper run takes ~15 s | Metal shader compile (cached afterwards) | Normal; engine start timeout is 90 s |
| Auto language is ~0.8 s slower per dictation | Language detection pass | User can pick English in tray/Settings |
| File progress jumps 10 % → 100 % | whisper-cli reports per 30 s window | Expected; fine on long files |

## Dictation
| Symptom | Cause | Fix |
|---|---|---|
| Short phrases come back empty | Mic needs ~200–300 ms to open after Fn down | AudioContext prepared once at load; user waits for ` ●`. Don't keep the mic open (user's privacy choice) |
| Last word cut off | Audio still in pipeline at release | 300 ms tail in `dictation.ts` |
| Paste fails silently at first | Accessibility not granted | Helper replies `paste-error: accessibility…`; tooltip explains |
| Paste blocked while waiting for Input Monitoring | (old bug) permission wait blocked helper's main thread | Fixed: timer-based wait. Keep the main run loop free |

## Meeting recording
| Symptom | Cause | Fix |
|---|---|---|
| Your voice very quiet in the meeting file | Call app used another mic (hands-free) than macOS's default | Recorder picks the mic another app is using + 2 s watchdog |
| "Others" transcript is gibberish "Icelandic" | Conversation in **Urdu**, auto-detect fooled | Not a recording bug — listen to the file; use a language setting |
| Testing system audio from a terminal would ask the user to let *Claude/Terminal* record audio | Permission goes to the app that launches the helper | Test inside the installed app: `open -n --env WHISPER_MEETING_TEST=20 --stdout log --stderr log "/Applications/L - Whisper.app"` |
| Constant hiss/noise in recordings | Leveller (dynaudnorm) boosting mic noise | `t=0.002` threshold + `highpass,afftdn` on the mic side |
| Meeting transcript gives both people's words to one speaker | `whisper-cli --diarize` labels whole segments, and whisper's segments often span several turns (real call: 2 segments in 45 s) | Word-level assignment in `speakers.ts` (DTW word times) — don't go back to `-di` |
| DTW word times are all `-1` (`t_dtw`) | whisper.cpp skips DTW while flash attention is on | Pass `-nfa` with `-dtw <preset>` |
| A meeting's Speakers track vanishes after Stop | `ffmpeg -c copy` keeps only ONE audio track by default | `finalize()` uses `-map 0` |
| Track `title` set with `-metadata:s:a:1 title=…` is missing in the .m4a | The mp4/m4a muxer drops `title` | Use `handler_name` (the transcriber looks for it) |
| Bundled ffmpeg: "Requested output format 's16le' is not known" | Our LGPL build can read raw PCM but not write it | For test input write raw PCM with Python (`wave`) or use Homebrew's ffmpeg |
| `whisper-cli -f <(ffmpeg …)` fails with Broken pipe | whisper-cli can't read from a pipe | Convert to a temp .wav first |
| Swift build output says "error" | Swift 6 *warnings* contain the words "an error in the Swift 6 language mode" | Grep for `: error:` instead |

## Packaging & installed app
| Symptom | Cause | Fix |
|---|---|---|
| `npm start` exits immediately / second copy won't start | Dev and installed app share the **single-instance lock** and data folder | Quit one first (`install-app` quits both) |
| Settings written by a test aren't read | Data folder is `~/Library/Application Support/L - Whisper/` (productName), **not** `whisper-desktop` | Use the right path |
| Permissions asked again after an update | App wasn't signed with "Whisper Desktop Local" | Always use `npm run install-app` |
| Keychain asks for a password during signing | codesign needs keychain access | User's **Mac login password** + "Always Allow" (already done once) |
| Installed app logs nowhere | GUI apps' stdout is discarded | Run the binary from a terminal (see `troubleshoot-app` skill) |
| Permissions would reset after renaming/re-signing | macOS ties permissions to bundle ID + certificate | Keep appId `com.dologics.lwhisper` (since task 22; was `local.whisper-desktop`) and the cert **"Whisper Desktop Local"** (old name on purpose — never rename/recreate it) |
| Helper `status` from a terminal says `input=1 accessibility=1` but the app may differ | macOS answers for the *responsible* process (your terminal), not the app | Check permissions in the app's Settings page or System Settings |
| No blackletter/Old English font for the 𝕷 icon | macOS doesn't ship one | `STIXTwoMath-Regular` has U+1D577 𝕷 (bold Fraktur L) — see `scripts/make-app-icon.swift` |
| Code change doesn't show up in `npm start`/the app | Electron runs `build/`, not `src/` | `npm start` / `install-app` rebuild; after editing by hand run `npm run build`. Never edit `build/` |
| `ui-check` eval says `showPage is not defined` | A window script got an `import`/`export` → TypeScript made it a module, so its functions are no longer global | Keep `src/renderer/*.ts` and `src/recorder/*.ts` free of runtime imports; get types via `globals.d.ts` (`import('../shared/types').X`) |
| TS error "Duplicate function implementation" for `stop`/`close`/`open` in a window script | Browser globals (`window.stop()` …) are declared by TypeScript's DOM types | Use another name (recorder uses `startRecording` / `stopRecording`) |
| TypeScript 6 can't find Node types (`process`, `Buffer`) | TS 6 no longer loads `@types/*` automatically | `"types": ["node"]` in `tsconfig.json` (already set) |
| First transcription after a new whisper.cpp build takes ~8–12 s | Metal shader compile, once per new binary (cached afterwards) | Normal — same as the first-ever run |
| ESLint/Prettier scan thousands of files | Downloaded sources in `.deps/` (whisper.cpp, FFmpeg) | `.deps/` is in the ESLint + Prettier ignores — keep it there |
| Homebrew's ffmpeg can't be shipped | It's a GPL build linking ~40 Homebrew libraries | Use `npm run build:tools` (static LGPL build; the script refuses a GPL result) |
| Dictation text sometimes lowercase without punctuation | large-v3-turbo picks that style for some audio (seen with the fake mic: same file, different start offset); dictation sends no style prompt | Not a regression — compare several runs. A dictation style prompt would be a separate change |
| Cancelling a model download right away leaves no `.part` | Nothing had arrived yet (Hugging Face redirect still in progress) | Expected; the next try starts from 0. Progress shows "Connecting…" until bytes arrive |
| Testing "no model" without touching the installed app | Dev uses the project `models/` folder, settings are shared | Rename `models/ggml-large-v3-turbo.bin` temporarily, run `npm start`, rename back. `activeModel` in settings.json is shared with the installed app — leave it on a model both have |
| Running `bin/fn-listener` from a terminal may pop a macOS prompt for Terminal/Claude to monitor input | The helper asks for Input Monitoring when it doesn't have it — and from a terminal the *terminal* is asked | Don't start the helper from a terminal except for `paste-dry` checks; test keys in the installed app. If the prompt appears: Deny |
| `strings` doesn't find short texts ("mods", "key") in the Swift helper | Swift stores strings ≤ 15 bytes inside the code, not as text | Check a function name instead: `nm bin/arm64/fn-listener \| grep modifierNames` |
| `WHISPER_USER_DATA` doesn't separate the models folder | Dev models always come from the project `models/`; `paths.ts` is evaluated before main.ts sets the path (only matters for a packaged build) | For a no-model test, hide the project model file temporarily |
| Swift: `'AudioHardwareCreateProcessTap' is only available in macOS 14.2 or newer` | Helpers built with an older `-target` | `build-native.sh` targets macOS 14.2 (the app's minimum) |
| A bash script stops silently | `set -e` + a failing command inside `VAR=$(…)` (e.g. `$([ x = y ] && echo …)`) ends the script with no message | Use a plain `if … then VAR=…; fi` |
| Testing the Intel build on Apple Silicon | Rosetta runs x86_64 apps; speed/GPU are NOT like a real Intel Mac | Fine for "it starts, downloads, transcribes" — real speed only on an Intel Mac |
| Testing a DMG as a new user on this Mac | The release app shares nothing if started with its own data folder | Copy the app out of the DMG, run `WHISPER_USER_DATA=<folder> "…/L - Whisper.app/Contents/MacOS/L - Whisper" --remote-debugging-port=9223` (see test-app) |
| `npm audit` warns about minimatch | Build-time dependency of electron-builder only | Ignore; don't `npm audit fix --force` |
