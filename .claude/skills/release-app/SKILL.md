---
name: release-app
description: Use when making a new L - Whisper version to share — choosing the version number, the CHANGELOG, building and checking the two DMGs (Apple Silicon + Intel), tagging, and what must never change so friends' updates keep their settings and permissions. Also read it before any change to the app ID, signing, helper names, settings keys or minimum macOS.
---

# Releasing L - Whisper

The app is shared as **two DMGs** made by `npm run release`:
`dist/release/L-Whisper-<version>-arm64.dmg` (Apple Silicon) and `…-x64.dmg` (Intel), plus `L-Whisper-<version>-SHA256.txt`.
No Apple Developer ID: the app is signed with the self-signed certificate **"Whisper Desktop Local"**, so a friend clicks **Open Anyway** once (explained in `How to open.txt` inside each DMG).

Status (see CLAUDE.md "Where we are"): **1.2.0** (2026-11-08) is the current build. 1.1.1 (2026-11-07) was the first one published as a **GitHub Release** on `dologics/l-whisper` (public since 2026-11-07).

## 1. Version numbers (MAJOR.MINOR.PATCH)
The version lives **only** in `package.json` (`"version"`). Everything else comes from it: Info.plist, the About window, Settings → About, DMG names.

| Bump | When | Examples |
|---|---|---|
| **PATCH** 1.0.**x** | Fixes and small tweaks, nothing new to learn | crash fix, text change, better error message |
| **MINOR** 1.**x**.0 | New features or settings; updated bundled tools | new setting, new model in the catalogue, whisper.cpp/ffmpeg update, new page |
| **MAJOR** **x**.0.0 | Users have to redo something, or something can't go back | app ID or certificate change (permissions reset!), settings/data format that old versions can't read, higher minimum macOS |

Set it with `npm version <x.y.z> --no-git-tag-version` (changes package.json + package-lock.json only).

## 2. Never change (or it's a MAJOR release, planned with the user)
Friends install a new DMG over the old app. These keep their **permissions, settings, models and recordings**:
- Certificate **"Whisper Desktop Local"** and the sign identifiers in `scripts/sign-app.sh`: `com.dologics.lwhisper`, `.helper`, `.meeting`, `.<tool>` → macOS ties Microphone / Input Monitoring / Accessibility to them.
- App ID `com.dologics.lwhisper` (package.json `build.appId`).
- Helper file names `fn-listener`, `meeting-recorder` (renaming risks permission prompts).
- `productName` "L - Whisper" → data folder `~/Library/Application Support/L - Whisper/`.
- Library folder **`~/Documents/L - Whisper Library/`** (task 25 moved the old `L - Whisper Recordings` there once, in `prepareLibraryDir`; keep that move so 1.0.0 users still get their meetings). `item.json` fields: add new ones freely, never rename/repurpose (`version`, `kind`, `createdAt`, `source`, `durationSec`, `summary`). Summary file name `<base>.summary.md`.
- **Settings keys** (`src/shared/types.ts` `SettingsValues`): add new ones freely; never rename or change the meaning of existing ones — old settings.json files must still load (`parseHotkey`-style validation with a default).
- Model file names (catalogue `file`) and the Library folder layout (one folder per item, files named like it, `item.json`).
- Minimum macOS **14.2** (meeting recording's process tap).

## 3. During normal work (every finished task)
In the `update-app` close-out, add one line per user-visible change under **`## Unreleased`** in `CHANGELOG.md` (plain words: what the user notices). Internal-only changes go under "Under the hood" or are left out.

## 4. Release checklist
Say each step before you run it (CLAUDE.md rule 1).
1. **Clean start:** on `dev`, `git status` clean, all tasks of this release are in `tasks/done/`, `## Unreleased` lists them.
2. **Version:** decide PATCH / MINOR / MAJOR with the table above (ask the user if it's MAJOR) → `npm version <x.y.z> --no-git-tag-version`.
3. **Checks:** `npm run typecheck && npm run lint && npx prettier --check . && npm test` — all green.
4. **Programs for both chips:** if `native/*.swift` changed → `npm run build:native`; if whisper.cpp / FFmpeg / VAD versions changed → `npm run build:tools`. (The release script builds missing ones, but not outdated ones.)
5. **Build:** `npm run release` → both DMGs + SHA-256 file. It must print `signature valid` and `all arm64` / `all x86_64` for each.
6. **Test both DMGs as a brand-new user** (test-app → "Release DMGs"): contents, Info.plist (id, version, copyright, min 14.2), signature; run from a copy with `WHISPER_USER_DATA`, setup → download **tiny** → transcribe a sample → About shows the new version. x64 runs under Rosetta.
7. **Update test:** `npm run install-app` on this Mac (= installing over the previous version) → permissions must still be granted (no prompts), settings + model kept. User checks: fn dictation, a short meeting recording, About window.
7b. **Public docs check** (same list as `update-app` §6 step 5): README features / Roadmap / sizes / screenshots, FEATURES.md, ARCHITECTURE, beta-tester checklist, CLAUDE.md — everything in this release must be described, nothing removed must still be advertised. Show the user what's stale and ask before fixing; fix before tagging.
8. **Record:** in `CHANGELOG.md` rename `## Unreleased` → `## <x.y.z> — <date>` and start a new empty `## Unreleased`. Commit `release <x.y.z>`, push.
9. **Tag:** `git tag -a v<x.y.z> -m "L - Whisper <x.y.z>"` → `git push origin v<x.y.z>`. Ask the user whether to merge `dev` into `main` now (only on their yes).
10. **Publish:** `gh release create v<x.y.z> dist/release/L-Whisper-<x.y.z>-arm64.dmg dist/release/L-Whisper-<x.y.z>-x64.dmg dist/release/L-Whisper-<x.y.z>-SHA256.txt --title "L - Whisper <x.y.z>" --notes-file <notes>` (notes = that version's CHANGELOG section + which DMG is which + Open Anyway + macOS 14.2+). DMGs are **not** committed (dist/ is git-ignored). Friends can download from the Release page.

## 5. Things to look for in any new feature (so releases stay safe)
- Works on **both chips**? New native code → both `bin/arm64` and `bin/x64`; nothing that needs Metal/Apple-Silicon-only APIs without a fallback (Intel build = whisper.cpp on CPU).
- A **new user** with no settings, no model and no permissions: does the feature say what's missing instead of failing? (first-run setup, "No model — see Settings").
- An **existing user** updating: old settings.json still loads, nothing asks for permissions again.
- New permission or Info.plist usage text → `package.json` `build.mac.extendInfo`, first-run setup page, Settings → Permissions, README later.
- Network: still only model downloads + the on-click AI summary through the user's own CLI (CLAUDE.md rule 5).
- Bigger app? Note DMG sizes in the task notes (1.0.0: arm64 148 MB, x64 156 MB).

## History
| Version | Date | Notes |
|---|---|---|
| 1.0.0 | 2026-11-05 | First shared build (tasks 1–22). Tag `v1.0.0`. DMGs: arm64 148 MB, x64 156 MB. |
| 1.1.1 | 2026-11-07 | Open-source prep (task 23): MIT © DoLogics credits, licences in `Contents/Resources/licenses/`, `~` path in AI status. First version in the fresh repo + first GitHub Release. DMGs: arm64 155 MB, x64 163 MB. Tested: both DMGs (plist, licences, signature), arm64 as new user (tiny download + transcribe), x64 starts under Rosetta; update over 1.1.0 kept settings. |
| 1.2.0 | 2026-11-08 | Tasks 27–31: speaker labels (hidden raw Speakers track + DTW word timing), Your name, Settings tabs, Library item tabs, About page. DMGs: arm64 155 MB, x64 163 MB. Tested: both DMGs (plist, licences, signature); arm64 as new user (setup, tiny download, transcribe); x64 starts under Rosetta (setup, About 1.2.0); update on this Mac kept permissions (helper ready) + settings. |
| 1.1.0 | 2026-11-06 | Library (task 25) + AI summary (task 26). Tag `v1.1.0`. DMGs: arm64 148 MB, x64 156 MB. Both tested as new user (tiny model) incl. Library; update over 1.0.0 on this Mac kept settings + login item. Codex path untested (not installed). |
