// Run: npm test — the matcher that turns held modifier keys into down / up / combo.
import test from 'node:test';
import assert from 'node:assert';
import { HotkeyMatcher, hotkeyLabel, parseHotkey, parseMods } from '../src/main/hotkey';
import type { Hotkey, Modifier } from '../src/shared/types';

/** Feed steps: a list of held modifiers, or 'key' (another key pressed). Returns the events. */
function run(hotkey: Hotkey, steps: (Modifier[] | 'key')[]): string[] {
  const m = new HotkeyMatcher(hotkey);
  return steps.map((s) => (s === 'key' ? m.handleKey() : m.handleMods(s))).filter((e) => e !== null) as string[];
}
const FN: Hotkey = { kind: 'fn' };
const CTRL_OPT: Hotkey = { kind: 'combo', keys: ['control', 'option'] };

test('Fn: press and release', () => {
  assert.deepStrictEqual(run(FN, [['fn'], []]), ['down', 'up']);
});

test('Fn + another key or modifier = combo, then up', () => {
  assert.deepStrictEqual(run(FN, [['fn'], 'key', []]), ['down', 'combo', 'up']);
  assert.deepStrictEqual(run(FN, [['fn'], ['fn', 'shift'], ['fn'], []]), ['down', 'combo', 'up']);
});

test('combo: down only when both keys are held, up when either is released', () => {
  assert.deepStrictEqual(run(CTRL_OPT, [['control'], ['control', 'option'], ['option'], []]), ['down', 'up']);
  assert.deepStrictEqual(run(CTRL_OPT, [['option'], ['control', 'option'], ['control'], []]), ['down', 'up']);
});

test('combo: one of the keys alone does nothing (normal ⌃C etc.)', () => {
  assert.deepStrictEqual(run(CTRL_OPT, [['control'], 'key', []]), []);
});

test('combo: a shortcut like ⌃⌥T cancels', () => {
  assert.deepStrictEqual(run(CTRL_OPT, [['control'], ['control', 'option'], 'key', ['control'], []]), [
    'down',
    'combo',
    'up',
  ]);
});

test('three modifiers (⌃⌥⌘) is a different shortcut — never starts dictation', () => {
  assert.deepStrictEqual(
    run(CTRL_OPT, [['command'], ['command', 'control'], ['command', 'control', 'option'], ['control', 'option'], []]),
    []
  );
});

test('Fn is not triggered by Fn plus another modifier pressed first', () => {
  assert.deepStrictEqual(run(FN, [['shift'], ['fn', 'shift'], ['fn'], []]), []);
});

test('labels, parsing and validation', () => {
  assert.strictEqual(hotkeyLabel(FN), 'fn');
  assert.strictEqual(hotkeyLabel({ kind: 'combo', keys: ['option', 'control'] }), '⌃⌥');
  assert.deepStrictEqual(parseMods('mods control,option'), ['control', 'option']);
  assert.deepStrictEqual(parseMods('mods'), []);
  assert.deepStrictEqual(parseHotkey({ kind: 'combo', keys: ['control', 'shift'] }), {
    kind: 'combo',
    keys: ['control', 'shift'],
  });
  for (const bad of [
    null,
    {},
    { kind: 'combo', keys: ['control', 'control'] },
    { kind: 'combo', keys: ['fn', 'shift'] },
  ]) {
    assert.strictEqual(parseHotkey(bad), null);
  }
});
