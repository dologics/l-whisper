// Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { toTxt, toSrt, toVtt, toJson } from '../src/main/transcript-formats';

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
