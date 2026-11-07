# L - Whisper App — Feature List

Tech stack: Electron + Node.js (TypeScript), with whisper.cpp as the local transcription engine.

## 1. Local Whisper setup
- Whisper runs fully on this Mac — no internet, no API costs.
- Uses whisper.cpp with Apple GPU acceleration (Metal) for speed.
- A model is downloaded once and stored locally.

## 2. Speech-to-text dictation
- Press a hotkey from any app to start recording your voice.
- Press it again (or release it) to stop.
- Speech is converted to text locally.

## 3. Auto-paste into the active text field
- The text is typed into whatever text box your cursor is in (browser, Slack, editor, anything).
- Your previous clipboard content is restored afterwards.

## 4. Audio/video file transcription (separate feature)
- Drag in or pick any audio or video file (mp3, wav, m4a, mp4, mov, etc.).
- The app extracts the audio and transcribes it.
- A progress bar shows while it works.
- The transcript appears in a text area inside the app.
- You can copy the transcript or save it as a file.

## 5. The app itself
- Desktop app built with Electron and Node.js, written in TypeScript.
- Lives in the menu bar so dictation is always one keystroke away.
- Has a main window for file transcription.
- Dictation keeps working in the background while the window is open.

## 6. Meeting recording (audio only)
- Menu: Start / Stop Meeting Recording — records your mic + everything the Mac plays (Meet/Zoom in Chrome, WhatsApp…).
- Saves while recording to `~/Documents/L - Whisper Library/` (crash-safe), ~29 MB per hour, both voices balanced in both ears.
- Uses the mic your call uses and follows device switches. No automatic transcription — transcribe it in the Library.

## 7. Library (meetings + transcribed files) — task 25, replaced the Meetings page
- Sidebar **Library**: recorded meetings **and** transcribed files, newest first; filter All / Meetings / Files. One folder per item in `~/Documents/L - Whisper Library/` (the old "L - Whisper Recordings" folder is moved there once).
- A dropped/chosen file's transcript is saved to the Library automatically ("✓ Saved to Library — Open"). The file itself is **never copied or moved** — its item remembers where it is; if it's moved, the transcript stays readable (play/re-transcribe need it back).
- Delete on a file item removes only its Library folder (to Trash), never the original.
- Built-in player (timeline, ±15 s, volume) — also plays a file item's original (mp3/wav/m4a/mp4/mov…); click a transcript line to jump there.
- Transcribe with Auto / English / Urdu, optional translate to English → `.txt`, `.srt`, `.vtt` saved beside the audio.
- Rename, delete (to Trash), show in Finder, copy transcript (with timestamps).

## 8. AI summary (task 26)
- Settings → **AI summary**: Off (default) / **Claude Code** (Claude subscription) / **Codex** (ChatGPT subscription) — uses the tool installed and signed in on this Mac, no API key. Status, Choose… (pick the program), Test.
- Library item → **Summarize**: simple English, third person — Summary, Key points, **Action items** ("X needs to…"), Open questions. Saved as `<name>.summary.md` in the item's folder; Copy, Regenerate; note when the transcript is newer.
- Only on click, only the transcript text (never audio). Not set up → the button opens Settings.

## Built beyond the original list
- Hold the dictation key = push-to-talk; double-tap = hands-free (tap to stop).
- **Shareable**: two DMGs — Apple Silicon and Intel — with a how-to-open note (no Apple Developer ID; one-time "Open Anyway"). Needs macOS 14.2+ (task 22).
- Credits: "© DoLogics · MIT License" + "Built by Mohsin Shoaib" — About window (tray menu), bottom of Settings, Finder Get Info; third-party licences inside the app (task 23).
- **Speaker labels in meetings** (task 27): mic = your name (or "Speaker 1"), system audio = "Speaker 2". Recordings keep a hidden 2nd track (raw: L mic / R system); each word goes to the side that was talking when it was said (whisper DTW word times), so turns are split correctly. Meeting .txt has no timestamps (paragraph per turn); srt `Name: …`, vtt `<v Name>`, json `speaker`. The AI summary is told who the names are. New recordings only.
- **Library item tabs** (task 30): Transcript · Summary · Files (view the saved TXT / SRT / VTT / JSON / summary, Copy, Show in Finder). Tabs appear once something is transcribed.
- **Your name** (task 28): optional, Settings → General and the setup Welcome page; stored only in settings.json; will label the mic side of meeting transcripts (task 27).
- **Settings in tabs** (task 29): General · Dictation · Models · AI summary · Permissions; in-app links open the right tab.
- **First-run setup** (task 21): Welcome → Permissions (live ✓) → Dictation key (with test) → Model download → Try it. Resumes where you left off; Settings → Run setup again. Existing installs skip it.
- Choose the dictation key in Settings: **Fn**, or **two modifier keys** held together (⌃ ⌥ ⇧ ⌘, e.g. ⌃⌥), with a live key test (task 20).
- Language setting (Auto-detect / English) in the menu bar and Settings page.
- Silence is ignored (no made-up text).
- Recent dictations and recent files (memory only), Settings page with live permission status.
- Installed app in /Applications, opens at login.

## Ideas (not decided)
- Screen + audio (video) meeting recording — same recorder with video on.
- Speaker labels: You / Others, then Speaker 1, 2, 3.
- Keep history across restarts (with a "Clear history" button).
- Subtitle export (.srt / .vtt).
- Custom vocabulary for names and jargon.
- Cleanup of filler words.
- More languages in the language menu (e.g. Urdu).
