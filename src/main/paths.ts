// Where big/executable files live:
//   npm start (dev)  → the project folder (models/, bin/)
//   packaged .app    → Whisper model in ~/Library/Application Support/L - Whisper/models,
//                      programs + the small VAD model inside L - Whisper.app/Contents/Resources
// Every program the app runs is shipped with it (bin/) — nothing comes from Homebrew.
// Build them with: npm run build:native (Swift helpers) and npm run build:tools (whisper.cpp, ffmpeg),
// for Apple Silicon (bin/arm64) and Intel (bin/x64).
import { app } from 'electron';
import path from 'node:path';

/** Project folder (dev) or the app's resources (packaged) — where assets/ is. */
export const ROOT = app.getAppPath();

/** Downloaded Whisper models (Settings → Models) */
export const MODELS_DIR = app.isPackaged ? path.join(app.getPath('userData'), 'models') : path.join(ROOT, 'models');

// dev: one folder per chip (bin/arm64, bin/x64); the packaged app only contains its own chip's programs
const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(ROOT, 'bin', process.arch);
/** Swift helper: Fn key events + paste + permission status */
export const FN_HELPER_PATH = path.join(binDir, 'fn-listener');
/** Swift helper: mic + system audio for meeting recording */
export const MEETING_HELPER_PATH = path.join(binDir, 'meeting-recorder');

/** Programs shipped with the app (whisper.cpp + ffmpeg, built by npm run build:tools) */
export const TOOLS = {
  whisperServer: path.join(binDir, 'whisper-server'), // dictation (model stays loaded)
  whisperCli: path.join(binDir, 'whisper-cli'), // file + meeting transcription
  ffmpeg: path.join(binDir, 'ffmpeg'),
  ffprobe: path.join(binDir, 'ffprobe'),
};

/** Silero VAD model (~1 MB): lets dictation skip silence. Shipped inside the app. */
export const VAD_MODEL_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'models', 'ggml-silero-v5.1.2.bin')
  : path.join(ROOT, 'models', 'ggml-silero-v5.1.2.bin');

/** The Library: meetings + transcribed files, one folder each (task 25). */
export const LIBRARY_DIR = path.join(app.getPath('documents'), 'L - Whisper Library');
/** Where meetings were saved before task 25 — moved to LIBRARY_DIR once (see prepareLibraryDir). */
export const OLD_RECORDINGS_DIR = path.join(app.getPath('documents'), 'L - Whisper Recordings');
