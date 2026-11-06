// Whisper engine: runs whisper.cpp's `whisper-server` as a background process
// (so the model stays loaded in memory) and sends audio files to it over HTTP.
//
// Plain Node.js — no Electron imports — so it can be tested from the terminal.
//
//   const engine = new WhisperEngine({ binaryPath, modelPath });
//   await engine.start();
//   const text = await engine.transcribe('/path/to/audio.wav'); // 16 kHz mono WAV
//   engine.stop();
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { errorMessage, sleep } from './util';

export class WhisperError extends Error {}

export interface WhisperEngineOptions {
  /** Path to a ggml .bin model file ('' = no model chosen yet; see setModel). */
  modelPath: string;
  /** Path to the whisper-server program (shipped in the app's bin/). */
  binaryPath: string;
  /** Language code, or 'auto' to detect (default 'auto'). */
  language?: string;
  /**
   * Silero VAD model; when set, silence is skipped
   * (prevents Whisper inventing text like "Thank you." for silent audio).
   */
  vadModelPath?: string;
  /** How long to wait for the server to come up. */
  startTimeoutMs?: number;
  /** Logger for status messages. */
  log?: (line: string) => void;
}

export class WhisperEngine {
  /** the model whisper-server loads — change it with setModel() */
  modelPath: string;
  readonly binaryPath: string;
  /** used by the next transcription — changing it needs no restart */
  language: string;
  readonly vadModelPath: string | null;
  readonly startTimeoutMs: number;
  private readonly log: (line: string) => void;

  private process: ChildProcess | null = null;
  private port: number | null = null;
  private startPromise: Promise<void> | null = null;
  private recentOutput: string[] = []; // last lines from the server, for error messages

  constructor(opts: WhisperEngineOptions) {
    this.modelPath = opts.modelPath;
    this.binaryPath = opts.binaryPath;
    this.language = opts.language || 'auto';
    this.vadModelPath = opts.vadModelPath || null;
    // First-ever launch compiles GPU shaders (~15 s), so allow plenty of time.
    this.startTimeoutMs = opts.startTimeoutMs ?? 90_000;
    this.log = opts.log || (() => {});
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /** Start whisper-server (safe to call more than once). */
  start(): Promise<void> {
    if (this.isRunning && this.startPromise) return this.startPromise;
    this.startPromise = this.launch().catch((err: unknown) => {
      this.startPromise = null;
      this.stop();
      throw err;
    });
    return this.startPromise;
  }

  private async launch(): Promise<void> {
    if (!fs.existsSync(this.binaryPath)) {
      throw new WhisperError(`whisper-server is missing: ${this.binaryPath} (developers: npm run build:tools)`);
    }
    if (!this.modelPath) throw new WhisperError('No Whisper model chosen yet (Settings → Models).');
    if (!fs.existsSync(this.modelPath)) {
      throw new WhisperError(`Whisper model file not found: ${this.modelPath}`);
    }

    this.port = await getFreePort();
    this.recentOutput = [];
    // prettier-ignore
    const args = [
      '-m', this.modelPath,
      '--host', '127.0.0.1', // only reachable from this Mac
      '--port', String(this.port),
      '-l', this.language,
    ];
    if (this.vadModelPath) {
      if (!fs.existsSync(this.vadModelPath)) {
        throw new WhisperError(`VAD model file not found: ${this.vadModelPath}`);
      }
      args.push('--vad', '-vm', this.vadModelPath);
    }

    this.log(`starting whisper-server on port ${this.port}…`);
    const startedAt = Date.now();
    const child = spawn(this.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;

    const remember = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) this.recentOutput.push(line.trim());
      }
      this.recentOutput = this.recentOutput.slice(-20);
    };
    child.stdout.on('data', remember);
    child.stderr.on('data', remember);
    child.on('exit', (code, signal) => {
      if (this.process === child) {
        this.process = null;
        this.startPromise = null;
        this.log(`whisper-server stopped (code ${code}, signal ${signal})`);
      }
    });

    // Poll until the server answers HTTP, or it dies, or we time out.
    while (true) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new WhisperError(`whisper-server exited during startup.\n${this.recentOutput.slice(-5).join('\n')}`);
      }
      if (Date.now() - startedAt > this.startTimeoutMs) {
        throw new WhisperError(`whisper-server did not start within ${this.startTimeoutMs / 1000}s`);
      }
      try {
        await fetch(`http://127.0.0.1:${this.port}/`);
        break; // any HTTP answer means it's up
      } catch {
        await sleep(250);
      }
    }
    this.log(`whisper-server ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }

  /** Transcribe an audio file (16 kHz mono WAV; ffmpeg/recorder produce this). Returns the text. */
  async transcribe(audioPath: string): Promise<string> {
    if (!fs.existsSync(audioPath)) {
      throw new WhisperError(`Audio file not found: ${audioPath}`);
    }
    await this.start(); // starts or restarts the server if needed

    const audio = await fs.promises.readFile(audioPath);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), path.basename(audioPath));
    form.append('response_format', 'json');
    form.append('language', this.language); // per request, so changing it needs no restart
    form.append('temperature', '0');

    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form });
    } catch (err) {
      throw new WhisperError(`Could not reach whisper-server: ${errorMessage(err)}`);
    }
    const body = await res.text();
    if (!res.ok) {
      throw new WhisperError(`whisper-server error ${res.status}: ${body.slice(0, 300)}`);
    }

    let data: { text?: string; error?: string };
    try {
      data = JSON.parse(body);
    } catch {
      throw new WhisperError(`Unexpected reply from whisper-server: ${body.slice(0, 300)}`);
    }
    if (data.error) throw new WhisperError(`whisper-server error: ${data.error}`);
    return cleanText(data.text || '');
  }

  /** Stop the server process. */
  /**
   * Use another model file. The server keeps a model loaded, so it is stopped here;
   * the next start() / transcribe() starts it again with the new model.
   */
  setModel(modelPath: string): void {
    if (modelPath === this.modelPath) return;
    this.modelPath = modelPath;
    this.stop();
    this.log(`model → ${modelPath || '(none)'}`);
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.startPromise = null;
  }
}

/** whisper-server puts each segment on its own line; join into normal prose. */
function cleanText(text: string): string {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

/** Ask the OS for an unused TCP port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}
