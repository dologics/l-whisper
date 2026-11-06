# Security policy

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report privately through GitHub: on the repository page open **Security → Report a vulnerability**
([direct link](https://github.com/dologics/l-whisper/security/advisories/new)).

Include what you found, how to reproduce it, and the app version, macOS version and chip.
We'll reply as soon as we can and keep you updated until it's fixed. Thanks for helping keep users safe.

## Supported versions

Only the [latest release](https://github.com/dologics/l-whisper/releases/latest) gets security fixes.

## What matters most here

L - Whisper handles microphone audio, system audio and transcripts, and has Accessibility and
Input Monitoring permissions. Especially interesting:

- anything that sends audio or text off the Mac (only model downloads and the click-only AI summary
  are meant to touch the network),
- anything that lets another app or a file trigger recording, pasting or key handling,
- unsafe handling of transcript or file-name text in the app's windows.
