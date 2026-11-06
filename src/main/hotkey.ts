// The dictation key: Fn alone, or a combination of two modifier keys (e.g. ⌃⌥ Control+Option).
//
// The Swift helper reports which modifiers are held ("mods control,option") and that some other
// key was pressed while a modifier was held ("key"). HotkeyMatcher turns that into three events
// for HotkeyGesture:
//
//   down   exactly the chosen keys are now held (no other modifier)
//   up     one of the chosen keys was released
//   combo  while held, another key or modifier was pressed → it's a shortcut (⌃⌥T), not dictation
//
// Only modifiers are allowed: they type nothing, so holding them never puts letters into your app,
// and the helper can stay listen-only (it never blocks keys).
//
// Plain Node, no Electron — unit-tested in test/hotkey.test.ts.
import type { Hotkey, Modifier } from '../shared/types';

export type HotkeyEvent = 'down' | 'up' | 'combo';

export const MODIFIERS: Modifier[] = ['fn', 'control', 'option', 'shift', 'command'];
/** Keys allowed in a two-key combination (Fn is only offered on its own). */
export const COMBO_MODIFIERS: Modifier[] = ['control', 'option', 'shift', 'command'];
export const DEFAULT_HOTKEY: Hotkey = { kind: 'fn' };

const SYMBOLS: Record<Modifier, string> = { fn: 'fn', control: '⌃', option: '⌥', shift: '⇧', command: '⌘' };

/** The keys that make up a hotkey. */
export function hotkeyKeys(hotkey: Hotkey): Modifier[] {
  return hotkey.kind === 'fn' ? ['fn'] : [...hotkey.keys];
}

/** Short label for menus and hints: "fn", "⌃⌥". */
export function hotkeyLabel(hotkey: Hotkey): string {
  // macOS writes modifiers in the order ⌃ ⌥ ⇧ ⌘
  return hotkeyKeys(hotkey)
    .sort((a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b))
    .map((k) => SYMBOLS[k])
    .join('');
}

/** A valid hotkey from settings / the window, or null if it isn't one we allow. */
export function parseHotkey(value: unknown): Hotkey | null {
  const v = value as Partial<{ kind: string; keys: unknown }> | null;
  if (v?.kind === 'fn') return { kind: 'fn' };
  if (v?.kind === 'combo' && Array.isArray(v.keys) && v.keys.length === 2) {
    const [a, b] = v.keys as Modifier[];
    if (a !== b && COMBO_MODIFIERS.includes(a) && COMBO_MODIFIERS.includes(b)) return { kind: 'combo', keys: [a, b] };
  }
  return null;
}

/** Parse the helper's "mods …" line ("mods" alone = none held). */
export function parseMods(line: string): Modifier[] {
  return line
    .slice(4)
    .trim()
    .split(',')
    .filter((m): m is Modifier => (MODIFIERS as string[]).includes(m));
}

export class HotkeyMatcher {
  private keys: Modifier[];
  /** we reported 'down' and not yet 'up' */
  private isDown = false;
  /** the keys were completed while another modifier was held → ignore until released */
  private blocked = false;
  private lastMods: Modifier[] = [];

  constructor(hotkey: Hotkey = DEFAULT_HOTKEY) {
    this.keys = hotkeyKeys(hotkey);
  }

  setHotkey(hotkey: Hotkey): void {
    this.keys = hotkeyKeys(hotkey);
    this.isDown = false;
    this.blocked = false;
  }

  /** The modifiers held changed. Returns the event to pass on, if any. */
  handleMods(mods: Modifier[]): HotkeyEvent | null {
    const allHeld = this.keys.every((k) => mods.includes(k));
    const extras = mods.filter((m) => !this.keys.includes(m));
    const newExtra = extras.some((m) => !this.lastMods.includes(m));
    this.lastMods = mods;

    if (this.isDown) {
      if (!allHeld) {
        this.isDown = false;
        return 'up';
      }
      return newExtra ? 'combo' : null; // e.g. ⌃⌥ held, then ⌘ added
    }
    if (!allHeld) {
      this.blocked = false;
      return null;
    }
    if (extras.length > 0 || this.blocked) {
      this.blocked = true; // e.g. ⌃⌥⌘ for some other shortcut — not ours
      return null;
    }
    this.isDown = true;
    return 'down';
  }

  /** A normal key was pressed while a modifier was held. */
  handleKey(): HotkeyEvent | null {
    return this.isDown ? 'combo' : null;
  }
}
