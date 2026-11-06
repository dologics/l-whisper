# L - Whisper — beta tester checklist

Thanks for trying L - Whisper! It turns speech into text **on your Mac** — nothing is sent to the internet except the one-time download of a speech model.
Built by Mohsin Shoaib at DoLogics.

## Before you start
- **Which download?** Apple menu → **About This Mac**:
  - "Chip: Apple M1 / M2 / M3 / M4" → `L-Whisper-1.0.0-arm64.dmg`
  - "Processor: … Intel …" → `L-Whisper-1.0.0-x64.dmg`
- Needs **macOS 14.2 (Sonoma) or newer**.
- About 1 GB of free space (app + a speech model).

## 1. Install (≈ 2 min)
1. Open the DMG, drag **L - Whisper** onto **Applications**.
2. Open it from Applications. macOS will block it the first time ("not opened" / "can't be verified") — that's expected (it's not from the App Store).
3. System Settings → **Privacy & Security** → scroll down → **Open Anyway** next to L - Whisper → confirm.
4. Open L - Whisper again.

📝 Note: the exact message macOS showed, and whether Open Anyway worked.

## 2. First-run setup (≈ 5 min)
1. **Permissions:** click Allow for Microphone, Input Monitoring and Accessibility, switch L - Whisper on in System Settings, come back — each should show ✓.
2. **Dictation key:** keep **fn**, or choose two keys (e.g. ⌃ Control + ⌥ Option). Press **Test** and hold the key — the lamp should turn green.
3. **Model:** download the **Recommended** one. 📝 How long did it take?
4. **Try it:** click in the box, hold your key, say a sentence, let go → your words appear. Click **Finish**.

## 3. Try the features
- **Dictation:** in Notes, Mail or a browser, hold your key, speak, let go. Double-tap the key for hands-free, tap again to stop. 📝 How long until the text appears?
- **Transcribe a file:** drag an audio/video file (voice memo, video) into the window. 📝 File length and how long it took.
- **Meeting recording** (optional): menu bar waveform icon → Start Meeting Recording during a call (Zoom, Meet, WhatsApp…) → Stop → open **Library** in the app → play it → Transcribe.
- **AI summary** (optional, needs Claude Code or Codex signed in with your subscription): Settings → AI summary → choose it → Test → in the Library open a transcribed item → Summarize. Tell us if it couldn't find the tool. macOS asks once to allow recording other apps' audio.

## 4. Send back
- Mac model, chip (Apple / Intel), macOS version, which DMG
- What worked, what didn't (screenshots of any error help a lot)
- The 📝 timings above
- Anything confusing in setup or the app
