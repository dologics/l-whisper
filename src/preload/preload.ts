// Preload: the only bridge between the window (renderer) and the app (main process).
// Everything the page can do is listed here — nothing else is reachable.
// `satisfies WhisperAppApi` makes TypeScript check this list against src/shared/types.ts.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AiProvider,
  AppState,
  Hotkey,
  LibraryProgress,
  ModelProgress,
  PermissionKind,
  Progress,
  Segment,
  TranscribeOptions,
  WhisperAppApi,
} from '../shared/types';

const api = {
  // app state (engine status, language, permissions, recent dictations)
  getState: () => ipcRenderer.invoke('app:get-state'),
  onState: (fn: (state: AppState) => void) => void ipcRenderer.on('app:state', (_e, state: AppState) => fn(state)),
  setLanguage: (code: string) => ipcRenderer.invoke('app:set-language', code),
  setOpenAtLogin: (on: boolean) => ipcRenderer.invoke('app:set-open-at-login', on),
  setSounds: (on: boolean) => ipcRenderer.invoke('app:set-sounds', on),
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text),
  openPrivacySettings: (kind: PermissionKind | 'keyboard') => ipcRenderer.invoke('app:open-privacy', kind),

  // file transcription
  pickFile: () => ipcRenderer.invoke('file:pick'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file), // for drag-and-drop
  fileInfo: (path: string) => ipcRenderer.invoke('file:info', path),
  transcribeFile: (path: string) => ipcRenderer.invoke('file:transcribe', path),
  cancelTranscription: () => ipcRenderer.invoke('file:cancel'),
  onProgress: (fn: (p: Progress) => void) => void ipcRenderer.on('file:progress', (_e, p: Progress) => fn(p)),
  copyTranscript: (segments: Segment[]) => ipcRenderer.invoke('transcript:copy', segments), // with timestamps
  saveTranscript: (segments: Segment[], sourceName: string) =>
    ipcRenderer.invoke('transcript:save', segments, sourceName),
  revealFile: (path: string) => ipcRenderer.invoke('file:reveal', path), // open Finder with the file selected

  setHotkey: (hotkey: Hotkey) => ipcRenderer.invoke('app:set-hotkey', hotkey),
  setHotkeyTest: (on: boolean) => ipcRenderer.invoke('app:set-hotkey-test', on),
  onHotkeyEvent: (fn: (event: 'down' | 'up' | 'combo') => void) =>
    void ipcRenderer.on('hotkey:event', (_e, event: 'down' | 'up' | 'combo') => fn(event)),
  onHotkeyTesting: (fn: (on: boolean) => void) => void ipcRenderer.on('hotkey:testing', (_e, on: boolean) => fn(on)),
  onShowPage: (fn: (page: string) => void) => void ipcRenderer.on('app:show-page', (_e, page: string) => fn(page)),

  // first-run setup
  setup: {
    goTo: (step: number) => ipcRenderer.invoke('setup:go-to', step),
    finish: () => ipcRenderer.invoke('setup:finish'),
    restart: () => ipcRenderer.invoke('setup:restart'),
    grant: (kind: PermissionKind) => ipcRenderer.invoke('setup:grant', kind),
    refreshPermissions: () => ipcRenderer.invoke('setup:refresh-permissions'),
  },

  // Whisper models (Settings → Models)
  models: {
    download: (id: string) => ipcRenderer.invoke('models:download', id),
    cancelDownload: () => ipcRenderer.invoke('models:cancel'),
    setActive: (id: string) => ipcRenderer.invoke('models:set-active', id),
    delete: (id: string) => ipcRenderer.invoke('models:delete', id),
    onProgress: (fn: (p: ModelProgress) => void) =>
      void ipcRenderer.on('models:progress', (_e, p: ModelProgress) => fn(p)),
  },

  // Library page (meetings + transcribed files in ~/Documents/L - Whisper Library)
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    get: (id: string) => ipcRenderer.invoke('library:get', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('library:rename', id, title),
    delete: (id: string) => ipcRenderer.invoke('library:delete', id),
    reveal: (id: string) => ipcRenderer.invoke('library:reveal', id),
    transcribe: (id: string, opts: TranscribeOptions) => ipcRenderer.invoke('library:transcribe', id, opts),
    cancel: () => ipcRenderer.invoke('library:cancel'),
    onProgress: (fn: (p: LibraryProgress) => void) =>
      void ipcRenderer.on('library:progress', (_e, p: LibraryProgress) => fn(p)),
    onChanged: (fn: () => void) => void ipcRenderer.on('library:changed', () => fn()),
    summarize: (id: string) => ipcRenderer.invoke('library:summarize', id),
    cancelSummary: () => ipcRenderer.invoke('library:summarize-cancel'),
  },

  // Settings → AI summary (task 26): the user's Claude Code / Codex subscription
  ai: {
    setProvider: (provider: 'off' | AiProvider) => ipcRenderer.invoke('ai:set-provider', provider),
    status: () => ipcRenderer.invoke('ai:status'),
    choosePath: () => ipcRenderer.invoke('ai:choose-path'),
    test: () => ipcRenderer.invoke('ai:test'),
  },
} satisfies WhisperAppApi;

contextBridge.exposeInMainWorld('whisperApp', api);
