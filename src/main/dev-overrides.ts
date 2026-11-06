// Test switches that must apply BEFORE any other module reads Electron's paths.
// main.ts imports this file first, so e.g. paths.ts (models folder of the installed app) sees it.
//
//   WHISPER_USER_DATA=some/folder   separate, empty data folder: settings, models (installed app),
//                                   single-instance lock — a "brand-new user" next to the real one
//   WHISPER_DOCUMENTS_DIR=some/folder  a stand-in for ~/Documents: the Library (and the old
//                                   "L - Whisper Recordings" folder it moves) live there — tests
//                                   never touch the user's real recordings
import { app } from 'electron';
import path from 'node:path';

if (process.env.WHISPER_USER_DATA) app.setPath('userData', path.resolve(process.env.WHISPER_USER_DATA));
if (process.env.WHISPER_DOCUMENTS_DIR) app.setPath('documents', path.resolve(process.env.WHISPER_DOCUMENTS_DIR));
