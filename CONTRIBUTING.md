# Contributing to L - Whisper

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome.

## Before you start

- **Bugs:** open an [issue](https://github.com/dologics/l-whisper/issues/new/choose) with your macOS version,
  chip (Apple Silicon / Intel), app version and steps to reproduce.
- **Questions, ideas, "how do I…?":** start a [Discussion](https://github.com/dologics/l-whisper/discussions).
- **Bigger changes or new features:** open an issue first so we can agree on the approach before you write code.
- **Security problems:** please don't open a public issue — see [SECURITY.md](SECURITY.md).

## Ground rules

These keep L - Whisper what it is:

1. **Everything stays local.** No cloud APIs, no telemetry, no network calls with audio or text.
   The only exceptions are downloading model files and the optional, click-only AI summary
   (see [Privacy](README.md#privacy)). PRs that add network calls won't be merged.
2. **Keep it simple and commented in plain words.** Many readers are learning from this code.
3. **Don't break existing users.** Never rename or repurpose a settings key, the app ID
   (`com.dologics.lwhisper`), helper names or data folders — updates must keep users' settings and
   macOS permissions. Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §6 "Key decisions".

## Development setup

See [Build from source](README.md#build-from-source) in the README, then:

```bash
npm start              # build + run in development mode
npm run typecheck      # TypeScript check (strict)
npm run lint           # ESLint
npm run format         # Prettier
npm test               # unit tests
```

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how it fits together, and why) and
[`docs/GOTCHAS.md`](docs/GOTCHAS.md) (traps already hit) before changing code.

### Code style

- Strict TypeScript in `src/`; `build/` is generated — never edit it.
- Shared shapes go in `src/shared/types.ts`.
- Window ⇄ main process communication only through `src/preload/preload.ts` and `ipcMain.handle`
  in `src/main/ipc.ts`. Never enable `nodeIntegration`.
- Window scripts (`src/renderer`, `src/recorder`) are plain scripts without imports.
- Put user or transcript text into the page with `textContent`, never as HTML.
- Native code must build for **both** Apple Silicon and Intel.

### Testing without disturbing yourself

Tests must not type, press keys or paste into your real apps. The app has a fake microphone and a
"dry" paste mode for this — see `.claude/skills/test-app/SKILL.md`.

<a id="signing"></a>
### Signing (for installable builds)

macOS ties the app's permissions to its code signature. `npm run install-app` and `npm run release`
sign with a certificate named **"Whisper Desktop Local"**. To use them on your Mac, create a self-signed
one: **Keychain Access → Certificate Assistant → Create a Certificate…** → name `Whisper Desktop Local`,
type **Code Signing**. (`npm start` doesn't need it.)

## Pull requests

1. Fork, then branch from `dev` (the main development branch; `main` holds releases).
2. Keep each PR to one change. Add or update tests where it makes sense.
3. `npm run typecheck && npm run lint && npm test` must pass.
4. Add one plain-words line under `## Unreleased` in [`CHANGELOG.md`](CHANGELOG.md) for anything users will notice.
5. Describe what you changed, why, and how you tested it (chip + macOS version).

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
