---
name: update-app
description: Use for ANY change to L - Whisper — new feature, fix, tweak, UI change, setting. Covers the task file, making the change, testing, rebuilding/reinstalling the app in /Applications, and committing. Follow it end to end.
---

# Updating L - Whisper

The user wants minimal involvement but to **see every step** (say what you'll run and why, then what happened). Work autonomously; only hand over things that need their password or a physical action (Fn key, speaking, native dialogs).

## 0. Understand before touching code
1. Read `docs/ARCHITECTURE.md` (file map + key decisions) and skim `docs/GOTCHAS.md`.
2. Find the related task notes in `tasks/done/` (they hold measurements and *why* things are the way they are).
3. If the change contradicts a **key decision** (ARCHITECTURE §6) or the agreed feature list, ask the user first.
4. Read CLAUDE.md **"Where we are"** (current version, what's on hold, open tasks in `tasks/backlog/`).
5. Touching the app ID, signing, helper file names, settings keys, `productName` or minimum macOS? Read the **`release-app`** skill ("Never change") first — friends' updates depend on them.

## 0.5 Be on the dev branch
`git switch dev && git pull` — all work happens on `dev`. `main` only changes when the user asks to merge.

## 1. Create a task file
- Next number after the highest in `tasks/done/` (e.g. `12-persist-history.md`) in `tasks/backlog/`.
- Contents: **Goal**, **Steps**, **Done when**. Tell the user which task you're starting.
- One task at a time.

## 2. Make the change
- Keep code simple and commented in plain words (the user reads it to learn).
- Code is strict TypeScript in `src/` (Electron runs the compiled `build/` — never edit it). Before testing: `npm run typecheck && npm run lint && npm test`.
- Window ⇄ main communication only through `src/preload/preload.ts` + `ipcMain.handle` in `src/main/ipc.ts`; add the method to `WhisperAppApi` in `src/shared/types.ts` (the preload `satisfies` it). Never enable `nodeIntegration`.
- Window scripts (`src/renderer`, `src/recorder`) must stay import-free plain scripts (see GOTCHAS).
- New renderer text: build DOM with `textContent`, never inject user/transcript text as HTML.
- Swift helper changed? → `npm run build:native` (~1 min, builds `bin/arm64` + `bin/x64`).
- The app ships for **Apple Silicon and Intel**: new native code must build for both; Intel runs whisper.cpp on the CPU (no Metal).
- New setting? Add it to `SettingsValues` with a safe default; never rename/repurpose an existing key (old settings.json files must still load).
- Think of a **brand-new user** (no settings, no model, no permissions — first-run setup) and an **existing user updating** (nothing should break or ask again).
- Everything stays local: no network calls, no cloud APIs. Two exceptions: the model downloader (`src/main/models/`, model files only) and the AI summary (`src/main/ai/`, task 26: transcript text to the user's own Claude Code / Codex, only on click, default Off). Nothing else.

## 3. Test (use the `test-app` skill)
- `npm test` must pass.
- Test the changed feature in dev (`npm start`) with the safe methods from `test-app` — fake mic, `paste-dry`, DevTools screenshots.
- **Never** type into / paste into the user's apps, or press keys for them.

## 4. Install the update
```bash
npm run install-app
```
This quits the running app (and any `npm start`), rebuilds (Apple Silicon), signs with "Whisper Desktop Local" via `scripts/sign-app.sh` (permissions are kept), replaces `/Applications/L - Whisper.app` and launches it. It must end with `signature valid` and `done`. (DMGs for other Macs: only when releasing — `release-app` skill.)

## 5. Ask the user to verify
Ask only for what you can't test yourself (holding Fn, real speech, native Save/Open dialogs, real drag-and-drop). Give short numbered steps.

## 6. Close out
1. Add a **Notes** section to the task file (what changed, files, measurements, decisions) and move it to `tasks/done/`.
2. If architecture, data locations or decisions changed → update `docs/ARCHITECTURE.md`. New trap found → add it to `docs/GOTCHAS.md`. Feature added → `FEATURES.md`.
3. User-visible change → one plain-words line under `## Unreleased` in `CHANGELOG.md`. (Making a version to share = the **`release-app`** skill.)
4. Update CLAUDE.md **"Where we are"** if the status moved (new version, task on hold/started, open questions).
5. Commit **and push** (the user wants every finished task on GitHub):
   ```bash
   git add -A && git commit -m "<task number>: <short summary>"
   git push   # pushes dev to GitHub
   ```
   (Models, samples, node_modules, dist and bin are git-ignored.) Report the commit hash and that it's pushed.
