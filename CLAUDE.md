# L - Whisper — Guide for Claude

**What it is:** a macOS menu bar app (Electron + Node.js, **TypeScript**) that runs Whisper **locally** via whisper.cpp **bundled in the app** (no Homebrew needed):
1. **Dictation** — hold the dictation key (Fn, or two modifiers like ⌃⌥ — Settings) (double-tap = hands-free) → speak → text pasted where the cursor is.
2. **File transcription** — drop an audio/video file → timestamped transcript → Copy / Save.
3. **Meeting recording** — audio only: your mic + system audio (Meet/Zoom in Chrome, WhatsApp, anything) → `~/Documents/L - Whisper Library/<meeting>/`.
4. **Library** — meetings + transcribed files in one list: play, transcribe (Auto/English/Urdu, translate), rename, delete; transcripts saved as txt/srt/vtt in each item's folder (a dropped file is never copied — its item points at the original).
5. **AI summary** — on click, a Library item's transcript is summarized by the user's own Claude Code or Codex (Settings → AI summary) → `<name>.summary.md` beside it.

It is **installed** at `/Applications/L - Whisper.app` (opens at login) and **shared** with other Macs as two DMGs (`npm run release`: Apple Silicon + Intel). Built by Mohsin Shoaib at DoLogics (© DoLogics, MIT). Work here is now updates, fixes, new features and releases.

## Where we are (keep this current)
- **Version 1.2.0** (2026-11-08, tag `v1.2.0`, GitHub Release) — meeting speaker labels (your name / Speaker 2, task 27), Your name setting (28), Settings tabs (29), Library item tabs (30), About page (31). 1.1.1 (2026-11-07) was the first GitHub Release (open-source credits). 1.1.0 (2026-11-06) added Library (task 25) + AI summary (task 26); 1.0.0 (2026-11-05) was the first shared build. See `CHANGELOG.md`.
- **To verify with testers:** AI summary via **Codex** (not installed on this Mac — only tested with a fake CLI); the one-time folder move on a friend's 1.0.0 install; speaker labels with **laptop speakers + built-in mic** (echo) and with **Urdu + Translate**.
- **Known limit (not fixing now, user's call 2026-11-08):** when two voices overlap (e.g. talking over a YouTube video), Whisper's single pass writes only one of them. Idea for later: re-transcribe just those gaps from each side's own channel.
- **Now: beta testing on other Macs** — task 24 (`tasks/backlog/24-beta-test-on-other-macs.md`): friends on Apple Silicon **and Intel** install the DMGs; feedback is collected there. Tester checklist to send: `docs/beta-tester-checklist.md`.
- **Open source — public since 2026-11-07** at `github.com/dologics/l-whisper` (MIT © DoLogics, task 23). Downloads are GitHub Releases. Outside contributions come as issues / pull requests into `dev`; nothing personal in tracked files (personal notes → `CLAUDE.local.md`, task notes → local `tasks/`).
- Open questions for the user: should dictation/file history persist across restarts (now memory-only)? (Decided 2026-11-06: `tasks/` stays local-only; `CLAUDE.md` + `.claude/skills` are public as developer docs.)
- Not verified yet (only possible on other Macs): Gatekeeper "Open Anyway" with a downloaded DMG, real speed on Intel, permissions kept after a DMG update.

## Start here (every session)
| You need to… | Use |
|---|---|
| Understand how it works, which file does what, and **why** (key decisions) | `docs/ARCHITECTURE.md` |
| Avoid traps already hit (zsh, OpenSSL, fake mic, paste in tests…) | `docs/GOTCHAS.md` |
| Make **any** change (feature, fix, UI, setting) | skill **`update-app`** — follow it end to end |
| Test or verify something without disturbing the user | skill **`test-app`** |
| Diagnose "it stopped working" | skill **`troubleshoot-app`** |
| Make a **new version** to share (version number, CHANGELOG, DMGs, tag) — or touch app ID / signing / settings keys | skill **`release-app`** |
| What changed in each version | `CHANGELOG.md` |
| History of each feature: measurements, decisions | `tasks/done/NN-*.md` |
| Feature list | `FEATURES.md` |

## Hard rules
1. **Show every step.** Before each command say what you'll run and why; after, say what happened. Explain new files. No silent batches — even though the general output style is concise.
2. **Work autonomously.** Do installs, builds and tests yourself. Hand the user only what needs their password (`sudo`, keychain) or a physical action (Fn key, speaking, native dialogs) — with exact steps.
3. **Ask first** before changing a key decision (ARCHITECTURE §6), the tech stack, or the feature list. Don't redo deliberate choices (e.g. VAD off for files, history memory-only, mic off while idle).
4. **Tests never touch the user's apps:** no real ⌘V, no key presses, no typing; use `paste-dry`, the fake mic and DevTools screenshots (`test-app`). Save/restore the clipboard if a test uses it.
5. **Everything stays local** — no cloud APIs, no network calls with audio or text. **One exception (user-approved, task 19):** downloading Whisper model files from the official whisper.cpp repo on Hugging Face (`src/main/models/model-downloader.ts`). **Second exception (user-approved, task 26): AI summary** — only when the user clicks Summarize (or Test), the transcript **text** (never audio) goes to the AI tool they chose in Settings (Claude Code `claude` or Codex `codex`, their own subscription), run from `src/main/ai/` with tools off. Default is Off. Nothing else may touch the network.
6. **One task at a time, tracked:** new work → task file in `tasks/backlog/`, finished → Notes + move to `tasks/done/` + a line in `CHANGELOG.md` "Unreleased" (see `update-app`).
7. **Ship through `npm run install-app`** — never copy an unsigned build into /Applications (permissions would reset).
8. **Work on the `dev` branch.** Commit and push each finished task (push details: `CLAUDE.local.md`). Merge `dev` into `main` **only when the user asks**. Never commit models, samples, `dist/`, `bin/`, `tasks/` or secrets.
9. Keep code simple and commented in plain words — the user learns from it. Code is **strict TypeScript** in `src/`; never edit `build/` (generated). Shared shapes go in `src/shared/types.ts`.

## Essential commands
```bash
npm start                    # build + dev run (project models/ + bin/); quit the installed app first
npm test                     # unit tests (96), run on the .ts files via tsx
npm run typecheck            # TypeScript check of everything (main, windows, tests, scripts)
npm run lint                 # ESLint;  npm run format = Prettier
npm run build                # TypeScript → build/ (start/install-app do this for you)
npm run build:native         # Swift helpers (fn-listener = modifier keys + paste, meeting-recorder) → bin/arm64 + bin/x64
npm run build:tools          # bundled whisper.cpp + LGPL ffmpeg → bin/arm64 + bin/x64 (+ VAD model); ~8 min first time
npm run install-app          # build + sign + replace /Applications/L - Whisper.app + launch (this Mac, Apple Silicon)
npm run release              # dist/release/L-Whisper-<version>-arm64.dmg + -x64.dmg (+ SHA256 file) to share
```

## Facts worth knowing up front
- **GitHub Actions** (`.github/workflows/ci.yml`) runs typecheck, lint, prettier and tests on a GitHub Mac for every push to `dev`/`main` and every pull request. After pushing, check it's green: `gh run list --limit 1`. Questions from users go to **Discussions**, bugs to Issues.
- Shell is **zsh** → use arrays for multi-word args (`"${A[@]}"`).
- App data: `~/Library/Application Support/L - Whisper/` (settings.json, models/). Dev and installed app share it **and** a single-instance lock.
- Programs the app runs come from `bin/<arch>/` (dev: `arm64` / `x64`) / `Resources/bin/` (installed, only its own chip's): Swift helpers + whisper.cpp v1.9.5 + FFmpeg 9.0.2 (LGPL), built by the scripts above. Homebrew's copies are only handy for manual checks.
- App ID **`com.dologics.lwhisper`** (helpers `.helper`, `.meeting`, `.<tool>`; changed once in task 22 from `local.whisper-desktop`). Signing: `scripts/sign-app.sh`.
- Signing identity: **"Whisper Desktop Local"** (self-signed, login keychain; codesign has "Always Allow"). Never replace it — see `release-app` "Never change".
- Version lives only in `package.json`; DMG names, About window and Settings read it.
- The developer's own Mac, headset and other personal notes are in `CLAUDE.local.md` (git-ignored, not public). Assume a headset: `say` through speakers can't reach the mic → use the fake mic.
