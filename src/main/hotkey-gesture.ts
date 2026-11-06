// Turns dictation-key events (down / up / combo, from HotkeyMatcher) into dictation actions.
// "The key" is Fn or the chosen two-key combination (e.g. ⌃⌥):
//
//   Hold the key (≥ holdMs)       → push-to-talk: record while held, stop on release
//   Double-tap the key            → hands-free: keeps recording after you let go
//   Tap the key while hands-free  → stop
//   The key + another key         → it's a normal shortcut, cancel the recording
//
// Recording starts on the first 'down' so nothing at the start of speech is lost;
// a single quick tap just cancels it.
import type { HotkeyEvent } from './hotkey';
export type GestureState = 'idle' | 'pressing' | 'handsfree' | 'stopping';

export interface HotkeyGestureOptions {
  /** begin recording */
  onStart: () => void;
  /** stop and transcribe */
  onStop: (mode: 'hold' | 'handsfree') => void;
  /** stop and throw away */
  onCancel: (reason: 'tap' | 'combo') => void;
  /** hands-free mode began (still recording) */
  onHandsFree?: () => void;
  /** a press at least this long is push-to-talk */
  holdMs?: number;
  /** two taps closer than this = hands-free */
  doubleTapMs?: number;
  /** clock (tests pass a fake one) */
  now?: () => number;
}

export class HotkeyGesture {
  state: GestureState = 'idle';
  private downAt = 0;
  private lastTapAt = 0;
  private readonly onStart: () => void;
  private readonly onStop: (mode: 'hold' | 'handsfree') => void;
  private readonly onCancel: (reason: 'tap' | 'combo') => void;
  private readonly onHandsFree: () => void;
  private readonly holdMs: number;
  private readonly doubleTapMs: number;
  private readonly now: () => number;

  constructor({
    onStart,
    onStop,
    onCancel,
    onHandsFree = () => {},
    holdMs = 300,
    doubleTapMs = 500,
    now = Date.now,
  }: HotkeyGestureOptions) {
    this.onStart = onStart;
    this.onStop = onStop;
    this.onCancel = onCancel;
    this.onHandsFree = onHandsFree;
    this.holdMs = holdMs;
    this.doubleTapMs = doubleTapMs;
    this.now = now;
  }

  /** Forget a half-finished press (used when the dictation key changes). */
  reset(): void {
    this.state = 'idle';
    this.lastTapAt = 0;
  }

  handle(event: HotkeyEvent): void {
    const t = this.now();
    switch (event) {
      case 'down':
        if (this.state === 'idle') {
          this.state = 'pressing';
          this.downAt = t;
          this.onStart();
        } else if (this.state === 'handsfree') {
          this.state = 'stopping'; // wait for the matching 'up', then go idle
          this.onStop('handsfree');
        }
        break;

      case 'up':
        if (this.state === 'pressing') {
          if (t - this.downAt >= this.holdMs) {
            this.state = 'idle';
            this.lastTapAt = 0;
            this.onStop('hold');
          } else if (this.lastTapAt && t - this.lastTapAt <= this.doubleTapMs) {
            this.state = 'handsfree'; // second quick tap: keep recording
            this.lastTapAt = 0;
            this.onHandsFree();
          } else {
            this.state = 'idle'; // single quick tap: maybe the first of a double-tap
            this.lastTapAt = t;
            this.onCancel('tap');
          }
        } else if (this.state === 'stopping') {
          this.state = 'idle';
        }
        break;

      case 'combo':
        if (this.state === 'pressing') {
          this.state = 'idle';
          this.lastTapAt = 0;
          this.onCancel('combo');
        }
        break;
    }
  }
}
