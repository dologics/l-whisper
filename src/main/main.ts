// Entry point of the main process (package.json "main" → build/main/main.js).
// Does what must happen before Electron is ready, then hands over to WhisperApp.
import './dev-overrides'; // first: test switches that change Electron's paths
import { app } from 'electron';
import path from 'node:path';
import { WhisperApp } from './app';
import { declareLibraryScheme } from './library-protocol';

// library:// (the Library page's audio player) must be declared before the app is ready.
declareLibraryScheme();

// Dev check: WHISPER_FAKE_MIC=path/to/file.wav makes Chromium's "microphone" play that file,
// so the full recording pipeline can be tested without speaking.
if (process.env.WHISPER_FAKE_MIC) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', path.resolve(process.env.WHISPER_FAKE_MIC));
  // The audio service's sandbox can't read files; relax it in this test mode only.
  app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox');
}

// Only allow one copy of the app to run; a second launch just shows the window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const whisper = new WhisperApp();

  app.on('second-instance', () => whisper.showWindow());
  app.whenReady().then(() => whisper.start());

  app.on('before-quit', (event) => {
    if (!whisper.beforeQuit()) event.preventDefault();
  });

  // Clicking the Dock icon reopens the window.
  app.on('activate', () => whisper.showWindow());

  // Don't quit when the window is closed — we're a menu bar app.
  app.on('window-all-closed', () => {});
}
