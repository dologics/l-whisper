// Microphone recorder (main-process side).
// Recording itself happens in a hidden window (src/recorder/) because only web pages
// can use the mic in Electron. This module controls that window and saves the WAV.
import { BrowserWindow, ipcMain, systemPreferences, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { SoundName } from '../shared/types';
import type { DictationRecorder, Recording } from './dictation';

type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';

/** The start()/stop() call waiting for the hidden window to answer. */
interface Pending {
  resolve: (value: Recording | null) => void;
  reject: (err: Error) => void;
}

export class MicRecorder implements DictationRecorder {
  private readonly log: (line: string) => void;
  /** dev: copy each recording here before deleting it */
  private readonly keepCopyPath: string | null;
  private window: BrowserWindow | null = null;
  private state: RecorderState = 'idle';
  private pending: Pending | null = null;
  private startedAt = 0;
  private readonly tempDir: string;

  constructor({
    log = () => {},
    keepCopyPath = null,
  }: { log?: (line: string) => void; keepCopyPath?: string | null } = {}) {
    this.log = log;
    this.keepCopyPath = keepCopyPath;
    this.tempDir = path.join(app.getPath('temp'), 'whisper-desktop');
    fs.mkdirSync(this.tempDir, { recursive: true });

    ipcMain.on('recorder:started', () => {
      if (this.state === 'starting') this.log(`mic live ${Date.now() - this.startedAt} ms after start()`);
      this.settle('starting', 'recording', null);
    });
    ipcMain.on('recorder:failed', (_e, message: string) => this.fail(message));
    ipcMain.on('recorder:audio', (_e, wav: ArrayBuffer) => this.onAudio(wav));
  }

  get isRecording(): boolean {
    return this.state === 'recording';
  }

  /** Create the hidden recorder window (call once after app is ready). */
  async init(): Promise<void> {
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'recorder-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // keep audio running while hidden
        autoplayPolicy: 'no-user-gesture-required', // allow feedback sounds without a click
      },
    });
    // Only allow the microphone; deny every other permission request.
    this.window.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
    await this.window.loadFile(path.join(__dirname, '..', 'recorder', 'recorder.html'));
  }

  /** Make sure macOS lets us use the mic; shows the system prompt the first time. */
  async ensureMicPermission(): Promise<void> {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    this.log(`microphone permission: ${status}`);
    if (status === 'granted') return;
    if (status === 'denied' || status === 'restricted') {
      throw new Error('Microphone access is blocked. Enable it in System Settings → Privacy & Security → Microphone.');
    }
    const granted = await systemPreferences.askForMediaAccess('microphone');
    this.log(`microphone permission after asking: ${granted ? 'granted' : 'denied'}`);
    if (!granted) throw new Error('Microphone access was not allowed.');
  }

  /** Start recording. Resolves once the mic is live. */
  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Recorder is busy (${this.state})`);
    await this.ensureMicPermission();
    this.state = 'starting';
    this.startedAt = Date.now();
    await new Promise<Recording | null>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.window?.webContents.send('recorder:start');
    });
  }

  /** Stop recording. Resolves with { path, seconds } of the saved WAV. */
  stop(): Promise<Recording> {
    if (this.state !== 'recording') return Promise.reject(new Error('Not recording'));
    this.state = 'stopping';
    return new Promise<Recording>((resolve, reject) => {
      this.pending = { resolve: (value) => resolve(value as Recording), reject };
      this.window?.webContents.send('recorder:stop');
    });
  }

  private onAudio(wav: ArrayBuffer): void {
    if (this.state !== 'stopping') return;
    const buf = Buffer.from(wav);
    const seconds = (buf.length - 44) / 2 / 16000; // 16-bit mono @ 16 kHz
    const file = path.join(this.tempDir, `recording-${Date.now()}.wav`);
    fs.writeFileSync(file, buf);
    this.log(
      `saved ${seconds.toFixed(1)} s recording (${levels(buf)}; ${Date.now() - this.startedAt} ms since start())`
    );
    this.settle('stopping', 'idle', { path: file, seconds });
  }

  private settle(expectedState: RecorderState, nextState: RecorderState, value: Recording | null): void {
    if (this.state !== expectedState || !this.pending) return;
    const { resolve } = this.pending;
    this.pending = null;
    this.state = nextState;
    resolve(value);
  }

  private fail(message: string): void {
    const pending = this.pending;
    this.pending = null;
    this.state = 'idle';
    this.log(`recorder error: ${message}`);
    pending?.reject(new Error(message));
  }

  /** Play a feedback sound (generated in the hidden window). */
  playSound(name: SoundName): void {
    this.window?.webContents.send('recorder:sound', name);
  }

  /** Delete a temp recording once it has been transcribed. */
  discard(file: string): void {
    if (this.keepCopyPath) fs.copyFileSync(file, this.keepCopyPath);
    fs.rm(file, { force: true }, () => {});
  }
}

/** Peak and average loudness of a 16-bit WAV, in dBFS (0 = max, -90 = silence). */
function levels(wav: Buffer): string {
  let peak = 0;
  let sumSq = 0;
  const n = (wav.length - 44) / 2;
  for (let i = 0; i < n; i++) {
    const s = wav.readInt16LE(44 + i * 2) / 32768;
    peak = Math.max(peak, Math.abs(s));
    sumSq += s * s;
  }
  const db = (v: number) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
  return `peak ${db(peak)} dB, avg ${db(Math.sqrt(sumSq / Math.max(n, 1)))} dB`;
}
