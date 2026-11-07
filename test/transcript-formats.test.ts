// Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { toTxt, toSrt, toVtt, toJson, speakerLabels } from '../src/main/transcript-formats';
import type { Segment } from '../src/shared/types';

const segs = [
  { start: 0, end: 4.5, text: 'Welcome to the weekly update.' },
  { start: 4.9, end: 10.1, text: 'We finished dictation.' },
  { start: 3725.25, text: 'Last line, no end time.' }, // > 1 hour, end missing
];

test('txt: [mm:ss] per line, [h:mm:ss] after an hour', () => {
  assert.strictEqual(
    toTxt(segs),
    '[00:00] Welcome to the weekly update.\n[00:04] We finished dictation.\n[1:02:05] Last line, no end time.\n'
  );
});

test('srt: numbered blocks with comma milliseconds', () => {
  assert.strictEqual(
    toSrt(segs),
    '1\n00:00:00,000 --> 00:00:04,500\nWelcome to the weekly update.\n\n' +
      '2\n00:00:04,900 --> 00:00:10,100\nWe finished dictation.\n\n' +
      '3\n01:02:05,250 --> 01:02:08,250\nLast line, no end time.\n'
  );
});

test('vtt: WEBVTT header and dot milliseconds', () => {
  const vtt = toVtt(segs);
  assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:04.500\nWelcome to the weekly update.\n'));
  assert.ok(vtt.includes('01:02:05.250 --> 01:02:08.250\nLast line, no end time.'));
});

test('json: segments with ends filled in + details', () => {
  const data = JSON.parse(toJson(segs, { language: 'en' }));
  assert.strictEqual(data.language, 'en');
  assert.strictEqual(data.segments.length, 3);
  assert.strictEqual(data.segments[2].end, 3728.25);
});

test('missing end uses the next segment start', () => {
  const s = [
    { start: 1, text: 'a' },
    { start: 5, text: 'b' },
  ];
  assert.ok(toSrt(s).includes('00:00:01,000 --> 00:00:05,000'));
});

// ---------- meetings: no timestamps in .txt, speaker labels (task 27) ----------

const meeting: Segment[] = [
  { start: 0, end: 3, text: 'Hi everyone, can you hear me?', speaker: 'mic' },
  { start: 3, end: 5, text: 'Yes, loud and clear.', speaker: 'system' },
  { start: 5, end: 9, text: "Let's start with the release date.", speaker: 'system' },
  { start: 9, end: 11, text: 'Both talking at once.' }, // unknown → goes with the speaker before
  { start: 11, end: 14, text: 'Friday works.', speaker: 'mic' },
];
const named = speakerLabels('Mohsin');

test('speakerLabels: your name or "Speaker 1", other side "Speaker 2"', () => {
  assert.deepStrictEqual(speakerLabels('Mohsin'), { mic: 'Mohsin', system: 'Speaker 2' });
  assert.deepStrictEqual(speakerLabels(''), { mic: 'Speaker 1', system: 'Speaker 2' });
});

test('txt for a meeting: no timestamps, one paragraph per turn, unknown joins the turn before', () => {
  assert.strictEqual(
    toTxt(meeting, { timestamps: false, labels: named }),
    'Mohsin: Hi everyone, can you hear me?\n\n' +
      "Speaker 2: Yes, loud and clear. Let's start with the release date. Both talking at once.\n\n" +
      'Mohsin: Friday works.\n'
  );
});

test('txt for a meeting without the Speakers track: plain lines, no timestamps', () => {
  assert.strictEqual(
    toTxt(segs, { timestamps: false }),
    'Welcome to the weekly update.\nWe finished dictation.\nLast line, no end time.\n'
  );
});

test('txt: an unknown first line has no label', () => {
  const s: Segment[] = [
    { start: 0, text: 'Hmm.' },
    { start: 1, text: 'Hello.', speaker: 'system' },
  ];
  assert.strictEqual(toTxt(s, { timestamps: false, labels: named }), 'Hmm.\n\nSpeaker 2: Hello.\n');
});

test('txt with timestamps and speakers: one labelled line per segment', () => {
  assert.strictEqual(
    toTxt(meeting.slice(0, 2), { labels: named }),
    '[00:00] Mohsin: Hi everyone, can you hear me?\n[00:03] Speaker 2: Yes, loud and clear.\n'
  );
});

test('srt / vtt label each cue; unknown cues have no label', () => {
  const srt = toSrt(meeting, {}, { labels: named });
  assert.ok(srt.includes('00:00:00,000 --> 00:00:03,000\nMohsin: Hi everyone, can you hear me?\n'));
  assert.ok(srt.includes('00:00:09,000 --> 00:00:11,000\nBoth talking at once.\n'));
  const vtt = toVtt(meeting, {}, { labels: named });
  assert.ok(vtt.includes('00:00:03.000 --> 00:00:05.000\n<v Speaker 2>Yes, loud and clear.\n'));
  assert.ok(vtt.includes('00:00:09.000 --> 00:00:11.000\nBoth talking at once.\n'));
});

test('vtt: a name with < > & cannot break the voice tag', () => {
  const vtt = toVtt([{ start: 0, end: 1, text: 'Hi', speaker: 'mic' }], {}, { labels: { mic: 'A<b>&C', system: 'S' } });
  assert.ok(vtt.includes('<v AbC>Hi'));
});

test('json keeps the speaker of each segment (raw: mic/system), so names can change later', () => {
  const data = JSON.parse(toJson(meeting.slice(2, 4))) as { segments: Segment[] };
  assert.strictEqual(data.segments[0].speaker, 'system');
  assert.strictEqual('speaker' in data.segments[1], false);
});

test('files without speakers are unchanged (timestamps by default)', () => {
  assert.strictEqual(toTxt(segs).startsWith('[00:00] Welcome'), true);
  assert.strictEqual(toSrt(segs).includes('Mohsin'), false);
});
