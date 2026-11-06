// Downloads one Whisper model file at a time:
//
//   1. check free disk space
//   2. download into "<file>.part" — if a .part is already there (cancelled / connection cut),
//      continue from where it stopped (HTTP Range request) instead of starting over
//   3. check the SHA-256 checksum against the catalogue (damaged file → deleted, try again)
//   4. rename "<file>.part" → "<file>" (so a half-written file is never used as a model)
//
// This is the ONLY network access in the app, and it only downloads model files — audio and
// text never leave the Mac. Plain Node (global fetch), no Electron — unit-tested in
// test/model-downloader.test.ts against a local test server.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import type { ModelInfo } from './catalog';

/** Leave at least this much disk space free after the download. */
const SPARE_BYTES = 200 * 1024 ** 2;
/** Progress is reported at most this often. */
const PROGRESS_EVERY_MS = 250;

export class DownloadCancelled extends Error {}

export interface DownloadProgress {
  id: string;
  phase: 'downloading' | 'verifying';
  /** bytes on disk so far */
  received: number;
  total: number;
  /** current speed (0 while verifying) */
  bytesPerSec: number;
}

export interface ModelDownloaderOptions {
  /** the models folder */
  dir: string;
  /** where files come from (catalogue default; tests use a local server) */
  baseUrl: string;
  log?: (line: string) => void;
}

export class ModelDownloader {
  private readonly dir: string;
  private readonly baseUrl: string;
  private readonly log: (line: string) => void;
  private current: { id: string; abort: AbortController } | null = null;

  constructor({ dir, baseUrl, log = () => {} }: ModelDownloaderOptions) {
    this.dir = dir;
    this.baseUrl = baseUrl;
    this.log = log;
  }

  /** Id of the model being downloaded, or null. */
  get busyWith(): string | null {
    return this.current?.id ?? null;
  }

  /** Download (or resume) a model. Resolves with the final file path once it's verified. */
  async download(model: ModelInfo, onProgress: (p: DownloadProgress) => void = () => {}): Promise<string> {
    if (this.current) throw new Error('Another model is already downloading.');
    const abort = new AbortController();
    this.current = { id: model.id, abort };
    try {
      return await this.run(model, abort.signal, onProgress);
    } catch (err) {
      if (abort.signal.aborted) throw new DownloadCancelled('Download cancelled.');
      throw err;
    } finally {
      this.current = null;
    }
  }

  /** Stop the download in progress. The .part file is kept, so it can be resumed later. */
  cancel(): void {
    this.current?.abort.abort();
  }

  private async run(
    model: ModelInfo,
    signal: AbortSignal,
    onProgress: (p: DownloadProgress) => void
  ): Promise<string> {
    fs.mkdirSync(this.dir, { recursive: true });
    const target = path.join(this.dir, model.file);
    const part = `${target}.part`;

    // How much do we already have? (A .part bigger than the model is junk → start over.)
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (have > model.sizeBytes) {
      fs.rmSync(part);
      have = 0;
    }

    // 1) enough disk space for the rest?
    const { bavail, bsize } = fs.statfsSync(this.dir);
    const needed = model.sizeBytes - have + SPARE_BYTES;
    if (bavail * bsize < needed) {
      throw new Error(`Not enough free disk space — ${model.label} needs ${formatMB(needed)} more.`);
    }

    // 2) download the rest
    if (have < model.sizeBytes) {
      this.log(`${have ? `resuming at ${formatMB(have)}` : 'downloading'} ${model.file}`);
      const res = await fetch(this.baseUrl + model.file, {
        headers: have ? { Range: `bytes=${have}-` } : {},
        signal,
      });
      if (res.status === 200 && have) have = 0; // server ignored the range → whole file again
      else if (res.status !== 200 && res.status !== 206) throw new Error(`Download failed (HTTP ${res.status}).`);
      if (!res.body) throw new Error('Download failed (empty answer).');

      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      const closed = once(out, 'close');
      let received = have;
      let lastReport = 0;
      let lastBytes = received;
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await once(out, 'drain'); // don't fill memory faster than the disk
          received += chunk.length;
          const now = Date.now();
          if (now - lastReport >= PROGRESS_EVERY_MS) {
            const bytesPerSec = lastReport ? ((received - lastBytes) * 1000) / (now - lastReport) : 0;
            onProgress({ id: model.id, phase: 'downloading', received, total: model.sizeBytes, bytesPerSec });
            lastReport = now;
            lastBytes = received;
          }
        }
      } catch (err) {
        if (signal.aborted) throw err;
        // The connection broke: keep what we have, the next try resumes from there.
        throw new Error(`The download was interrupted (${formatMB(received)} saved) — click Download to resume.`, { cause: err });
      } finally {
        out.end();
        await closed;
      }
      if (received !== model.sizeBytes) {
        throw new Error(`The download stopped early (${formatMB(received)} of ${formatMB(model.sizeBytes)}) — click Download to resume.`);
      }
    }

    // 3) checksum
    onProgress({ id: model.id, phase: 'verifying', received: model.sizeBytes, total: model.sizeBytes, bytesPerSec: 0 });
    const sha256 = await hashFile(part, signal);
    if (sha256 !== model.sha256) {
      fs.rmSync(part, { force: true });
      throw new Error('The downloaded file was damaged (checksum mismatch) and was removed. Please try again.');
    }

    // 4) ready
    fs.renameSync(part, target);
    this.log(`downloaded and verified ${model.file}`);
    return target;
  }
}

/** SHA-256 of a file, read in chunks (works for multi-GB files). */
async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 ** 2 })) {
    if (signal?.aborted) throw new DownloadCancelled('Download cancelled.');
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** 574041195 → "547 MB" */
function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
