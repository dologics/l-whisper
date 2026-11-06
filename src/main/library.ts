// The Library: recorded meetings and transcribed files, one folder per item.
//
//   ~/Documents/L - Whisper Library/
//     Meeting 2026-11-05 10-30/                  ← a meeting (recorded by the app)
//       Meeting 2026-11-05 10-30.m4a             audio (".part.m4a" while recording)
//       Meeting 2026-11-05 10-30.txt/.srt/.vtt   transcripts (written by transcribe())
//       Meeting 2026-11-05 10-30.json            segments (the app reloads these)
//       Meeting 2026-11-05 10-30.summary.md      AI summary, only if the user clicked Summarize (task 26)
//       item.json                                what this item is (see ItemJson)
//     Interview/                                 ← a transcribed file
//       Interview.txt/.srt/.vtt/.json            transcripts only — NO audio:
//       item.json                                "source" says where the original file is
//
// Dropped files are never copied or moved: their item points at the original. If the
// original is moved or deleted, the transcript is still there; only play/re-transcribe stop.
//
// An item's id is its folder name. Every id is checked so it can never point outside
// the library folder.
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiProvider,
  LibraryEntry,
  LibraryItemDetail,
  LibraryKind,
  LibraryListItem,
  Progress,
  Segment,
  TranscribeOptions,
  TranscribeResult,
  TranscriptInfo,
  SummaryInfo,
} from '../shared/types';
import * as formats from './transcript-formats';
import { run } from './util';

const TRANSCRIPT_EXTS: formats.FormatKind[] = ['txt', 'srt', 'vtt', 'json'];
const ITEM_FILE = 'item.json';

/** item.json — one per folder, so a broken one can't break the whole list. */
interface ItemJson {
  version: 1;
  kind: LibraryKind;
  /** ISO date: when it was recorded / transcribed */
  createdAt: string;
  /** file items: the original audio/video file */
  source?: string;
  /** file items: length of the original (meetings ask ffprobe) */
  durationSec?: number;
  /** the AI summary in <name>.summary.md: who made it and when (task 26) */
  summary?: { provider: AiProvider; createdAt: string } | null;
}

/** The part of FileTranscriber the library needs (tests pass a fake). */
export interface LibraryTranscriber {
  transcribe(
    file: string,
    onProgress: (progress: Progress) => void,
    opts: TranscribeOptions
  ): Promise<Pick<TranscribeResult, 'segments' | 'durationSec' | 'language'> & Partial<TranscribeResult>>;
}

/** What createFromFile needs from a finished file transcription. */
export type FileTranscript = Pick<TranscribeResult, 'segments' | 'durationSec' | 'language'> &
  Partial<Pick<TranscribeResult, 'translate'>>;

/** The .json transcript file written next to the audio. */
interface SavedTranscript {
  language: string;
  translate?: boolean;
  /** ISO date of the transcription (older transcripts may not have it) */
  transcribedAt?: string;
  segments: Segment[];
}

export interface LibraryOptions {
  /** the library folder */
  dir: string;
  /** bin/ffprobe (reads each recording's length; tests may leave it out) */
  ffprobePath?: string;
  transcriber: LibraryTranscriber;
  /** folder being recorded right now (or null) */
  recordingFolder?: () => string | null;
  log?: (line: string) => void;
}

/**
 * Decide the library folder, moving the old "L - Whisper Recordings" folder there once (task 25).
 * - only the old one exists → rename it (same disk, instant). If that fails, keep using the old one.
 * - both exist (unusual) → use the new one, leave the old one alone (never merge or delete).
 * Returns the folder to use.
 */
export function prepareLibraryDir(newDir: string, oldDir: string, log: (line: string) => void = () => {}): string {
  const hasOld = fs.existsSync(oldDir);
  if (!hasOld) return newDir;
  if (fs.existsSync(newDir)) {
    // An empty old folder (e.g. made again by an older version) can simply go; anything else stays.
    const left = fs.readdirSync(oldDir).filter((f) => f !== '.DS_Store');
    if (left.length === 0) {
      fs.rmSync(oldDir, { recursive: true, force: true });
      log(`removed the empty old folder “${oldDir}”`);
    } else {
      log(`both “${oldDir}” and “${newDir}” exist — using the new one, the old one is left as it is`);
    }
    return newDir;
  }
  try {
    fs.renameSync(oldDir, newDir);
    log(`moved “${oldDir}” → “${newDir}”`);
    return newDir;
  } catch (err) {
    log(`could not move “${oldDir}” (${(err as Error).message}) — using it as it is; will try again next launch`);
    return oldDir;
  }
}

/** dir/name, or dir/name 2 … if it already exists. */
function uniqueFolder(dir: string, name: string): string {
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${name} ${i}`);
  return candidate;
}

/** A name that is safe as a folder/file name ("a/b" → "a-b"). */
function cleanTitle(title: string): string {
  return String(title)
    .trim()
    .replace(/[/:\\]/g, '-')
    .replace(/^\.+/, '');
}

export class Library {
  readonly dir: string;
  private readonly ffprobePath: string;
  private readonly transcriber: LibraryTranscriber;
  private readonly recordingFolder: () => string | null;
  private readonly log: (line: string) => void;
  private readonly durations = new Map<string, number>(); // audio path + mtime → seconds (ffprobe once per file)

  constructor({
    dir,
    ffprobePath = 'ffprobe',
    transcriber,
    recordingFolder = () => null,
    log = () => {},
  }: LibraryOptions) {
    this.dir = dir;
    this.ffprobePath = ffprobePath;
    this.transcriber = transcriber;
    this.recordingFolder = recordingFolder;
    this.log = log;
  }

  /** Folder path for an id — refuses anything that isn't a plain folder name in `dir`. */
  folderOf(id: string): string {
    const name = String(id);
    if (!name || name !== path.basename(name) || name.startsWith('.')) throw new Error('Invalid item.');
    const folder = path.join(this.dir, name);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Item not found.');
    return folder;
  }

  /** The finished audio file of a meeting folder (not the .part file). */
  audioOf(folder: string): string | null {
    const f = fs.readdirSync(folder).find((n) => n.endsWith('.m4a') && !n.endsWith('.part.m4a'));
    return f ? path.join(folder, f) : null;
  }

  /** item.json of a folder, or null if it's missing or unreadable. */
  private readItem(folder: string): ItemJson | null {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(folder, ITEM_FILE), 'utf8')) as ItemJson;
      return data && (data.kind === 'meeting' || data.kind === 'file') ? data : null;
    } catch {
      return null;
    }
  }

  private writeItem(folder: string, item: ItemJson): void {
    fs.writeFileSync(path.join(folder, ITEM_FILE), JSON.stringify(item, null, 2) + '\n', 'utf8');
  }

  /** Move recordings saved before task 16 (loose .m4a files) into their own folders. */
  migrate(): void {
    if (!fs.existsSync(this.dir)) return;
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.m4a') || f.endsWith('.part.m4a')) continue;
      const base = path.basename(f, '.m4a');
      const folder = path.join(this.dir, base);
      if (fs.existsSync(folder)) continue; // already migrated / name taken
      fs.mkdirSync(folder);
      fs.renameSync(path.join(this.dir, f), path.join(folder, f));
      this.log(`moved ${f} into its own folder`);
    }
  }

  /** Everything in the library, newest first. */
  async list(): Promise<LibraryListItem[]> {
    if (!fs.existsSync(this.dir)) return [];
    const recording = this.recordingFolder();
    const items: LibraryListItem[] = [];
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const folder = path.join(this.dir, entry.name);
      if (folder === recording) {
        const created = fs.statSync(folder).birthtimeMs;
        items.push({ id: entry.name, title: entry.name, kind: 'meeting', recording: true, created });
        continue;
      }
      const info = await this.info(entry.name, folder);
      if (info) items.push(info);
    }
    return items.sort((a, b) => b.created - a.created);
  }

  /**
   * What an item folder holds, or null if it isn't one (no audio and no item.json).
   * A meeting without item.json (recorded before task 25, or just now) gets one here.
   */
  private async info(id: string, folder: string): Promise<LibraryEntry | null> {
    const item = this.readItem(folder);
    const audio = this.audioOf(folder);

    if (audio) {
      // ----- a meeting -----
      if (!item && !fs.existsSync(path.join(folder, ITEM_FILE))) {
        const createdAt = new Date(fs.statSync(audio).birthtimeMs).toISOString();
        try {
          this.writeItem(folder, { version: 1, kind: 'meeting', createdAt });
        } catch {
          // read-only folder? the item still shows, it just has no item.json
        }
      }
      const stat = fs.statSync(audio);
      return {
        id,
        title: id,
        kind: 'meeting',
        created: item ? Date.parse(item.createdAt) || stat.birthtimeMs : stat.birthtimeMs,
        size: stat.size,
        durationSec: await this.duration(audio, stat.mtimeMs),
        ext: 'M4A',
        transcript: this.transcriptInfo(this.transcriptBase(folder, id, audio)),
        hasSummary: fs.existsSync(this.summaryFile(this.transcriptBase(folder, id, audio))),
      };
    }

    if (item?.kind === 'file') {
      // ----- a transcribed file (its audio stays where it was) -----
      const source = item.source ?? '';
      const exists = Boolean(source) && fs.existsSync(source);
      return {
        id,
        title: id,
        kind: 'file',
        created: Date.parse(item.createdAt) || fs.statSync(folder).birthtimeMs,
        size: exists ? fs.statSync(source).size : 0,
        durationSec: item.durationSec ?? 0,
        ext: path.extname(source).slice(1).toUpperCase() || '?',
        transcript: this.transcriptInfo(this.transcriptBase(folder, id, null)),
        source,
        sourceMissing: !exists,
        hasSummary: fs.existsSync(this.summaryFile(this.transcriptBase(folder, id, null))),
      };
    }
    return null; // some other folder
  }

  /** Path without extension of the transcript files: beside a meeting's audio, or named like the folder. */
  private transcriptBase(folder: string, id: string, audio: string | null): string {
    return audio ? audio.slice(0, -'.m4a'.length) : path.join(folder, id);
  }

  private readTranscript(base: string): SavedTranscript | null {
    try {
      return JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')) as SavedTranscript;
    } catch {
      return null; // not transcribed (or unreadable → treat as not transcribed)
    }
  }

  private transcriptInfo(base: string): TranscriptInfo | null {
    const data = this.readTranscript(base);
    if (!data || !Array.isArray(data.segments)) return null;
    return { language: data.language, translate: Boolean(data.translate), segments: data.segments.length };
  }

  async duration(audio: string, mtimeMs: number): Promise<number> {
    const key = `${audio}|${mtimeMs}`;
    let seconds = this.durations.get(key);
    if (seconds === undefined) {
      // prettier-ignore
      const out = await run(this.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio])
        .catch(() => '0');
      seconds = Number(out.trim()) || 0;
      this.durations.set(key, seconds);
    }
    return seconds;
  }

  /** One item with its transcript segments (if transcribed). */
  async get(id: string): Promise<LibraryItemDetail> {
    const folder = this.folderOf(id);
    if (folder === this.recordingFolder()) throw new Error('This meeting is still being recorded.');
    const info = await this.info(id, folder);
    if (!info) throw new Error('Item not found.');
    const base = this.transcriptBase(folder, id, this.audioOf(folder));
    const transcript = info.transcript ? this.readTranscript(base) : null;
    const segments = transcript?.segments || [];
    return { ...info, folder, segments, summary: this.readSummary(folder, base, transcript) };
  }

  // ---------- AI summary (task 26) ----------

  private summaryFile(base: string): string {
    return `${base}.summary.md`;
  }

  /** The saved summary, or null. `outdated` = transcribed again after the summary was made. */
  private readSummary(folder: string, base: string, transcript: SavedTranscript | null): SummaryInfo | null {
    const file = this.summaryFile(base);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    const meta = this.readItem(folder)?.summary;
    const createdAt = (meta && Date.parse(meta.createdAt)) || fs.statSync(file).mtimeMs;
    const transcribedAt = transcript?.transcribedAt ? Date.parse(transcript.transcribedAt) : 0;
    return { text, provider: meta?.provider ?? null, createdAt, outdated: transcribedAt > createdAt };
  }

  /** The transcript as plain text for the AI: one line per segment, no timestamps. */
  transcriptText(id: string): string {
    const folder = this.folderOf(id);
    const data = this.readTranscript(this.transcriptBase(folder, id, this.audioOf(folder)));
    return (data?.segments ?? [])
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join('\n');
  }

  /** Save an AI summary as <name>.summary.md (written to a temp file first, so it's never half-written). */
  saveSummary(id: string, text: string, provider: AiProvider): SummaryInfo {
    const folder = this.folderOf(id);
    const base = this.transcriptBase(folder, id, this.audioOf(folder));
    const file = this.summaryFile(base);
    fs.writeFileSync(`${file}.tmp`, text.trim() + '\n', 'utf8');
    fs.renameSync(`${file}.tmp`, file);
    const createdAt = new Date().toISOString();
    const item = this.readItem(folder);
    if (item) this.writeItem(folder, { ...item, summary: { provider, createdAt } }); // a broken item.json is left alone
    this.log(`saved the ${provider} summary of “${id}”`);
    return { text: text.trim() + '\n', provider, createdAt: Date.parse(createdAt), outdated: false };
  }

  /**
   * The audio to play or transcribe: a meeting's own .m4a, or a file item's original
   * (only the exact path saved in its item.json). Throws if there is none.
   */
  audioPath(id: string): string {
    const folder = this.folderOf(id);
    const audio = this.audioOf(folder);
    if (audio) return audio;
    const item = this.readItem(folder);
    if (item?.kind === 'file' && item.source) {
      if (!fs.existsSync(item.source)) throw new Error('Original file not found — it was moved or deleted.');
      return item.source;
    }
    throw new Error('No audio.');
  }

  /** Rename an item: its folder and every file named like it. Returns the new id. */
  rename(id: string, newTitle: string): string {
    const folder = this.folderOf(id);
    if (folder === this.recordingFolder()) throw new Error("Can't rename while it's recording.");
    const title = cleanTitle(newTitle);
    if (!title) throw new Error('Please enter a name.');
    if (title === id) return id;
    const target = path.join(this.dir, title);
    if (fs.existsSync(target)) throw new Error(`“${title}” already exists in the Library.`);
    for (const f of fs.readdirSync(folder)) {
      if (f.startsWith(`${id}.`)) fs.renameSync(path.join(folder, f), path.join(folder, title + f.slice(id.length)));
    }
    fs.renameSync(folder, target);
    this.log(`renamed “${id}” → “${title}”`);
    return title;
  }

  /** Write txt/srt/vtt/json transcripts at `base`.<ext>. */
  private writeTranscripts(base: string, segments: Segment[], details: formats.TranscriptDetails): void {
    for (const ext of TRANSCRIPT_EXTS) {
      fs.writeFileSync(`${base}.${ext}`, formats.format(ext, segments, details), 'utf8');
    }
  }

  /** Transcribe an item (meeting audio or the file's original) and save the transcripts in its folder. */
  async transcribe(id: string, opts: TranscribeOptions, onProgress: (progress: Progress) => void) {
    const folder = this.folderOf(id);
    const audio = this.audioPath(id); // throws if a file item's original is gone
    const result = await this.transcriber.transcribe(audio, onProgress, opts);
    const details = {
      language: opts.language || result.language,
      translate: Boolean(opts.translate),
      durationSec: result.durationSec,
      transcribedAt: new Date().toISOString(),
    };
    this.writeTranscripts(this.transcriptBase(folder, id, this.audioOf(folder)), result.segments, details);
    this.log(`transcribed “${id}” (${result.segments.length} segments) → .txt .srt .vtt .json`);
    return { ...result, ...details };
  }

  /**
   * A dropped/chosen file was transcribed → make it a Library item: a new folder named
   * after the file, holding the transcripts and item.json. The file itself isn't touched.
   * Returns the new item's id.
   */
  createFromFile(source: string, result: FileTranscript): string {
    fs.mkdirSync(this.dir, { recursive: true });
    const name = cleanTitle(path.parse(source).name) || 'Transcript';
    const folder = uniqueFolder(this.dir, name);
    const id = path.basename(folder);
    fs.mkdirSync(folder);
    this.writeItem(folder, {
      version: 1,
      kind: 'file',
      createdAt: new Date().toISOString(),
      source: path.resolve(source),
      durationSec: result.durationSec,
    });
    this.writeTranscripts(path.join(folder, id), result.segments, {
      language: result.language,
      translate: Boolean(result.translate),
      durationSec: result.durationSec,
      transcribedAt: new Date().toISOString(),
    });
    this.log(`saved the transcript of “${path.basename(source)}” as “${id}”`);
    return id;
  }
}
