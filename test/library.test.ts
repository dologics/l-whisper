// Run: npm test — uses temporary folders with fake recordings and files, no real audio.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Library, prepareLibraryDir } from '../src/main/library';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'library-src-')); // where "dropped" files live
  const transcribed: string[] = []; // files the fake transcriber was asked to read
  const fake = {
    transcribe: async (file: string) => {
      transcribed.push(file);
      return { segments: [{ start: 0, end: 2, text: 'Assalam o alaikum.' }], durationSec: 2, language: 'ur' };
    },
  };
  const lib = new Library({ dir, transcriber: fake });
  /** a meeting folder with its audio (or a loose .m4a, like before task 16) */
  const makeMeeting = (name: string, folder = true) => {
    const target = folder ? path.join(dir, name) : dir;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, `${name}.m4a`), 'audio');
  };
  /** a "dropped" audio/video file somewhere outside the library */
  const makeSource = (name: string) => {
    const file = path.join(outside, name);
    fs.writeFileSync(file, 'video');
    return file;
  };
  const result = { segments: [{ start: 0, end: 3, text: 'Hello there.' }], durationSec: 3, language: 'en' };
  return { dir, lib, makeMeeting, makeSource, result, transcribed };
}

// ---------- the one-time folder move ----------

test('prepareLibraryDir moves the old recordings folder once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-move-'));
  const oldDir = path.join(root, 'L - Whisper Recordings');
  const newDir = path.join(root, 'L - Whisper Library');
  fs.mkdirSync(path.join(oldDir, 'Meeting A'), { recursive: true });
  assert.strictEqual(prepareLibraryDir(newDir, oldDir), newDir);
  assert.ok(fs.existsSync(path.join(newDir, 'Meeting A')));
  assert.ok(!fs.existsSync(oldDir));
  assert.strictEqual(prepareLibraryDir(newDir, oldDir), newDir); // second launch: nothing to do
});

test('prepareLibraryDir never merges: both exist → new one, old one untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-move-'));
  const oldDir = path.join(root, 'old');
  const newDir = path.join(root, 'new');
  fs.mkdirSync(path.join(oldDir, 'Meeting A'), { recursive: true });
  fs.mkdirSync(newDir);
  assert.strictEqual(prepareLibraryDir(newDir, oldDir), newDir);
  assert.ok(fs.existsSync(path.join(oldDir, 'Meeting A')));
});

test('prepareLibraryDir removes an EMPTY old folder when the new one exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-move-'));
  const oldDir = path.join(root, 'old');
  const newDir = path.join(root, 'new');
  fs.mkdirSync(oldDir);
  fs.writeFileSync(path.join(oldDir, '.DS_Store'), ''); // Finder's file doesn't count
  fs.mkdirSync(newDir);
  assert.strictEqual(prepareLibraryDir(newDir, oldDir), newDir);
  assert.ok(!fs.existsSync(oldDir));
});

test('prepareLibraryDir keeps the old folder if the move fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-move-'));
  const oldDir = path.join(root, 'old');
  fs.mkdirSync(oldDir);
  const impossible = path.join(root, 'missing-parent', 'new'); // rename into a folder that doesn't exist fails
  assert.strictEqual(prepareLibraryDir(impossible, oldDir), oldDir);
  assert.ok(fs.existsSync(oldDir));
});

test('prepareLibraryDir with no old folder → the new one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-move-'));
  assert.strictEqual(prepareLibraryDir(path.join(root, 'new'), path.join(root, 'old')), path.join(root, 'new'));
});

// ---------- meetings (as before task 25) ----------

test('migrate moves loose .m4a files into their own folder', () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting A', false);
  lib.migrate();
  assert.ok(fs.existsSync(path.join(dir, 'Meeting A', 'Meeting A.m4a')));
  assert.ok(!fs.existsSync(path.join(dir, 'Meeting A.m4a')));
});

test('old meetings without item.json still show, and get one', async () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting old');
  const [item] = await lib.list();
  assert.strictEqual(item.kind, 'meeting');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'Meeting old', 'item.json'), 'utf8'));
  assert.strictEqual(saved.kind, 'meeting');
});

test('a damaged item.json is not overwritten and the meeting still shows', async () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting D');
  fs.writeFileSync(path.join(dir, 'Meeting D', 'item.json'), '{ broken');
  const items = await lib.list();
  assert.deepStrictEqual(
    items.map((m) => m.id),
    ['Meeting D']
  );
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Meeting D', 'item.json'), 'utf8'), '{ broken');
});

test('list: meetings and files together, newest first, skips other folders', async () => {
  const { dir, lib, makeMeeting, makeSource, result } = setup();
  makeMeeting('Meeting old');
  await new Promise((r) => setTimeout(r, 20));
  const id = lib.createFromFile(makeSource('Interview.mp4'), result);
  fs.mkdirSync(path.join(dir, 'not an item'));
  const items = await lib.list();
  assert.deepStrictEqual(
    items.map((m) => [m.id, m.kind]),
    [
      [id, 'file'],
      ['Meeting old', 'meeting'],
    ]
  );
});

test('rename renames the folder and the files inside', () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting X');
  fs.writeFileSync(path.join(dir, 'Meeting X', 'Meeting X.txt'), 't');
  const id = lib.rename('Meeting X', 'Client call / Acme');
  assert.strictEqual(id, 'Client call - Acme'); // "/" is not allowed in names
  assert.ok(fs.existsSync(path.join(dir, id, `${id}.m4a`)));
  assert.ok(fs.existsSync(path.join(dir, id, `${id}.txt`)));
});

test('ids can never point outside the library folder', () => {
  const { lib } = setup();
  for (const bad of ['../etc', '..', '/tmp', 'a/b', '.hidden', '']) {
    assert.throws(() => lib.folderOf(bad), /Invalid item|not found/, bad);
  }
});

test('transcribe a meeting writes txt, srt, vtt and json next to the audio', async () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting T');
  await lib.transcribe('Meeting T', { language: 'ur', translate: false }, () => {});
  for (const ext of ['txt', 'srt', 'vtt', 'json']) {
    assert.ok(fs.existsSync(path.join(dir, 'Meeting T', `Meeting T.${ext}`)), ext);
  }
  const m = await lib.get('Meeting T');
  assert.strictEqual(m.transcript?.language, 'ur');
  assert.strictEqual(m.segments[0].text, 'Assalam o alaikum.');
});

test('get lists the saved files; readSavedFile returns one, as it is on disk', async () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting F');
  assert.deepStrictEqual((await lib.get('Meeting F')).files, []); // not transcribed yet
  await lib.transcribe('Meeting F', { language: 'ur', translate: false }, () => {});
  lib.saveSummary('Meeting F', '## Summary\n- point', 'claude');
  const kinds = (await lib.get('Meeting F')).files.map((f) => f.kind);
  assert.deepStrictEqual(kinds, ['txt', 'srt', 'vtt', 'json', 'summary']);
  const srt = lib.readSavedFile('Meeting F', 'srt');
  assert.strictEqual(srt.name, 'Meeting F.srt');
  assert.strictEqual(srt.path, path.join(dir, 'Meeting F', 'Meeting F.srt'));
  assert.strictEqual(srt.text, fs.readFileSync(srt.path, 'utf8'));
  assert.strictEqual(lib.readSavedFile('Meeting F', 'summary').name, 'Meeting F.summary.md');
});

test('readSavedFile only reads the fixed kinds, never other paths', async () => {
  const { lib, makeMeeting } = setup();
  makeMeeting('Meeting G');
  await lib.transcribe('Meeting G', { language: 'en', translate: false }, () => {});
  assert.throws(() => lib.readSavedFile('Meeting G', 'm4a' as never), /Unknown file/);
  assert.throws(() => lib.readSavedFile('Meeting G', '../../etc/passwd' as never), /Unknown file/);
  assert.throws(() => lib.readSavedFile('Meeting G', 'summary'), /not saved/); // no summary yet
  assert.throws(() => lib.readSavedFile('../outside', 'txt')); // ids stay inside the library
});

// ---------- items made from dropped files ----------

test('createFromFile saves transcripts + item.json, never copies or moves the original', async () => {
  const { dir, lib, makeSource, result } = setup();
  const source = makeSource('Interview.mp4');
  const id = lib.createFromFile(source, result);
  assert.strictEqual(id, 'Interview');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, id)).sort(), [
    'Interview.json',
    'Interview.srt',
    'Interview.txt',
    'Interview.vtt',
    'item.json',
  ]);
  assert.strictEqual(fs.readFileSync(source, 'utf8'), 'video'); // original untouched, still there
  const item = await lib.get(id);
  assert.strictEqual(item.kind, 'file');
  assert.strictEqual(item.source, source);
  assert.strictEqual(item.sourceMissing, false);
  assert.strictEqual(item.ext, 'MP4');
  assert.strictEqual(item.segments[0].text, 'Hello there.');
  assert.strictEqual(lib.audioPath(id), source); // the player reads the original
});

test('createFromFile: same name twice → "Name 2"', () => {
  const { lib, makeSource, result } = setup();
  const source = makeSource('Talk.mp3');
  assert.strictEqual(lib.createFromFile(source, result), 'Talk');
  assert.strictEqual(lib.createFromFile(source, result), 'Talk 2');
});

test('original moved away → item still opens, but no audio and no re-transcribe', async () => {
  const { lib, makeSource, result } = setup();
  const source = makeSource('Gone.wav');
  const id = lib.createFromFile(source, result);
  fs.rmSync(source);
  const item = await lib.get(id);
  assert.strictEqual(item.sourceMissing, true);
  assert.strictEqual(item.segments.length, 1); // transcript still readable
  assert.throws(() => lib.audioPath(id), /Original file not found/);
  await assert.rejects(
    lib.transcribe(id, {}, () => {}),
    /Original file not found/
  );
});

test('re-transcribing a file item reads the original and rewrites its transcripts', async () => {
  const { dir, lib, makeSource, result, transcribed } = setup();
  const source = makeSource('Call.m4a');
  const id = lib.createFromFile(source, result);
  await lib.transcribe(id, { language: 'ur' }, () => {});
  assert.deepStrictEqual(transcribed, [source]);
  const json = JSON.parse(fs.readFileSync(path.join(dir, id, `${id}.json`), 'utf8'));
  assert.strictEqual(json.segments[0].text, 'Assalam o alaikum.');
});

test('renaming a file item keeps the link to its original', async () => {
  const { lib, makeSource, result } = setup();
  const source = makeSource('Raw.mov');
  const id = lib.rename(lib.createFromFile(source, result), 'Board review');
  const item = await lib.get(id);
  assert.strictEqual(item.source, source);
  assert.strictEqual(item.segments.length, 1);
});

// ---------- AI summary (task 26) ----------

test('saveSummary writes <name>.summary.md + item.json, get() reads it back', async () => {
  const { dir, lib, makeSource, result } = setup();
  const id = lib.createFromFile(makeSource('Standup.mp3'), result);
  assert.strictEqual(lib.transcriptText(id), 'Hello there.'); // what the AI gets: no timestamps
  lib.saveSummary(id, '## Summary\nThey met.', 'claude');
  assert.strictEqual(fs.readFileSync(path.join(dir, id, `${id}.summary.md`), 'utf8'), '## Summary\nThey met.\n');
  const item = await lib.get(id);
  assert.strictEqual(item.hasSummary, true);
  assert.strictEqual(item.summary?.provider, 'claude');
  assert.strictEqual(item.summary?.outdated, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, id, 'item.json'), 'utf8')).summary.provider, 'claude');
});

test('a summary is "outdated" after transcribing again', async () => {
  const { lib, makeSource, result } = setup();
  const id = lib.createFromFile(makeSource('Review.wav'), result);
  lib.saveSummary(id, 'Old summary', 'codex');
  await new Promise((r) => setTimeout(r, 10));
  await lib.transcribe(id, {}, () => {});
  assert.strictEqual((await lib.get(id)).summary?.outdated, true);
});

test('meeting summary sits beside the audio and follows a rename', async () => {
  const { dir, lib, makeMeeting } = setup();
  makeMeeting('Meeting S');
  await lib.transcribe('Meeting S', {}, () => {});
  lib.saveSummary('Meeting S', 'Summary', 'claude');
  const id = lib.rename('Meeting S', 'Planning');
  assert.ok(fs.existsSync(path.join(dir, id, 'Planning.summary.md')));
  assert.strictEqual((await lib.get(id)).summary?.text, 'Summary\n');
});
