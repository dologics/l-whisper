// WhisperApp: the whole app in the main process — tray icon, window, whisper-server,
// the Fn hotkey, auto-paste, file transcription and meeting recording.
// main.ts creates one instance and calls start() once Electron is ready.
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  shell,
  systemPreferences,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import os from 'node:os';
import path from 'node:path';
import type {
  AppState,
  DictationItem,
  EngineState,
  LanguageOption,
  ModelProgress,
  Outcome,
  PermissionKind,
  RecentFile,
  SoundName,
} from '../shared/types';
import { AiSummary } from './ai/ai-summary';
import { Dictation, type DictationState } from './dictation';
import { FileTranscriber, SUPPORTED } from './file-transcriber';
import { DEFAULT_HOTKEY, HotkeyMatcher, hotkeyLabel, parseHotkey, type HotkeyEvent } from './hotkey';
import { HotkeyGesture } from './hotkey-gesture';
import { KeyListener, type HelperPermissions } from './key-listener';
import { registerIpc } from './ipc';
import { MeetingRecorder } from './meeting';
import { Library, prepareLibraryDir } from './library';
import { registerLibraryProtocol } from './library-protocol';
import { MODEL_BASE_URL, recommendedModelId } from './models/catalog';
import { DownloadCancelled, ModelDownloader } from './models/model-downloader';
import { ModelStore } from './models/model-store';
import {
  FN_HELPER_PATH,
  MEETING_HELPER_PATH,
  MODELS_DIR,
  LIBRARY_DIR,
  OLD_RECORDINGS_DIR,
  ROOT,
  TOOLS,
  VAD_MODEL_PATH,
} from './paths';
import { MicRecorder } from './recorder';
import { Settings } from './settings';
import { aboutInfo, setAboutPanel } from './about';
import { openSystemSettings } from './system-settings';
import { errorMessage, run, sleep } from './util';
import { WhisperEngine } from './whisper';

// Languages offered in the menu bar. Add more here: { code: 'ur', label: 'Urdu' }.
const LANGUAGES: LanguageOption[] = [
  { code: 'auto', label: 'Auto-detect (slower)' },
  { code: 'en', label: 'English (faster)' },
];

const MAX_DICTATIONS = 20;

export class WhisperApp {
  readonly settings = new Settings(app.getPath('userData'));

  /** downloaded Whisper models + which one is active (Settings → Models) */
  readonly models = new ModelStore({
    dir: MODELS_DIR,
    getActive: () => this.settings.get('activeModel'),
    saveActive: (id) => this.settings.set('activeModel', id),
    log: (m) => console.log(`[models] ${m}`),
  });

  /** downloads model files (the app's only network access — never audio or text) */
  private readonly downloader = new ModelDownloader({
    dir: MODELS_DIR,
    baseUrl: MODEL_BASE_URL,
    log: (m) => console.log(`[models] ${m}`),
  });
  private download: ModelProgress | null = null; // the download in progress
  private readonly downloadErrors = new Map<string, string>(); // model id → why its last download failed
  private lastNeedModelAt = 0;

  /** whisper-server running in the background with the model loaded (dictation) */
  readonly engine = new WhisperEngine({
    binaryPath: TOOLS.whisperServer,
    modelPath: '', // set in start(), once the models folder has been checked
    vadModelPath: VAD_MODEL_PATH, // skip silence
    language: this.settings.get('language'),
    log: (m) => console.log(`[whisper] ${m}`),
  });

  /** ffmpeg + whisper-cli, same model and language as dictation */
  readonly fileTranscriber = new FileTranscriber({
    getModelPath: () => this.models.activePath(),
    tools: TOOLS,
    getLanguage: () => this.engine.language,
    log: (m) => console.log(`[file] ${m}`),
  });

  /**
   * The Library folder (meetings + transcribed files). The first launch of this version moves the
   * old "L - Whisper Recordings" folder here; if that fails, the old folder keeps being used.
   * Decided before the recorder and the library below are created (they both use it).
   */
  readonly libraryDir = prepareLibraryDir(LIBRARY_DIR, OLD_RECORDINGS_DIR, (m) => console.log(`[library] ${m}`));

  /** mic + system audio → .m4a (audio only) */
  readonly meeting = new MeetingRecorder({
    helperPath: MEETING_HELPER_PATH,
    ffmpegPath: TOOLS.ffmpeg,
    outDir: this.libraryDir,
    log: (m) => console.log(`[meeting] ${m}`),
    onTick: ({ seconds, mic, sys }) => {
      this.refreshTitle();
      if (seconds % 10 === 0) this.updateTrayMenu(); // keep the "Stop (12:34)" label roughly current
      if (process.env.WHISPER_MEETING_TEST) console.log(`[meeting] ${seconds}s mic=${mic} dB sys=${sys} dB`);
    },
    onMicChange: () => this.updateTrayMenu(), // show the new mic in the menu
    onUnexpectedStop: () => {
      console.error('[meeting] recorder stopped unexpectedly — saving what we have');
      void this.stopMeeting();
    },
  });

  /** Library page: meetings + transcribed files — list / play / rename / delete / transcribe */
  readonly library = new Library({
    dir: this.libraryDir,
    ffprobePath: TOOLS.ffprobe,
    transcriber: this.fileTranscriber,
    recordingFolder: () => this.meeting.folder,
    log: (m) => console.log(`[library] ${m}`),
  });

  /** AI summary with the user's Claude Code / Codex subscription — only when they click (task 26) */
  readonly ai = new AiSummary({
    settings: this.settings,
    library: this.library,
    log: (m) => console.log(`[ai] ${m}`),
  });

  // Created once the app is ready (they need Electron's windows/tray).
  private recorder: MicRecorder | null = null;
  private dictation: Dictation | null = null;
  private keys: KeyListener | null = null; // the Swift helper: modifier keys + paste
  private gesture: HotkeyGesture | null = null;
  /** turns held modifiers into down / up / combo for the chosen dictation key */
  private readonly matcher = new HotkeyMatcher(this.hotkey());
  private hotkeyTesting = false; // Settings → "Test": key presses only light the indicator
  private hotkeyTestTimer: NodeJS.Timeout | undefined;
  private fnKeyConflict = false; // macOS also reacts to Fn (🌐 key setting)
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;

  private isQuitting = false;
  private handsFree = false;
  private sleepBlocker: number | null = null; // keeps the Mac awake while a meeting records
  private dictationTitle = ''; // ● / … shown next to the tray icon during dictation

  // What the window shows (sent to it whenever something changes).
  private engineStatus: { state: EngineState; error: string | null } = { state: 'loading', error: null };
  private helperPermissions: HelperPermissions = {}; // from the Swift helper
  /** recent dictations, newest first — memory only, never saved to disk */
  readonly dictations: DictationItem[] = [];
  /** finished file transcripts, newest first — memory only */
  readonly recentFiles: RecentFile[] = [];

  // ---------- window ----------

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 880,
      height: 600,
      minWidth: 640,
      minHeight: 460,
      show: false,
      title: 'L - Whisper',
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true, // page can't touch Node.js directly
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.mainWindow = win;

    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // Closing the window only hides it; the app keeps living in the menu bar.
    win.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on('hide', () => app.dock?.hide());
    win.on('show', () => void app.dock?.show());
    // Permissions may have changed in System Settings while we were in the background.
    win.on('focus', () => {
      this.keys?.requestPermissions();
      void this.checkFnKeyConflict(); // the 🌐 key setting may have changed too
    });
    return win;
  }

  /** The main window (created if needed) — also the parent for dialogs. */
  window(): BrowserWindow {
    return this.mainWindow ?? this.createWindow();
  }

  showWindow(): void {
    const win = this.window();
    win.show();
    win.focus();
  }

  getState(): AppState {
    return {
      engine: this.engineStatus,
      language: this.engine.language,
      languages: LANGUAGES,
      model: this.activeModelLabel(),
      hotkey: this.hotkey(),
      hotkeyLabel: hotkeyLabel(this.hotkey()),
      fnKeyConflict: this.hotkey().kind === 'fn' && this.fnKeyConflict,
      setup: { needed: !this.settings.get('onboarded'), step: this.settings.get('setupStep') ?? 0 },
      about: aboutInfo(),
      models: this.models.list().map((m) => ({
        id: m.id,
        label: m.label,
        sizeBytes: m.sizeBytes,
        note: m.note,
        downloaded: m.downloaded,
        bytesOnDisk: m.bytesOnDisk,
        active: m.active,
        recommended: m.id === recommendedModelId(os.totalmem()),
        error: this.downloadErrors.get(m.id),
      })),
      download: this.download,
      isPackaged: app.isPackaged,
      openAtLogin: app.getLoginItemSettings().openAtLogin,
      sounds: this.settings.get('sounds'),
      permissions: {
        microphone: systemPreferences.getMediaAccessStatus('microphone') === 'granted',
        inputMonitoring: this.helperPermissions.input ?? null,
        accessibility: this.helperPermissions.accessibility ?? null,
      },
      dictations: this.dictations,
      recentFiles: this.recentFiles,
      aiProvider: this.ai.provider(),
      supported: SUPPORTED,
    };
  }

  /** Send the latest state to the window (if it's open). */
  pushState(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('app:state', this.getState());
    }
  }

  /** Tell the window the Library changed (recording started/stopped, file transcribed, rename, delete…). */
  libraryChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('library:changed');
  }

  // ---------- tray (menu bar icon) ----------

  private createTray(): void {
    const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'trayTemplate.png'));
    icon.setTemplateImage(true); // let macOS recolor it for light/dark menu bar
    this.tray = new Tray(icon);
    this.setStatus('starting…');
    this.updateTrayMenu();
  }

  private updateTrayMenu(): void {
    if (!this.tray) return;
    const { meeting } = this;
    const template: MenuItemConstructorOptions[] = [
      {
        label: `Hold ${hotkeyLabel(this.hotkey())} to talk · double-tap for hands-free`,
        enabled: false,
      },
      // Fallback for keyboards without Fn: acts like hands-free start/stop.
      {
        label: this.dictation?.isActive ? 'Stop Dictation' : 'Start Dictation (hands-free)',
        click: () => this.toggleFromMenu(),
      },
      { type: 'separator' },
      // Meeting recording: audio only (you + system audio), no transcription.
      meeting.isRecording
        ? { label: `Stop Meeting Recording (${formatClock(meeting.seconds)})`, click: () => void this.stopMeeting() }
        : { label: 'Start Meeting Recording', click: () => void this.startMeeting() },
      ...(meeting.isRecording && meeting.micName
        ? [{ label: `Recording mic: ${meeting.micName}`, enabled: false }]
        : []),
      { label: 'Open Library', click: () => this.showLibrary() },
      { type: 'separator' },
      {
        label: 'Language',
        submenu: LANGUAGES.map(({ code, label }) => ({
          label,
          type: 'radio' as const,
          checked: this.engine.language === code,
          click: () => this.setLanguage(code),
        })),
      },
      {
        label: 'Open at Login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        enabled: app.isPackaged, // only meaningful for the installed app
        click: (item) => this.setOpenAtLogin(item.checked),
      },
      { type: 'separator' },
      { label: 'Open L - Whisper', click: () => this.showWindow() },
      { label: 'About L - Whisper', click: () => this.showAbout() },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  /** macOS's standard About window (version + credits). */
  private showAbout(): void {
    app.focus({ steal: true }); // a menu bar app isn't in front — bring the window up
    app.showAboutPanel();
  }

  private setStatus(text: string): void {
    this.tray?.setToolTip(`L - Whisper — ${text}`);
  }

  /** Text next to the menu bar icon: dictation (●, …) wins; otherwise the meeting timer. */
  private refreshTitle(): void {
    if (!this.tray) return;
    if (this.dictationTitle) this.tray.setTitle(this.dictationTitle);
    else if (this.meeting.isRecording) this.tray.setTitle(` ◉ ${formatClock(this.meeting.seconds)}`);
    else this.tray.setTitle('');
  }

  // ---------- settings ----------

  setLanguage(code: string): void {
    this.engine.language = code; // used by the next transcription — no restart needed
    this.settings.set('language', code);
    console.log(`[settings] language → ${code}`);
    this.updateTrayMenu();
    this.pushState();
  }

  setOpenAtLogin(on: boolean): void {
    if (!app.isPackaged) return; // `npm start` must never register itself as a login item
    app.setLoginItemSettings({ openAtLogin: on });
    console.log(`[settings] open at login → ${on}`);
    this.updateTrayMenu();
    this.pushState();
  }

  setSounds(on: boolean): void {
    this.settings.set('sounds', on);
    console.log(`[settings] sounds → ${on}`);
    if (on) this.sound('start'); // preview, so you hear what you turned on
    this.pushState();
  }

  /** Feedback sound, if the user has sounds on. */
  private sound(name: SoundName): void {
    if (!this.settings.get('sounds')) return;
    console.log(`[sound] ${name}`);
    this.recorder?.playSound(name);
  }

  // ---------- meeting recording ----------

  async startMeeting(): Promise<void> {
    if (this.meeting.isRecording) return;
    try {
      const { path: file } = await this.meeting.start();
      this.sleepBlocker = powerSaveBlocker.start('prevent-app-suspension'); // don't let the Mac sleep
      console.log(`[meeting] started → ${file}`);
      this.sound('start');
      this.libraryChanged();
    } catch (err) {
      console.error(`[meeting] could not start: ${errorMessage(err)}`);
      notify('Meeting recording did not start', errorMessage(err));
    }
    this.refreshTitle();
    this.updateTrayMenu();
  }

  async stopMeeting(): Promise<void> {
    if (!this.meeting.isRecording) return;
    try {
      const { path: file, seconds, size } = await this.meeting.stop();
      notify(
        'Meeting recording saved',
        `${path.basename(file)} · ${formatClock(seconds)} · ${(size / 1024 ** 2).toFixed(1)} MB`,
        file
      );
      this.sound('done');
      this.libraryChanged();
    } catch (err) {
      console.error(`[meeting] could not save: ${errorMessage(err)}`);
      notify('Meeting recording problem', errorMessage(err));
    } finally {
      if (this.sleepBlocker !== null) powerSaveBlocker.stop(this.sleepBlocker);
      this.sleepBlocker = null;
      this.refreshTitle();
      this.updateTrayMenu();
    }
  }

  /** Tray → Open Library: the window on the Library page. */
  private showLibrary(): void {
    this.showWindow();
    this.mainWindow?.webContents.send('app:show-page', 'library');
  }

  // ---------- dictation ----------

  /** Small text next to the menu bar icon so you can see what's happening. */
  private onDictationState(state: DictationState, detail?: string): void {
    const titles: Partial<Record<DictationState, string>> = {
      recording: this.handsFree ? ' ● hands-free' : ' ●',
      transcribing: ' …',
    };
    this.dictationTitle = titles[state] || '';
    this.refreshTitle();
    if (state !== 'recording') this.handsFree = false;
    this.setStatus(detail ? `${state}: ${detail}` : state === 'idle' ? 'ready' : state);
    this.updateTrayMenu();
    if (state === 'recording') this.sound('start'); // mic is live → speak now
    if (state === 'idle' && detail === 'no speech detected') this.sound('none');
  }

  private async onText(text: string): Promise<void> {
    console.log(`[dictation] TEXT: "${text}"`);
    this.dictations.unshift({ time: Date.now(), text });
    this.dictations.length = Math.min(this.dictations.length, MAX_DICTATIONS);
    this.pushState();
    try {
      if (!this.keys) throw new Error('helper is not running');
      // Automated test runs must never type into the user's apps.
      const reply = await this.keys.paste(text, { dry: Boolean(process.env.WHISPER_RECORD_TEST) });
      console.log(`[paste] ${reply}`);
      this.sound('done'); // text is in place
      this.setStatus(`ready — last: "${text.slice(0, 60)}"`);
    } catch (err) {
      const message = errorMessage(err);
      console.error(`[paste] failed: ${message}`);
      this.sound('none');
      this.setStatus(
        message.includes('accessibility')
          ? 'allow Accessibility for pasting (System Settings → Privacy & Security → Accessibility), then dictate again'
          : `paste failed: ${message}`
      );
    }
  }

  private toggleFromMenu(): void {
    if (!this.dictation) return;
    if (this.dictation.isActive) void this.dictation.stop();
    else if (!this.models.activeId()) this.needModel();
    else this.dictation.start();
  }

  // ---------- Whisper models (Settings → Models) ----------

  private activeModelLabel(): string | null {
    const id = this.models.activeId();
    return id ? this.models.info(id).label : null;
  }

  /** Dictation was asked for but no model is chosen: say so and open Settings (not on every key press). */
  private needModel(): void {
    this.setStatus('choose a Whisper model in Settings → Models');
    if (Date.now() - this.lastNeedModelAt < 5000) return;
    this.lastNeedModelAt = Date.now();
    this.sound('none');
    this.showWindow();
    this.window().webContents.send('app:show-page', 'settings:models'); // Settings page, Models tab
  }

  /** Download (or resume) a model, then make it the active model. */
  async downloadModel(id: string): Promise<Outcome> {
    const model = this.models.info(id);
    this.downloadErrors.delete(id);
    this.download = { id, phase: 'downloading', received: 0, total: model.sizeBytes, bytesPerSec: 0 };
    this.pushState();
    try {
      await this.downloader.download(model, (p) => {
        this.download = p;
        this.window().webContents.send('models:progress', p);
      });
      this.download = null;
      return this.setActiveModel(id); // the user asked for it → use it
    } catch (err) {
      this.download = null;
      if (err instanceof DownloadCancelled) {
        this.pushState();
        return { ok: false, cancelled: true };
      }
      console.error(`[models] download of ${id} failed: ${errorMessage(err)}`);
      this.downloadErrors.set(id, errorMessage(err));
      this.pushState();
      return { ok: false, error: errorMessage(err) };
    }
  }

  cancelModelDownload(): void {
    this.downloader.cancel();
  }

  /** Switch to another downloaded model (not in the middle of a dictation or transcription). */
  setActiveModel(id: string): Outcome {
    if (this.dictation?.isActive || this.fileTranscriber.busy) {
      return { ok: false, error: 'Wait until the current dictation or transcription has finished.' };
    }
    try {
      this.models.setActive(id);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
    this.engine.setModel(this.models.pathOf(id));
    void this.startEngine(); // load the new model now, so the next dictation is fast
    this.updateTrayMenu();
    this.pushState();
    return { ok: true };
  }

  /** Delete a downloaded model after asking. */
  async deleteModel(id: string): Promise<Outcome> {
    const model = this.models.info(id);
    const { response } = await dialog.showMessageBox(this.window(), {
      type: 'warning',
      message: `Delete the ${model.label} model?`,
      detail: `This frees ${Math.round(model.sizeBytes / 1024 ** 2)} MB. You can download it again any time.`,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    try {
      this.models.delete(id);
      this.downloadErrors.delete(id);
      this.pushState();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  // ---------- first-run setup ----------

  setSetupStep(step: number): void {
    if (!Number.isInteger(step) || step < 0 || step > 10) return;
    this.settings.set('setupStep', step);
    this.pushState();
  }

  finishSetup(): void {
    this.settings.set('onboarded', true);
    this.settings.set('setupStep', 0);
    this.setHotkeyTest(false);
    console.log('[setup] finished');
    this.pushState();
  }

  /** Settings → Run setup again. */
  restartSetup(): void {
    this.settings.set('onboarded', false);
    this.settings.set('setupStep', 0);
    this.pushState();
  }

  /** Setup → Grant: show macOS's prompt where possible, else open the right System Settings pane. */
  async grantPermission(kind: PermissionKind): Promise<void> {
    if (kind === 'microphone') {
      // First time: macOS shows its prompt. Denied before: only System Settings can change it.
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
      else if (status !== 'granted') await openSystemSettings('microphone');
    } else if (kind === 'accessibility') {
      this.keys?.askAccessibility(); // adds the app to the Accessibility list (+ macOS prompt)
      await openSystemSettings('accessibility');
    } else {
      // Input Monitoring: the helper already asked at startup, so the app is in the list.
      await openSystemSettings('inputMonitoring');
    }
    this.refreshPermissions();
  }

  /** Re-check permissions (the helper answers with a 'permissions' event → pushState). */
  refreshPermissions(): void {
    this.keys?.requestPermissions();
    this.pushState(); // microphone status is read directly in getState()
  }

  // ---------- dictation key (Fn or two modifiers) ----------

  /** The chosen dictation key (Fn unless the user picked a combination). */
  hotkey() {
    return parseHotkey(this.settings.get('hotkey')) ?? DEFAULT_HOTKEY;
  }

  /** Change the dictation key. */
  setHotkey(value: unknown): Outcome {
    const hotkey = parseHotkey(value);
    if (!hotkey) return { ok: false, error: 'Choose Fn, or two different keys from ⌃ ⌥ ⇧ ⌘.' };
    this.settings.set('hotkey', hotkey);
    this.matcher.setHotkey(hotkey);
    this.gesture?.reset();
    if (this.dictation?.isActive) void this.dictation.cancel();
    console.log(`[keys] dictation key → ${hotkeyLabel(hotkey)}`);
    this.updateTrayMenu();
    this.pushState();
    return { ok: true };
  }

  /** Settings → Test: for a while, key presses only light the indicator (no dictation). */
  setHotkeyTest(on: boolean): void {
    this.hotkeyTesting = on;
    clearTimeout(this.hotkeyTestTimer);
    if (on) this.hotkeyTestTimer = setTimeout(() => this.setHotkeyTest(false), 20_000);
    this.window().webContents.send('hotkey:testing', on);
  }

  /**
   * Is macOS also using Fn? (System Settings → Keyboard → "Press 🌐 key to": anything but
   * "Do Nothing" — stored as AppleFnUsageType, 0 = Do Nothing; missing = macOS default, which acts.)
   */
  private async checkFnKeyConflict(): Promise<void> {
    let conflict: boolean;
    try {
      conflict = (await run('defaults', ['read', 'com.apple.HIToolbox', 'AppleFnUsageType'])).trim() !== '0';
    } catch {
      conflict = true;
    }
    if (conflict !== this.fnKeyConflict) {
      this.fnKeyConflict = conflict;
      this.pushState();
    }
  }

  private startKeys(dictation: Dictation): void {
    const gesture = new HotkeyGesture({
      onStart: () => {
        if (this.models.activeId()) dictation.start();
        else this.needModel();
      },
      onStop: () => void dictation.stop(),
      onCancel: () => void dictation.cancel(),
      onHandsFree: () => {
        this.handsFree = true;
        this.dictationTitle = ' ● hands-free';
        this.refreshTitle();
        console.log('[keys] hands-free mode');
      },
    });
    this.gesture = gesture;

    const keys = new KeyListener({
      binaryPath: FN_HELPER_PATH,
      log: (m) => console.log(`[keys] ${m}`),
    });
    this.keys = keys;
    const onEvent = (event: HotkeyEvent | null) => {
      if (!event) return;
      if (process.env.WHISPER_DEBUG_KEYS) console.log(`[keys] ${new Date().toISOString().slice(11, 23)} ${event}`);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('hotkey:event', event);
      if (!this.hotkeyTesting) gesture.handle(event);
    };
    keys.on('mods', (mods) => onEvent(this.matcher.handleMods(mods)));
    keys.on('key', () => onEvent(this.matcher.handleKey()));
    keys.on('status', (status) => {
      console.log(`[keys] helper: ${status}`);
      if (status === 'permission-needed') {
        this.setStatus('allow Input Monitoring for the dictation key (System Settings → Privacy & Security)');
      }
      if (status === 'ready' || status === 'permission-granted') keys.requestPermissions();
    });
    keys.on('permissions', (perms) => {
      this.helperPermissions = perms;
      this.pushState();
    });
    keys.start();
  }

  // ---------- startup / quit ----------

  private async startEngine(): Promise<void> {
    if (!this.engine.modelPath) {
      this.engineStatus = { state: 'no-model', error: null };
      this.setStatus('choose a Whisper model in Settings → Models');
      this.pushState();
      return;
    }
    this.setStatus('loading model…');
    this.engineStatus = { state: 'loading', error: null };
    this.pushState();
    try {
      await this.engine.start();
      this.setStatus('ready');
      this.engineStatus = { state: 'ready', error: null };
    } catch (err) {
      console.error(`[whisper] failed to start: ${errorMessage(err)}`);
      this.setStatus(`error: ${errorMessage(err)}`);
      this.engineStatus = { state: 'error', error: errorMessage(err) };
    }
    this.pushState();
  }

  /** Everything that needs Electron to be ready. */
  async start(): Promise<void> {
    const recorder = new MicRecorder({
      log: (m) => console.log(`[recorder] ${m}`),
      // Dev: WHISPER_KEEP_AUDIO=1 keeps a copy of the last recording for inspection.
      keepCopyPath: process.env.WHISPER_KEEP_AUDIO ? path.join(ROOT, 'samples', 'last-recording.wav') : null,
    });
    this.recorder = recorder;
    const dictation = new Dictation({
      recorder,
      engine: this.engine,
      onState: (state, detail) => this.onDictationState(state, detail),
      onText: (text) => void this.onText(text),
      log: (m) => console.log(`[dictation] ${m}`),
    });
    this.dictation = dictation;

    setAboutPanel();
    registerLibraryProtocol(this.library);
    this.models.migrate(); // an existing model file (e.g. large-v3-turbo) becomes the active model
    // An install from before first-run setup existed (it ran before and has a model) doesn't need it.
    if (this.settings.get('onboarded') === undefined && this.settings.get('launchedBefore') && this.models.activeId()) {
      this.settings.set('onboarded', true);
      console.log('[setup] existing install — setup not needed');
    }
    this.engine.setModel(this.models.activePath() ?? '');
    registerIpc(this);
    this.createTray();
    this.createWindow();

    // Installed app: the first launch turns on "Open at Login" and shows the window once.
    // After that it starts quietly in the menu bar (e.g. after a restart).
    const firstLaunch = !this.settings.get('launchedBefore');
    if (app.isPackaged && firstLaunch) {
      this.setOpenAtLogin(true);
      this.settings.set('launchedBefore', true);
    }
    // Show the window: dev, the very first launch, or while setup isn't finished.
    if (!app.isPackaged || firstLaunch || !this.settings.get('onboarded')) {
      this.showWindow();
    } else {
      app.dock?.hide(); // menu bar only until the user opens the window
    }
    console.log(`[main] ready (packaged: ${app.isPackaged}, first launch: ${firstLaunch})`);

    const engineReady = this.startEngine(); // runs in the background; tray is usable immediately
    await recorder.init();
    console.log('[recorder] hidden recorder window loaded');
    this.startKeys(dictation);
    void this.checkFnKeyConflict();

    // Finish any meeting file left half-written by a crash or power loss.
    for (const file of await this.meeting.recover()) {
      console.log(`[meeting] recovered ${file}`);
      notify('Recovered a meeting recording', path.basename(file), file);
    }
    this.library.migrate(); // recordings from before "one folder per meeting" → their own folders

    await this.runDevChecks(engineReady, dictation);
  }

  /** Dev test modes, switched on with environment variables (see the test-app skill). */
  private async runDevChecks(engineReady: Promise<void>, dictation: Dictation): Promise<void> {
    // WHISPER_MEETING_TEST=8 → records a meeting for 8 s, then saves it.
    const meetingSeconds = Number(process.env.WHISPER_MEETING_TEST);
    if (meetingSeconds > 0) {
      await this.startMeeting();
      setTimeout(() => void this.stopMeeting(), meetingSeconds * 1000);
    }

    // WHISPER_RECORD_TEST=6 npm start → records 6 s, then transcribes (dry paste).
    // WHISPER_RECORD_TEST_REPEAT=4 repeats it (to measure mic start delay cold vs warm).
    const seconds = Number(process.env.WHISPER_RECORD_TEST);
    if (seconds > 0) {
      await engineReady;
      const repeat = Number(process.env.WHISPER_RECORD_TEST_REPEAT) || 1;
      for (let i = 0; i < repeat; i++) {
        dictation.start();
        await sleep(seconds * 1000);
        await dictation.stop();
        await sleep(1000);
      }
    }
  }

  /** Called on 'before-quit'. Returns false to delay quitting (a meeting is being saved). */
  beforeQuit(): boolean {
    // Quitting during a meeting recording: save the file first, then quit for real.
    if (this.meeting.isRecording) {
      void this.stopMeeting().finally(() => app.quit());
      return false;
    }
    this.isQuitting = true;
    this.keys?.stop();
    this.engine.stop(); // never leave whisper-server running after we quit
    return true;
  }
}

/** "75" → "1:15", "3725" → "1:02:05" */
function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** macOS notification; clicking it shows `file` in Finder (if given). */
function notify(title: string, body: string, file?: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (file) n.on('click', () => shell.showItemInFolder(file));
  n.show();
}
