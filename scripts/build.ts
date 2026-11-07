// Builds the app into build/ (what Electron runs and electron-builder packages):
//   1. TypeScript → JavaScript, in three parts:
//        tsconfig.build.json          main process + preloads   → build/main, build/preload
//        src/renderer/tsconfig.json   main window script         → build/renderer
//        src/recorder/tsconfig.json   hidden recorder window     → build/recorder
//   2. HTML and CSS copied next to their scripts.
// Run: npm run build   (npm start and npm run install-app run it for you)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..');
const out = path.join(root, 'build');
const tsc = path.join(root, 'node_modules', '.bin', 'tsc');

const PROJECTS = ['tsconfig.build.json', 'src/renderer/tsconfig.json', 'src/recorder/tsconfig.json'];
const STATIC_FILES = ['renderer/index.html', 'renderer/styles.css', 'recorder/recorder.html'];

const t0 = Date.now();
fs.rmSync(out, { recursive: true, force: true }); // no leftovers from deleted/renamed files

for (const project of PROJECTS) {
  // tsc prints type errors itself; a failed check stops the build (execFileSync throws).
  execFileSync(tsc, ['-p', path.join(root, project)], { stdio: 'inherit' });
}

for (const file of STATIC_FILES) {
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.copyFileSync(path.join(root, 'src', file), path.join(out, file));
}
// the app icon for the About page (task 31)
fs.copyFileSync(path.join(root, 'assets', 'icon-preview.png'), path.join(out, 'renderer', 'app-icon.png'));

console.log(`build/ ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
