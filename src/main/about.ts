// Who made L - Whisper — one place for the credits shown in the app:
//   - the macOS "About L - Whisper" window (tray menu)
//   - the About section at the bottom of Settings
// (Finder → Get Info shows the same copyright line, from package.json "build.copyright".)
//
// Open-source credit style (task 23): the company holds the copyright (LICENSE file, MIT),
// the person who built it gets one quiet "Built by" line — the usual practice in open source.
import { app } from 'electron';

export const COMPANY = 'DoLogics';
export const BUILT_BY = 'Mohsin Shoaib';
export const LICENSE_NAME = 'MIT License';
export const REPO_URL = 'github.com/dologics/l-whisper';

export interface AboutInfo {
  version: string;
  company: string;
  builtBy: string;
  license: string;
  repoUrl: string;
}

export function aboutInfo(): AboutInfo {
  return { version: app.getVersion(), company: COMPANY, builtBy: BUILT_BY, license: LICENSE_NAME, repoUrl: REPO_URL };
}

/** Fill macOS's standard About window (call once, before it is shown). */
export function setAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: 'L - Whisper',
    applicationVersion: app.getVersion(),
    version: '', // no separate build number
    copyright: `© ${new Date().getFullYear()} ${COMPANY} · ${LICENSE_NAME}`,
    credits:
      `Built by ${BUILT_BY} at ${COMPANY}\n` +
      `Open source: ${REPO_URL}\n\n` +
      'Built on whisper.cpp, OpenAI Whisper models, FFmpeg (LGPL), Electron and Silero VAD.\n' +
      'Their licences are in the app (Contents/Resources/licenses).',
  });
}
