// File transcription: audio/video file → timed transcript segments.
//
//   1. ffprobe   — length + check there is an audio track          (fileInfo)
//   2. ffmpeg    — extract audio as 16 kHz mono WAV                  (progress 0–10 %)
//   3. whisper-cli — transcribe with progress + JSON timestamps       (progress 10–100 %)
//
// Why whisper-cli and not the dictation server: the server only answers when the whole
// file is done, with no progress. whisper-cli reports progress and writes timed segments.
// Why no VAD here: in tests it dropped whole phrases from long files (and progress hit 133 %).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileInfo, Progress, Segment, TranscribeOptions, TranscribeResult } from '../shared/types';
import { onLines, run } from './util';

// prettier-ignore
export const SUPPORTED = [
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif', // audio
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', // video
];

// A punctuated example makes Whisper write proper sentences when timestamps are on
// (without it, this model returned lowercase text with no punctuation).
const STYLE_PROMPT = 'Hello. Welcome, everyone.';

export class TranscriptionCancelled extends Error {}

/** ffprobe's JSON answer (only the fields we read). */
interface ProbeResult {
  streams?: { codec_type?: string }[];
  format?: { duration?: string };
}

/** whisper-cli's -oj output (only the fields we read). */
interface WhisperCliJson {
  transcription?: { offsets: { from: number; to: number }; text: string }[];
}

/** Paths of the programs the transcriber runs (shipped in the app's bin/). */
export interface TranscriberTools {
  ffmpeg: string;
  ffprobe: string;
  whisperCli: string;
}

export interface FileTranscriberOptions {
  /** the active ggml Whisper model, or null if none is chosen yet */
  getModelPath: () => string | null;
  tools: TranscriberTools;
  /** current language setting ('auto', 'en', …) */
  getLanguage: () => string;
  log?: (line: string) => void;
}

export class FileTranscriber {
  private readonly getModelPath: () => string | null;
  private readonly tools: TranscriberTools;
  private readonly getLanguage: () => string;
  private readonly log: (line: string) => void;
  private child: ChildProcess | null = null; // ffmpeg or whisper-cli while running
  private cancelled = false;
  busy = false;

  constructor({ getModelPath, tools, getLanguage, log = () => {} }: FileTranscriberOptions) {
    this.getModelPath = getModelPath;
    this.tools = tools;
    this.getLanguage = getLanguage;
    this.log = log;
  }

  /** Facts about a file, or { ok: false, error } if we can't use it. */
  async fileInfo(filePath: string): Promise<FileInfo> {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
    if (!SUPPORTED.includes(ext)) {
      return { ok: false, error: `“.${ext || '?'}” files aren't supported. Try MP3, WAV, M4A, MP4 or MOV.` };
    }
    let probe: string;
    try {
      // prettier-ignore
      probe = await run(this.tools.ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', filePath,
      ]);
    } catch {
      return { ok: false, error: "This file couldn't be read — it may be damaged." };
    }
    const data = JSON.parse(probe) as ProbeResult;
    if (!(data.streams || []).some((s) => s.codec_type === 'audio')) {
      return { ok: false, error: 'This file has no sound to transcribe.' };
    }
    return {
      ok: true,
      path: filePath,
      name: path.basename(filePath),
      ext: ext.toUpperCase(),
      size: fs.statSync(filePath).size,
      durationSec: Number(data.format?.duration) || 0,
    };
  }

  /** Transcribe a file. Calls onProgress({ percent, etaSec }) while working. */
  async transcribe(
    filePath: string,
    onProgress: (progress: Progress) => void,
    opts: TranscribeOptions = {}
  ): Promise<TranscribeResult> {
    if (this.busy) throw new Error('Already transcribing a file.');
    const modelPath = this.getModelPath();
    if (!modelPath) throw new Error('Choose a Whisper model first (Settings → Models).');
    const info = await this.fileInfo(filePath);
    if (!info.ok) throw new Error(info.error);

    this.busy = true;
    this.cancelled = false;
    const language = opts.language || this.getLanguage();
    const translate = Boolean(opts.translate);
    const t0 = Date.now();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-desktop-file-'));
    const wav = path.join(workDir, 'audio.wav');
    const outBase = path.join(workDir, 'transcript');

    // Overall percent → also estimate time left from the speed so far.
    let last = -1;
    const report = (raw: number) => {
      const percent = Math.max(0, Math.min(100, Math.round(raw)));
      if (percent === last) return;
      last = percent;
      const elapsed = (Date.now() - t0) / 1000;
      const etaSec = percent >= 12 && percent < 100 ? Math.round((elapsed / percent) * (100 - percent)) : 0;
      onProgress({ percent, etaSec });
    };

    try {
      // 1) extract audio (0–10 %)
      this.log(`extracting audio from ${info.name} (${info.durationSec.toFixed(0)} s)`);
      // prettier-ignore
      await this.spawnTool(this.tools.ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', filePath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav,
        '-progress', 'pipe:1', '-nostats',
      ], {
        onStdout: (line) => {
          const m = line.match(/^out_time_us=(\d+)/);
          if (m && info.durationSec) report((Number(m[1]) / 1e6 / info.durationSec) * 10);
        },
      });
      report(10);

      // 2) transcribe (10–100 %)
      this.log(`transcribing (language: ${language})`);
      // prettier-ignore
      await this.spawnTool(this.tools.whisperCli, [
        '-m', modelPath, '-f', wav, '-l', language,
        ...(translate ? ['-tr'] : []),
        // English punctuation example — skipped for Urdu so it can't nudge the output to English
        ...(language === 'ur' && !translate ? [] : ['--prompt', STYLE_PROMPT]),
        '-pp', // print progress
        '-oj', '-of', outBase, // write timed segments to transcript.json
        '-np', // no other console output
      ], {
        onStderr: (line) => {
          const m = line.match(/progress =\s*(\d+)%/);
          if (m) report(10 + Number(m[1]) * 0.9);
        },
      });

      const json = JSON.parse(fs.readFileSync(`${outBase}.json`, 'utf8')) as WhisperCliJson;
      const segments: Segment[] = (json.transcription || [])
        .map((s) => ({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() }))
        .filter((s) => s.text);
      report(100);
      const elapsedMs = Date.now() - t0;
      this.log(`done: ${segments.length} segments in ${(elapsedMs / 1000).toFixed(1)} s`);
      return { segments, durationSec: info.durationSec, elapsedMs, language, translate };
    } catch (err) {
      if (this.cancelled) throw new TranscriptionCancelled('Cancelled');
      throw err;
    } finally {
      this.child = null;
      this.busy = false;
      fs.rm(workDir, { recursive: true, force: true }, () => {}); // remove temp audio + json
    }
  }

  cancel(): void {
    if (!this.busy) return;
    this.cancelled = true;
    this.child?.kill('SIGTERM');
  }

  /** Run a program, feeding its output lines to callbacks; rejects on failure. */
  private spawnTool(
    cmd: string,
    args: string[],
    { onStdout, onStderr }: { onStdout?: (line: string) => void; onStderr?: (line: string) => void } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.cancelled) return reject(new TranscriptionCancelled('Cancelled'));
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const errTail: string[] = []; // the last few stderr lines, for error messages
      const LINE_END = /\r?\n|\r/; // progress updates end with "\r"
      onLines(child.stdout, (l) => onStdout?.(l), LINE_END);
      onLines(
        child.stderr,
        (l) => {
          onStderr?.(l);
          if (l.trim()) {
            errTail.push(l.trim());
            if (errTail.length > 5) errTail.shift();
          }
        },
        LINE_END
      );
      child.on('error', (err) => reject(new Error(`${path.basename(cmd)} could not start: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${path.basename(cmd)} failed (code ${code}): ${errTail.slice(-2).join(' ')}`));
      });
    });
  }
}
