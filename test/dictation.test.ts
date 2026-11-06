// Run: npm test
// Dictation must only announce "recording" (→ start beep, ●) when the recording is still
// wanted once the mic is live — a quick Fn tap cancels before that and must stay silent.
import test from 'node:test';
import assert from 'node:assert';
import { Dictation } from '../src/main/dictation';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake mic: takes `openMs` to open, returns a 1-second recording on stop. */
function fakeRecorder(openMs = 50) {
  return {
    start: () => sleep(openMs),
    stop: async () => ({ path: '/tmp/fake.wav', seconds: 1 }),
    discard: () => {},
  };
}

function setup(text = 'hello') {
  const states: string[] = [];
  const texts: string[] = [];
  const d = new Dictation({
    recorder: fakeRecorder(),
    engine: { transcribe: async () => text },
    onState: (s, detail) => states.push(detail ? `${s}:${detail}` : s),
    onText: (t) => texts.push(t),
  });
  return { d, states, texts };
}

test('quick tap (cancel before mic is live) never reports recording', async () => {
  const { d, states } = setup();
  d.start();
  await sleep(10); // mic still opening
  await d.cancel();
  await sleep(80); // let the mic "open" anyway
  assert.ok(!states.includes('recording'), `states were ${states}`);
});

test('hold reports recording, then transcribes and returns text', async () => {
  const { d, states, texts } = setup('hello');
  d.start();
  await sleep(80); // mic is live
  await d.stop();
  assert.deepStrictEqual(states, ['recording', 'transcribing', 'idle']);
  assert.deepStrictEqual(texts, ['hello']);
});

test('empty result reports "no speech detected" (→ soft low note)', async () => {
  const { d, states, texts } = setup('');
  d.start();
  await sleep(80);
  await d.stop();
  assert.deepStrictEqual(states.slice(-1), ['idle:no speech detected']);
  assert.deepStrictEqual(texts, []);
});
