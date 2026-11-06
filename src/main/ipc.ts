// Window ⇄ main communication (IPC): every request the main window can make.
// The window reaches these only through src/preload/preload.ts.
import { app, clipboard, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { PermissionKind, Segment, TranscribeOptions } from '../shared/types';
import type { WhisperApp } from './app';
import { SUPPORTED, TranscriptionCancelled } from './file-transcriber';
import { openSystemSettings } from './system-settings';
import * as transcriptFormats from './transcript-formats';
import { errorMessage } from './util';

const MAX_RECENT_FILES = 10;

export function registerIpc(whisper: WhisperApp): void {
  const { fileTranscriber } = whisper;

  // ----- app state + settings -----
  ipcMain.handle('app:get-state', () => whisper.getState());
  ipcMain.handle('app:set-language', (_e, code: string) => whisper.setLanguage(code));
  ipcMain.handle('app:set-open-at-login', (_e, on: unknown) => whisper.setOpenAtLogin(Boolean(on)));
  ipcMain.handle('app:set-sounds', (_e, on: unknown) => whisper.setSounds(Boolean(on)));
  ipcMain.handle('app:copy-text', (_e, text: unknown) => clipboard.writeText(String(text)));
  ipcMain.handle('app:open-privacy', (_e, kind: PermissionKind | 'keyboard') => openSystemSettings(kind));

  // ----- first-run setup -----
  ipcMain.handle('setup:go-to', (_e, step: unknown) => whisper.setSetupStep(Number(step)));
  ipcMain.handle('setup:finish', () => whisper.finishSetup());
  ipcMain.handle('setup:restart', () => whisper.restartSetup());
  ipcMain.handle('setup:grant', (_e, kind: PermissionKind) => whisper.grantPermission(kind));
  ipcMain.handle('setup:refresh-permissions', () => whisper.refreshPermissions());

  // ----- dictation key -----
  ipcMain.handle('app:set-hotkey', (_e, hotkey: unknown) => whisper.setHotkey(hotkey));
  ipcMain.handle('app:set-hotkey-test', (_e, on: unknown) => whisper.setHotkeyTest(Boolean(on)));

  // ----- Whisper models (Settings → Models) -----
  ipcMain.handle('models:download', (_e, id: string) => whisper.downloadModel(id));
  ipcMain.handle('models:cancel', () => whisper.cancelModelDownload());
  ipcMain.handle('models:set-active', (_e, id: string) => whisper.setActiveModel(id));
  ipcMain.handle('models:delete', (_e, id: string) => whisper.deleteModel(id));

  // ----- file transcription -----
  ipcMain.handle('file:pick', async () => {
    const result = await dialog.showOpenDialog(whisper.window(), {
      title: 'Choose an audio or video file',
      properties: ['openFile'],
      filters: [{ name: 'Audio & Video', extensions: SUPPORTED }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:info', (_e, filePath: string) => fileTranscriber.fileInfo(filePath));
  ipcMain.handle('file:transcribe', async (event, filePath: string) => {
    try {
      const result = await fileTranscriber.transcribe(filePath, (progress) =>
        event.sender.send('file:progress', progress)
      );
      const info = await fileTranscriber.fileInfo(filePath);
      if (info.ok) {
        whisper.recentFiles.unshift({
          id: Date.now(),
          time: Date.now(),
          name: info.name,
          ext: info.ext,
          size: info.size,
          ...result,
        });
        whisper.recentFiles.length = Math.min(whisper.recentFiles.length, MAX_RECENT_FILES);
      }
      // Keep the transcript in the Library automatically (the file itself is not copied or moved).
      // If that fails (disk full…), the transcript is still shown and can be saved by hand.
      let libraryId: string | null = null;
      try {
        libraryId = whisper.library.createFromFile(filePath, result);
        whisper.libraryChanged();
      } catch (err) {
        console.error(`[library] could not save the transcript: ${errorMessage(err)}`);
      }
      whisper.pushState();
      return { ok: true, ...result, libraryId };
    } catch (err) {
      if (err instanceof TranscriptionCancelled) return { ok: false, cancelled: true };
      console.error(`[file] failed: ${errorMessage(err)}`);
      return { ok: false, error: errorMessage(err) };
    }
  });
  ipcMain.handle('file:cancel', () => fileTranscriber.cancel());
  ipcMain.handle('file:reveal', (_e, filePath: unknown) => shell.showItemInFolder(String(filePath)));

  // ----- Library page (meetings + transcribed files) -----
  ipcMain.handle('library:list', () => whisper.library.list());
  ipcMain.handle('library:get', (_e, id: string) => whisper.library.get(id));
  ipcMain.handle('library:reveal', (_e, id: string) => shell.openPath(whisper.library.folderOf(id)));
  ipcMain.handle('library:rename', (_e, id: string, title: string) => {
    try {
      const newId = whisper.library.rename(id, title);
      whisper.libraryChanged();
      return { ok: true, id: newId };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  ipcMain.handle('library:delete', async (_e, id: string) => {
    const folder = whisper.library.folderOf(id);
    if (folder === whisper.meeting.folder) return { ok: false, error: 'Stop the recording first.' };
    const isFile = (await whisper.library.get(id)).kind === 'file';
    const { response } = await dialog.showMessageBox(whisper.window(), {
      type: 'warning',
      message: `Move “${id}” to the Trash?`,
      detail: isFile
        ? 'Its transcripts go to the Trash. Your original file is not touched — it stays where it is.'
        : 'The recording and its transcripts go to the Trash. You can restore them from there.',
      buttons: ['Move to Trash', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    await shell.trashItem(folder); // only the Library folder — never a file item's original
    console.log(`[library] moved “${id}” to the Trash`);
    whisper.libraryChanged();
    return { ok: true };
  });
  ipcMain.handle('library:transcribe', async (event, id: string, opts: TranscribeOptions) => {
    try {
      const result = await whisper.library.transcribe(id, opts, (p) =>
        event.sender.send('library:progress', { id, ...p })
      );
      whisper.libraryChanged();
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof TranscriptionCancelled) return { ok: false, cancelled: true };
      console.error(`[library] transcription failed: ${errorMessage(err)}`);
      return { ok: false, error: errorMessage(err) };
    }
  });
  ipcMain.handle('library:cancel', () => fileTranscriber.cancel());
  ipcMain.handle('library:summarize', async (_e, id: string) => {
    const result = await whisper.ai.summarize(String(id));
    if (result.ok) whisper.libraryChanged();
    return result;
  });
  ipcMain.handle('library:summarize-cancel', () => whisper.ai.cancel());

  // ----- Settings → AI summary (task 26) -----
  ipcMain.handle('ai:set-provider', (_e, provider: unknown) => {
    whisper.ai.setProvider(provider);
    whisper.pushState();
  });
  ipcMain.handle('ai:status', () => whisper.ai.status());
  ipcMain.handle('ai:choose-path', async () => {
    const result = await dialog.showOpenDialog(whisper.window(), {
      title: 'Choose the claude or codex program',
      defaultPath: path.join(app.getPath('home'), '.local', 'bin'),
      properties: ['openFile', 'showHiddenFiles'],
    });
    if (!result.canceled && result.filePaths[0]) whisper.ai.setManualPath(result.filePaths[0]);
    return whisper.ai.status();
  });
  ipcMain.handle('ai:test', () => whisper.ai.test());

  // ----- transcripts (both pages) -----
  // Copy a transcript as timestamped text ("[00:12] …" lines).
  ipcMain.handle('transcript:copy', (_e, segments: Segment[]) =>
    clipboard.writeText(transcriptFormats.toTxt(segments))
  );

  // Save a transcript; the format follows the chosen extension (txt / srt / vtt).
  ipcMain.handle('transcript:save', async (_e, segments: Segment[], sourceName: unknown) => {
    const base = path.parse(String(sourceName || 'Transcript')).name;
    const result = await dialog.showSaveDialog(whisper.window(), {
      title: 'Save transcript',
      defaultPath: path.join(app.getPath('documents'), `${base} transcript.txt`),
      filters: [
        { name: 'Text with timestamps (.txt)', extensions: ['txt'] },
        { name: 'Subtitles (.srt)', extensions: ['srt'] },
        { name: 'Web captions (.vtt)', extensions: ['vtt'] },
      ],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    try {
      const ext = path.extname(result.filePath).slice(1).toLowerCase();
      const kind = ['srt', 'vtt'].includes(ext) ? ext : 'txt';
      await fs.promises.writeFile(result.filePath, transcriptFormats.format(kind, segments), 'utf8');
      console.log(`[file] saved transcript → ${result.filePath}`);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
}
