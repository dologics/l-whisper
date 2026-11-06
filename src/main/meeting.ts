// Meeting recording: your mic + the Mac's system audio → one .m4a file
// (both voices mixed into both ears, each side levelled). Audio only, no transcription.
//
//   bin/meeting-recorder (Swift)  ──raw PCM──►  ffmpeg  ──►  "Meeting <date>.part.m4a"
//
// Crash-safe: ffmpeg writes a *fragmented* .m4a and closes a fragment every 5 s, so the
// file on disk is always playable. On stop it is re-packed (no re-encoding) into a normal
// .m4a. Leftover .part files from a crash are finished on the next start (recover()).
import { spawn, execFile, type ChildProcessWithoutNullStreams, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { errorMessage, onLines } from './util';

const MIN_FREE_BYTES = 1024 ** 3; // refuse to start with < 1 GB free
const BITRATE = '64k'; // AAC mono ≈ 29 MB per hour — plenty for speech

// Both voices in both ears, at similar loudness:
//   split you (left) / others (right) → level each side on its own (dynaudnorm, up to ×12,
//   ~2 s look-ahead) → add together → limiter so nothing clips → mono.
const MIX_FILTER = [
  '[0:a]channelsplit=channel_layout=stereo[you][others]',
  '[you]highpass=f=80,afftdn=nr=12:nf=-50,dynaudnorm=f=250:g=9:m=12:p=0.9:t=0.002[y]',
  '[others]dynaudnorm=f=250:g=9:m=12:p=0.9:t=0.002[o]',
  '[y][o]amix=inputs=2:normalize=0,alimiter=limit=0.95[mix]',
].join(';');

/** Once a second while recording: elapsed time + mic/system loudness (dB, as text). */
export interface MeetingTick {
  seconds: number;
  mic: string;
  sys: string;
}

export interface MeetingRecorderOptions {
  /** bin/meeting-recorder */
  helperPath: string;
  /** bin/ffmpeg (mixes + encodes the audio) */
  ffmpegPath: string;
  /** folder for recordings */
  outDir: string;
  onTick?: (info: MeetingTick) => void;
  /** the helper died (e.g. mic unplugged) — the app should save what we have */
  onUnexpectedStop?: () => void;
  /** the call switched microphones */
  onMicChange?: (name: string) => void;
  log?: (line: string) => void;
}

export class MeetingRecorder {
  private readonly helperPath: string;
  private readonly ffmpegPath: string;
  private readonly outDir: string;
  private readonly onTick: (info: MeetingTick) => void;
  private readonly onUnexpectedStop: () => void;
  private readonly onMicChange: (name: string) => void;
  private readonly log: (line: string) => void;

  private stopping = false;
  private helper: ChildProcessWithoutNullStreams | null = null;
  private ffmpeg: ChildProcess | null = null;
  private helperDone: Promise<unknown> = Promise.resolve();
  private ffmpegDone: Promise<unknown> = Promise.resolve();
  private partPath: string | null = null;
  /** folder of the meeting being recorded (null when not recording) */
  folder: string | null = null;
  private startedAt = 0;
  private levels = { mic: '-inf', sys: '-inf' };
  /** the microphone being recorded (follows the call's mic) */
  micName = '';
  private timer: NodeJS.Timeout | undefined;

  constructor({
    helperPath,
    ffmpegPath,
    outDir,
    onTick = () => {},
    onUnexpectedStop = () => {},
    onMicChange = () => {},
    log = () => {},
  }: MeetingRecorderOptions) {
    this.helperPath = helperPath;
    this.ffmpegPath = ffmpegPath;
    this.outDir = outDir;
    this.onTick = onTick;
    this.onUnexpectedStop = onUnexpectedStop;
    this.onMicChange = onMicChange;
    this.log = log;
  }

  get isRecording(): boolean {
    return this.helper !== null;
  }

  get seconds(): number {
    return this.isRecording ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  async start(): Promise<{ path: string; rate: number }> {
    if (this.isRecording) throw new Error('Already recording a meeting.');
    if (!fs.existsSync(this.helperPath)) throw new Error('Meeting recorder helper not built (npm run build:native).');
    fs.mkdirSync(this.outDir, { recursive: true });
    const { bavail, bsize } = fs.statfsSync(this.outDir);
    if (bavail * bsize < MIN_FREE_BYTES) throw new Error('Less than 1 GB of free disk space.');

    // One folder per meeting: <outDir>/Meeting <date>/Meeting <date>.part.m4a
    this.folder = uniquePath(this.outDir, `Meeting ${stamp(new Date())}`, '');
    fs.mkdirSync(this.folder);
    const partPath = path.join(this.folder, `${path.basename(this.folder)}.part.m4a`);
    this.partPath = partPath;

    // 1) Swift helper: mic + system audio → raw stereo PCM on stdout, status on stderr.
    const helper = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.helper = helper;
    const rate = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Meeting recorder did not start.')), 10000);
      onLines(helper.stderr, (raw) => {
        const line = raw.trim();
        const ready = line.match(/^ready rate=(\d+)/);
        const level = line.match(/^level mic=(\S+) sys=(\S+)/);
        const mic = line.match(/^mic name=(.+) rate=(\d+)$/);
        if (ready) {
          clearTimeout(timeout);
          this.log(line);
          resolve(Number(ready[1]));
        } else if (level) {
          this.levels = { mic: level[1], sys: level[2] };
        } else if (mic) {
          this.micName = mic[1];
          this.log(`microphone: ${mic[1]} (${mic[2]} Hz)`);
          this.onMicChange(mic[1]);
        } else if (line.startsWith('error')) {
          clearTimeout(timeout);
          this.log(line);
          reject(new Error(line.replace(/^error: /, '')));
        } else if (line) {
          this.log(line);
        }
      });
      helper.on('exit', () => reject(new Error('Meeting recorder stopped unexpectedly.')));
    }).catch((err: unknown) => {
      this.helper = null;
      helper.kill();
      throw err;
    });

    // 2) ffmpeg: level each side separately, mix both into both ears (mono), encode AAC
    //    into a fragmented .m4a (playable at any moment).
    // prettier-ignore
    const ffmpeg = spawn(this.ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(rate), '-ac', '2', '-i', 'pipe:0',
      '-filter_complex', MIX_FILTER, '-map', '[mix]', '-ac', '1',
      '-c:a', 'aac', '-b:a', BITRATE,
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '5000000',
      partPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.ffmpeg = ffmpeg;
    this.ffmpegDone = new Promise((resolve) => ffmpeg.on('close', resolve));
    onLines(ffmpeg.stderr, (raw) => {
      const line = raw.trim();
      if (line) this.log(`ffmpeg: ${line}`);
    });
    helper.stdout.pipe(ffmpeg.stdin);
    this.helperDone = new Promise((resolve) => helper.on('close', resolve));
    // e.g. the mic was unplugged: let the app save what we have so far.
    helper.on('close', () => {
      if (!this.stopping && this.helper === helper) this.onUnexpectedStop();
    });
    this.stopping = false;

    this.startedAt = Date.now();
    this.timer = setInterval(() => this.onTick({ seconds: this.seconds, ...this.levels }), 1000);
    this.log(`recording → ${partPath}`);
    return { path: partPath, rate };
  }

  /** Stop, finish the file, return { path, seconds, size }. */
  async stop(): Promise<{ path: string; seconds: number; size: number }> {
    if (!this.helper || !this.partPath) throw new Error('Not recording a meeting.');
    this.stopping = true;
    const seconds = this.seconds;
    clearInterval(this.timer);
    this.helper.stdin.end(); // helper flushes, removes its tap, exits → ffmpeg sees end of input
    await this.helperDone;
    await this.ffmpegDone;
    this.helper = this.ffmpeg = null;
    const finalPath = await finalize(this.ffmpegPath, this.partPath);
    this.folder = null;
    const size = fs.statSync(finalPath).size;
    this.log(`saved ${finalPath} (${seconds} s, ${(size / 1024 ** 2).toFixed(1)} MB)`);
    return { path: finalPath, seconds, size };
  }

  /** Finish any .part.m4a left by a crash. Returns the recovered file paths. */
  async recover(): Promise<string[]> {
    if (!fs.existsSync(this.outDir)) return [];
    // .part files at the top level (older layout) or inside meeting folders
    const parts: string[] = [];
    for (const entry of fs.readdirSync(this.outDir, { withFileTypes: true })) {
      const full = path.join(this.outDir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.part.m4a')) parts.push(full);
      if (entry.isDirectory() && full !== this.folder) {
        for (const f of fs.readdirSync(full)) if (f.endsWith('.part.m4a')) parts.push(path.join(full, f));
      }
    }
    const recovered: string[] = [];
    for (const f of parts) {
      try {
        recovered.push(await finalize(this.ffmpegPath, f, ' (recovered)'));
      } catch (err) {
        this.log(`could not recover ${path.basename(f)}: ${errorMessage(err)}`);
      }
    }
    return recovered;
  }
}

/** Re-pack a fragmented .part.m4a into a normal .m4a (fast, no re-encoding). */
function finalize(ffmpegPath: string, partPath: string, suffix = ''): Promise<string> {
  const dir = path.dirname(partPath);
  const base = path.basename(partPath, '.part.m4a') + suffix;
  const finalPath = uniquePath(dir, base, '.m4a');
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      ['-nostdin', '-loglevel', 'error', '-i', partPath, '-c', 'copy', '-movflags', '+faststart', finalPath],
      (err) => {
        if (err) return reject(new Error(`could not finish the file: ${err.message}`));
        fs.rmSync(partPath, { force: true });
        resolve(finalPath);
      }
    );
  });
}

/** "2026-11-04 14-30" */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

/** dir/name.ext, or dir/name 2.ext … if it already exists. */
function uniquePath(dir: string, name: string, ext: string): string {
  let candidate = path.join(dir, name + ext);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${name} ${i}${ext}`);
  return candidate;
}
