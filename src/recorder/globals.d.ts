// Types for the hidden recorder window's scripts (declarations only, no code).

// The bridge from src/preload/recorder-preload.ts.
interface Window {
  recorder: import('../shared/types').RecorderBridge;
}
type SoundName = import('../shared/types').SoundName;

// AudioWorklet scope (recorder-worklet.ts runs on the audio thread). TypeScript's DOM
// types don't describe it, so the two things we use are declared here.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
