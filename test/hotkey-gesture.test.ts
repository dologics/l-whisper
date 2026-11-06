// Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { HotkeyGesture } from '../src/main/hotkey-gesture';
import type { HotkeyEvent } from '../src/main/hotkey';

// Feed [event, atMs] pairs; return the list of actions the gesture fired.
function run(steps: [HotkeyEvent, number][]) {
  let clock = 0;
  const actions: string[] = [];
  const g = new HotkeyGesture({
    now: () => clock,
    onStart: () => actions.push('start'),
    onStop: (mode) => actions.push(`stop:${mode}`),
    onCancel: (why) => actions.push(`cancel:${why}`),
    onHandsFree: () => actions.push('handsfree'),
  });
  for (const [event, at] of steps) {
    clock = at;
    g.handle(event);
  }
  return { actions, state: g.state };
}

test('hold the key = push-to-talk', () => {
  const r = run([
    ['down', 0],
    ['up', 2000],
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'stop:hold']);
  assert.strictEqual(r.state, 'idle');
});

test('single quick tap cancels (nothing transcribed)', () => {
  const r = run([
    ['down', 0],
    ['up', 120],
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'cancel:tap']);
});

test('double-tap starts hands-free, next tap stops it', () => {
  const r = run([
    ['down', 0],
    ['up', 100], // tap 1
    ['down', 250],
    ['up', 350], // tap 2 → hands-free
    ['down', 30000],
    ['up', 30100], // tap → stop
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'cancel:tap', 'start', 'handsfree', 'stop:handsfree']);
  assert.strictEqual(r.state, 'idle');
});

test('two slow taps are not a double-tap', () => {
  const r = run([
    ['down', 0],
    ['up', 100],
    ['down', 900],
    ['up', 1000],
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'cancel:tap', 'start', 'cancel:tap']);
});

test('tap then hold = push-to-talk, not hands-free', () => {
  const r = run([
    ['down', 0],
    ['up', 100],
    ['down', 200],
    ['up', 3000],
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'cancel:tap', 'start', 'stop:hold']);
});

test('the key + another key (shortcut) cancels', () => {
  const r = run([
    ['down', 0],
    ['combo', 150],
    ['up', 400],
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'cancel:combo']);
  assert.strictEqual(r.state, 'idle');
});

test('in hands-free, shortcuts with the key do not stop it', () => {
  const r = run([
    ['down', 0],
    ['up', 100],
    ['down', 250],
    ['up', 350], // hands-free
    ['combo', 5000],
  ]);
  assert.deepStrictEqual(r.actions, ['start', 'cancel:tap', 'start', 'handsfree']);
  assert.strictEqual(r.state, 'handsfree');
});

test('after hands-free stops, a new hold works', () => {
  const r = run([
    ['down', 0],
    ['up', 100],
    ['down', 250],
    ['up', 350],
    ['down', 5000],
    ['up', 5100], // stop hands-free
    ['down', 8000],
    ['up', 9500], // new hold
  ]);
  assert.deepStrictEqual(r.actions.slice(-2), ['start', 'stop:hold']);
});
