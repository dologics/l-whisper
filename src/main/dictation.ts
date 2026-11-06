// One dictation from start to finish: mic → WAV → Whisper → text.
// Keeps operations in order, so a new recording never starts before the last one stopped.
import { errorMessage, sleep } from './util';

const MIN_SECONDS = 0.3; // shorter than this = accidental, don't transcribe
const TAIL_MS = 300; // keep recording briefly after release so the last word isn't cut

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'error';

/** A saved recording: temp WAV file + its length. */
export interface Recording {
  path: string;
  seconds: number;
}

/** The parts of MicRecorder that dictation needs (tests pass a fake). */
export interface DictationRecorder {
  start(): Promise<unknown>;
  stop(): Promise<Recording>;
  discard(file: string): void;
}

/** The part of WhisperEngine that dictation needs (tests pass a fake). */
export interface DictationEngine {
  transcribe(audioPath: string): Promise<string>;
}

export interface DictationOptions {
  recorder: DictationRecorder;
  engine: DictationEngine;
  onState: (state: DictationState, detail?: string) => void;
  /** called with the final text */
  onText: (text: string) => void;
  log?: (line: string) => void;
}

export class Dictation {
  private readonly recorder: DictationRecorder;
  private readonly engine: DictationEngine;
  private readonly onState: DictationOptions['onState'];
  private readonly onText: DictationOptions['onText'];
  private readonly log: (line: string) => void;
  /** resolves true when the mic is live, false if it failed; null when not dictating */
  private startPromise: Promise<boolean> | null = null;
  private previousStop: Promise<void> = Promise.resolve();

  constructor({ recorder, engine, onState, onText, log = () => {} }: DictationOptions) {
    this.recorder = recorder;
    this.engine = engine;
    this.onState = onState;
    this.onText = onText;
    this.log = log;
  }

  get isActive(): boolean {
    return this.startPromise !== null;
  }

  /** Begin recording (returns immediately; the mic opens in the background). */
  start(): void {
    if (this.startPromise) return;
    const thisStart: Promise<boolean> = (this.startPromise = this.previousStop
      .then(() => this.recorder.start())
      .then(
        () => {
          // Only announce "recording" if it wasn't cancelled while the mic was opening
          // (e.g. a quick Fn tap) — otherwise taps would flash ● and beep.
          if (this.startPromise === thisStart) this.onState('recording');
          return true;
        },
        (err: unknown) => {
          this.log(`could not start recording: ${errorMessage(err)}`);
          this.onState('error', errorMessage(err));
          return false;
        }
      ));
  }

  /** Stop and transcribe. */
  stop(): Promise<void> {
    return this.finish(true);
  }

  /** Stop and throw the recording away. */
  cancel(): Promise<void> {
    return this.finish(false);
  }

  private async finish(transcribe: boolean): Promise<void> {
    const started = this.startPromise;
    if (!started) return;
    this.startPromise = null;

    let release = () => {};
    this.previousStop = new Promise<void>((r) => (release = r));
    let recording: Recording;
    try {
      if (!(await started)) return;
      if (transcribe) await sleep(TAIL_MS);
      recording = await this.recorder.stop();
    } catch (err) {
      this.log(`could not stop recording: ${errorMessage(err)}`);
      this.onState('error', errorMessage(err));
      return;
    } finally {
      release(); // the mic is free again — a new recording may start
    }

    if (!transcribe || recording.seconds < MIN_SECONDS) {
      this.log(`discarded ${recording.seconds.toFixed(2)} s recording (${transcribe ? 'too short' : 'cancelled'})`);
      this.recorder.discard(recording.path);
      this.onState('idle');
      return;
    }

    this.onState('transcribing');
    try {
      const t0 = Date.now();
      const text = await this.engine.transcribe(recording.path);
      this.log(`${recording.seconds.toFixed(1)} s audio → ${Date.now() - t0} ms: "${text}"`);
      if (text) this.onText(text);
      this.onState('idle', text ? undefined : 'no speech detected');
    } catch (err) {
      this.log(`transcription failed: ${errorMessage(err)}`);
      this.onState('error', errorMessage(err));
    } finally {
      this.recorder.discard(recording.path);
    }
  }
}
