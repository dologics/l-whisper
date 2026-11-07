// Speaker labels from the two sides' loudness (task 27). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { assignSpeakers, channelLevels, dtwPreset, type TimedSegment } from '../src/main/speakers';

const RATE = 16000;

/** Stereo PCM: who talks when — [startSec, endSec, 'mic' | 'system' | 'both']. Silence elsewhere. */
function pcm(seconds: number, talk: [number, number, 'mic' | 'system' | 'both'][], echo = 0): Int16Array {
  const out = new Int16Array(seconds * RATE * 2);
  for (let i = 0; i < seconds * RATE; i++) {
    const t = i / RATE;
    const tone = Math.sin(2 * Math.PI * 220 * t) * 8000; // "speech"
    const who = talk.find(([s, e]) => t >= s && t < e)?.[2];
    let mic = who === 'mic' || who === 'both' ? tone : 0;
    const sys = who === 'system' || who === 'both' ? tone : 0;
    if (who === 'system' && echo) mic = tone * echo; // laptop speakers: the mic hears the other side, quieter
    out[i * 2] = mic + (Math.random() - 0.5) * 4; // + a little noise
    out[i * 2 + 1] = sys + (Math.random() - 0.5) * 4;
  }
  return out;
}

/** A whisper segment whose words are spoken at the given times (seconds). */
function seg(start: number, end: number, words: [string, number][]): TimedSegment {
  return { start, end, text: words.map(([w]) => w).join(''), words: words.map(([text, time]) => ({ text, time })) };
}

test('one segment with two people is split at the change of speaker', () => {
  const levels = channelLevels(
    pcm(10, [
      [0, 3, 'mic'],
      [4, 7, 'system'],
    ]),
    RATE
  );
  const out = assignSpeakers(
    [
      seg(0, 7, [
        [' Can', 0.5],
        [' you', 1],
        [' hear', 1.5],
        [' me?', 2],
        [' Yes,', 4.5],
        [' loud', 5],
        [' and', 5.5],
        [' clear.', 6],
      ]),
    ],
    levels
  );
  assert.deepStrictEqual(
    out.map((s) => [s.speaker, s.text]),
    [
      ['mic', 'Can you hear me?'],
      ['system', 'Yes, loud and clear.'],
    ]
  );
  assert.strictEqual(out[0].start, 0); // first part keeps the segment start
  assert.strictEqual(out[1].end, 7); // last part keeps the segment end
  assert.ok(out[0].end! <= out[1].start); // in order, no overlap
});

test('a short "Yes." from the other side between two of your sentences', () => {
  const levels = channelLevels(
    pcm(8, [
      [0, 2, 'mic'],
      [2.6, 3.2, 'system'],
      [3.8, 6, 'mic'],
    ]),
    RATE
  );
  const out = assignSpeakers(
    [
      seg(0, 6, [
        [' Ready?', 1],
        [' Yes.', 2.9],
        [' Good,', 4.2],
        [' start.', 5],
      ]),
    ],
    levels
  );
  assert.deepStrictEqual(
    out.map((s) => s.speaker),
    ['mic', 'system', 'mic']
  );
});

test('word pieces and punctuation stay with their word', () => {
  const levels = channelLevels(pcm(4, [[0, 3, 'system']]), RATE);
  const out = assignSpeakers(
    [
      {
        start: 0,
        end: 3,
        text: 'My name is Dilla.',
        words: [
          { text: ' My', time: 0.5 },
          { text: ' name', time: 1 },
          { text: ' is', time: 1.4 },
          { text: ' D', time: 2 },
          { text: 'illa', time: 2.1 },
          { text: '.', time: 2.3 },
        ],
      },
    ],
    levels
  );
  assert.deepStrictEqual(
    out.map((s) => [s.speaker, s.text]),
    [['system', 'My name is Dilla.']]
  );
});

test('a segment from one side keeps its own text and times', () => {
  const levels = channelLevels(pcm(4, [[0, 3, 'mic']]), RATE);
  const out = assignSpeakers(
    [
      seg(0.2, 2.8, [
        [' Hello', 0.5],
        [' there.', 1.5],
      ]),
    ],
    levels
  );
  assert.deepStrictEqual(out, [{ start: 0.2, end: 2.8, text: 'Hello there.', speaker: 'mic' }]);
});

test('laptop speakers: the quieter echo of the other side on the mic does not count as you', () => {
  const levels = channelLevels(
    pcm(
      8,
      [
        [0, 3, 'mic'],
        [4, 7, 'system'],
      ],
      0.08 // the mic hears the other side ~22 dB quieter
    ),
    RATE
  );
  const out = assignSpeakers(
    [
      seg(0, 7, [
        [' Hi.', 1],
        [' Hello', 5],
        [' back.', 6],
      ]),
    ],
    levels
  );
  assert.deepStrictEqual(
    out.map((s) => s.speaker),
    ['mic', 'system']
  );
});

test('both talking at once, equally loud → no label (unknown joins the speaker before)', () => {
  const levels = channelLevels(
    pcm(6, [
      [0, 2, 'mic'],
      [2.5, 4, 'both'],
    ]),
    RATE
  );
  const out = assignSpeakers(
    [
      seg(0, 4, [
        [' First.', 1],
        [' Overlap.', 3],
      ]),
    ],
    levels
  );
  assert.deepStrictEqual(
    out.map((s) => [s.speaker, s.text]),
    [['mic', 'First. Overlap.']]
  );
});

test('silence on both sides (no words to place) → segment left unlabelled', () => {
  const levels = channelLevels(pcm(3, []), RATE);
  const out = assignSpeakers([seg(0, 2, [[' Hmm.', 1]])], levels);
  assert.deepStrictEqual(out, [{ start: 0, end: 2, text: 'Hmm.' }]);
});

test('dtwPreset: word timing preset from the model file name', () => {
  assert.strictEqual(dtwPreset('/x/ggml-large-v3-turbo-q5_0.bin'), 'large.v3.turbo');
  assert.strictEqual(dtwPreset('/x/ggml-large-v3-turbo.bin'), 'large.v3.turbo');
  assert.strictEqual(dtwPreset('/x/ggml-small.bin'), 'small');
  assert.strictEqual(dtwPreset('/x/ggml-base.en.bin'), 'base.en');
  assert.strictEqual(dtwPreset('/x/ggml-medium.bin'), 'medium');
  assert.strictEqual(dtwPreset('/x/something-else.bin'), null);
});

test('the other side starts (louder) while you are still finishing → your words stay yours', () => {
  // you talk 0–3 s; their sound starts at 2.4 s, overlapping your last words, and goes on to 5 s
  const out = new Int16Array(6 * RATE * 2);
  for (let i = 0; i < 6 * RATE; i++) {
    const t = i / RATE;
    const tone = Math.sin(2 * Math.PI * 220 * t);
    if (t < 3) out[i * 2] = tone * (t < 2.4 ? 8000 : 2500); // your voice fades at the end
    if (t >= 2.4 && t < 5) out[i * 2 + 1] = tone * 8000; // them, louder
  }
  const result = assignSpeakers(
    [
      seg(0, 5, [
        [' Tell', 1],
        [' me', 2.5],
        [' your', 2.75],
        [' name?', 2.95],
        [' Sara.', 4.4],
      ]),
    ],
    channelLevels(out, RATE)
  );
  assert.deepStrictEqual(
    result.map((s) => [s.speaker, s.text]),
    [
      ['mic', 'Tell me your name?'],
      ['system', 'Sara.'],
    ]
  );
});
