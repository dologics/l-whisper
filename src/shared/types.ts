// Shared types: the shapes of data that travel between the main process and the windows.
// Types only — nothing here exists at runtime. The main process, the preloads and the
// window scripts all use these, so a change in one place is checked everywhere.

// ---------- settings ----------

/** Modifier keys the helper reports (left and right count the same). */
export type Modifier = 'fn' | 'control' | 'option' | 'shift' | 'command';

/** The dictation key: Fn alone, or exactly two other modifiers held together (e.g. ⌃⌥). */
export type Hotkey = { kind: 'fn' } | { kind: 'combo'; keys: [Modifier, Modifier] };

/** settings.json in the app data folder. */
export interface SettingsValues {
  /** 'auto' or a Whisper language code like 'en' */
  language: string;
  /** soft beeps when dictation starts / finishes */
  sounds: boolean;
  /** set after the installed app's first launch (turns on Open at Login once) */
  launchedBefore?: boolean;
  /** id of the Whisper model in use (see src/main/models/catalog.ts) */
  activeModel?: string;
  /** the dictation key (default Fn) */
  hotkey?: Hotkey;
  /** first-run setup finished (or skipped for an existing install) */
  onboarded?: boolean;
  /** setup page reached so far (0 = welcome) — so quitting midway resumes there */
  setupStep?: number;
  /** AI summary (task 26): which subscription tool to use; missing = 'off' */
  aiProvider?: 'off' | AiProvider;
  /** AI summary: the tool's path, only when the user chose it by hand (Settings → Choose…) */
  aiCliPath?: string;
  /** the user's name (task 28), labels the mic side in meeting transcripts; missing/'' = no name */
  userName?: string;
}

// ---------- AI summary (task 26) ----------

/** The user's own AI tool, signed in with their subscription: Claude Code or Codex. */
export type AiProvider = 'claude' | 'codex';

/** Settings → AI summary: is the chosen tool on this Mac? */
export interface AiStatus {
  provider: 'off' | AiProvider;
  /** full path of the program, or null if it wasn't found */
  path: string | null;
  /** e.g. "2.1.309 (Claude Code)" */
  version: string | null;
  /** the path was chosen by hand */
  manual: boolean;
}

/** A saved summary of a Library item. */
export interface SummaryInfo {
  /** Markdown (headings, bullets, **bold**) */
  text: string;
  provider: AiProvider | null;
  /** ms since 1970 */
  createdAt: number;
  /** the item was transcribed again after this summary was made */
  outdated: boolean;
}

// ---------- transcripts ----------

/** One timed piece of a transcript (seconds). `end` may be missing. */
export interface Segment {
  start: number;
  end?: number;
  text: string;
}

/** Overall progress of a file/meeting transcription. */
export interface Progress {
  percent: number;
  /** estimated seconds left (0 = unknown) */
  etaSec: number;
}

/** Per-call transcription choices (meetings page). */
export interface TranscribeOptions {
  /** overrides the app-wide language ('auto' | 'en' | 'ur' …) */
  language?: string;
  /** output English whatever language is spoken (whisper -tr) */
  translate?: boolean;
}

/** What a finished transcription returns. */
export interface TranscribeResult {
  segments: Segment[];
  durationSec: number;
  elapsedMs: number;
  language: string;
  translate: boolean;
}

/** A dropped/chosen file we can transcribe… */
export interface FileInfoOk {
  ok: true;
  path: string;
  name: string;
  /** upper-case extension, e.g. "MP3" */
  ext: string;
  size: number;
  durationSec: number;
}
/** …or why we can't. */
export interface FileInfoError {
  ok: false;
  error: string;
}
export type FileInfo = FileInfoOk | FileInfoError;

/** A finished file transcript kept in the Recent list (memory only). */
export interface RecentFile extends TranscribeResult {
  id: number;
  time: number;
  name: string;
  ext: string;
  size: number;
}

// ---------- app state shown in the window ----------

/** 'no-model' = no Whisper model downloaded/chosen yet */
export type EngineState = 'loading' | 'ready' | 'error' | 'no-model';
export type PermissionKind = 'microphone' | 'inputMonitoring' | 'accessibility';
export type SoundName = 'start' | 'done' | 'none';

export interface LanguageOption {
  code: string;
  label: string;
}

/** A recent dictation (memory only, never saved). */
export interface DictationItem {
  time: number;
  text: string;
}

/** One Whisper model as shown in Settings → Models. */
export interface ModelEntry {
  id: string;
  label: string;
  sizeBytes: number;
  note: string;
  /** the complete file is on this Mac */
  downloaded: boolean;
  /** bytes already on disk (for a paused download: how far it got) */
  bytesOnDisk: number;
  active: boolean;
  recommended: boolean;
  /** why the last download of this model failed (until the next try) */
  error?: string;
}

/** Progress of the model download in progress. */
export interface ModelProgress {
  id: string;
  phase: 'downloading' | 'verifying';
  received: number;
  total: number;
  bytesPerSec: number;
}

export interface AppState {
  engine: { state: EngineState; error: string | null };
  language: string;
  languages: LanguageOption[];
  /** name of the active Whisper model, or null if none is chosen */
  model: string | null;
  /** the dictation key and its short label ("fn", "⌃⌥") */
  hotkey: Hotkey;
  hotkeyLabel: string;
  /** Fn is the key but macOS also uses it (System Settings → Keyboard → "Press 🌐 key to") */
  fnKeyConflict: boolean;
  /** version + credits (Settings → About) */
  about: { version: string; company: string; builtBy: string; license: string; repoUrl: string };
  /** first-run setup: show it? which page? */
  setup: { needed: boolean; step: number };
  models: ModelEntry[];
  /** the download in progress, or null */
  download: ModelProgress | null;
  isPackaged: boolean;
  openAtLogin: boolean;
  sounds: boolean;
  /** Settings → Your name ('' = not set) */
  userName: string;
  /** null = not known yet (the helper hasn't answered) */
  permissions: Record<PermissionKind, boolean | null>;
  dictations: DictationItem[];
  recentFiles: RecentFile[];
  /** AI summary tool chosen in Settings ('off' = none) */
  aiProvider: 'off' | AiProvider;
  supported: string[];
}

// ---------- replies from main for actions that can fail ----------

/** Success (with extra fields) or a failure the window can show. */
export type Outcome<T extends object = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      cancelled?: boolean;
      error?: string;
      /** AI summary: no AI set up → open Settings */ needsSetup?: boolean;
    };

// ---------- library (meetings + transcribed files) ----------

/** Summary of an item's saved transcript. */
export interface TranscriptInfo {
  language: string;
  translate: boolean;
  /** number of segments */
  segments: number;
}

/** 'meeting' = recorded by the app (audio in its folder); 'file' = a dropped/chosen file (audio stays where it is). */
export type LibraryKind = 'meeting' | 'file';

/** The meeting being recorded right now (no audio file yet). */
export interface RecordingItem {
  id: string;
  title: string;
  kind: 'meeting';
  recording: true;
  created: number;
}

/** A finished meeting, or a transcribed file. */
export interface LibraryEntry {
  id: string;
  title: string;
  kind: LibraryKind;
  recording?: false;
  created: number;
  /** size of the audio (meeting) or of the original file (0 if it's gone) */
  size: number;
  durationSec: number;
  /** upper-case extension of the audio/original, e.g. "M4A", "MP4" */
  ext: string;
  transcript: TranscriptInfo | null;
  /** file items: where the original file is (it is never copied or moved) */
  source?: string;
  /** file items: the original was moved or deleted (no play, no re-transcribe) */
  sourceMissing?: boolean;
  /** an AI summary has been saved for it */
  hasSummary: boolean;
}

export type LibraryListItem = RecordingItem | LibraryEntry;

/** One item opened in the Library's detail view. */
export interface LibraryItemDetail extends LibraryEntry {
  folder: string;
  segments: Segment[];
  summary: SummaryInfo | null;
  /** the item's saved files that exist, in a fixed order (Files tab, task 30) */
  files: SavedFileInfo[];
}

/** Files saved in an item's folder that the Files tab can show. */
export type SavedFileKind = 'txt' | 'srt' | 'vtt' | 'json' | 'summary';

export interface SavedFileInfo {
  kind: SavedFileKind;
  /** file name, e.g. "Meeting 2026-11-05 10-30.srt" */
  name: string;
  /** bytes */
  size: number;
}

/** One saved file, read for the Files tab. */
export interface SavedFile extends SavedFileInfo {
  path: string;
  text: string;
}

export interface LibraryProgress extends Progress {
  id: string;
}

// ---------- window APIs (exposed by the preloads) ----------

/** window.whisperApp — everything the main window may ask the app to do. */
export interface WhisperAppApi {
  getState(): Promise<AppState>;
  onState(fn: (state: AppState) => void): void;
  setLanguage(code: string): Promise<void>;
  setOpenAtLogin(on: boolean): Promise<void>;
  setSounds(on: boolean): Promise<void>;
  /** save the user's name (cleaned in main; '' clears it) */
  setUserName(name: string): Promise<void>;
  copyText(text: string): Promise<void>;
  /** open System Settings at a permission's pane, or at Keyboard ('keyboard') */
  openPrivacySettings(kind: PermissionKind | 'keyboard'): Promise<void>;

  pickFile(): Promise<string | null>;
  getPathForFile(file: File): string;
  fileInfo(path: string): Promise<FileInfo>;
  /** transcribe a dropped/chosen file; the transcript is also saved to the Library (`libraryId`) */
  transcribeFile(path: string): Promise<Outcome<TranscribeResult & { libraryId: string | null }>>;
  cancelTranscription(): Promise<void>;
  onProgress(fn: (progress: Progress) => void): void;
  copyTranscript(segments: Segment[]): Promise<void>;
  saveTranscript(segments: Segment[], sourceName: string): Promise<Outcome<{ path: string }>>;
  revealFile(path: string): Promise<void>;
  /** change the dictation key (Fn, or two modifiers) */
  setHotkey(hotkey: Hotkey): Promise<Outcome>;
  /** while on, pressing the key only lights the test indicator (no dictation); turns off after 20 s */
  setHotkeyTest(on: boolean): Promise<void>;
  /** live dictation-key events (for the test indicator in Settings) */
  onHotkeyEvent(fn: (event: 'down' | 'up' | 'combo') => void): void;
  /** the key test was switched on/off (it switches itself off after 20 s) */
  onHotkeyTesting(fn: (on: boolean) => void): void;
  /** main asks the window to show a page (e.g. 'settings' when no model is chosen) */
  onShowPage(fn: (page: string) => void): void;

  /** first-run setup (also: Settings → Run setup again) */
  setup: {
    goTo(step: number): Promise<void>;
    finish(): Promise<void>;
    restart(): Promise<void>;
    /** ask macOS for a permission (prompt, or open its System Settings pane) */
    grant(kind: PermissionKind): Promise<void>;
    /** re-check permissions now (answer arrives as a state update) */
    refreshPermissions(): Promise<void>;
  };

  models: {
    /** download (or resume) a model; it becomes the active model when done */
    download(id: string): Promise<Outcome>;
    cancelDownload(): Promise<void>;
    setActive(id: string): Promise<Outcome>;
    /** asks for confirmation first */
    delete(id: string): Promise<Outcome>;
    onProgress(fn: (progress: ModelProgress) => void): void;
  };

  ai: AiApi;

  /** the Library page: meetings and transcribed files */
  library: {
    list(): Promise<LibraryListItem[]>;
    get(id: string): Promise<LibraryItemDetail>;
    /** one of the item's saved files, as it is on disk (Files tab) */
    readFile(id: string, kind: SavedFileKind): Promise<SavedFile>;
    rename(id: string, title: string): Promise<Outcome<{ id: string }>>;
    /** asks for confirmation first; a file item's original is never touched */
    delete(id: string): Promise<Outcome>;
    /** open the item's folder in Finder */
    reveal(id: string): Promise<void>;
    transcribe(id: string, opts: TranscribeOptions): Promise<Outcome<TranscribeResult>>;
    cancel(): Promise<void>;
    onProgress(fn: (progress: LibraryProgress) => void): void;
    onChanged(fn: () => void): void;
    /** AI summary of the item's transcript, saved as <name>.summary.md in its folder (only on click) */
    summarize(id: string): Promise<Outcome<{ summary: SummaryInfo }>>;
    cancelSummary(): Promise<void>;
  };
}

/** Settings → AI summary. */
export interface AiApi {
  setProvider(provider: 'off' | AiProvider): Promise<void>;
  /** where the chosen tool is (found automatically, or chosen by hand) */
  status(): Promise<AiStatus>;
  /** pick the program file by hand (native Open dialog) */
  choosePath(): Promise<AiStatus>;
  /** send a tiny "Reply with OK" to check it's installed and signed in */
  test(): Promise<Outcome<{ reply: string }>>;
}

/** window.recorder — the hidden recorder window's bridge. */
export interface RecorderBridge {
  onStart(fn: () => void): void;
  onStop(fn: () => void): void;
  onPlaySound(fn: (name: SoundName) => void): void;
  started(): void;
  failed(message: string): void;
  audio(wav: ArrayBuffer): void;
}
