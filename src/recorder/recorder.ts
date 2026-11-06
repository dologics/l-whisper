// Hidden recorder page: opens the microphone, collects 16 kHz mono samples,
// and on stop turns them into a WAV file that is sent to the main process.
//
// Speed: the audio engine + worklet are prepared ONCE at load and kept suspended,
// so pressing Fn only has to open the mic. The mic itself stays OFF while idle.
//
// A plain browser script (no imports), compiled by src/recorder/tsconfig.json.
const SAMPLE_RATE = 16000; // what Whisper expects

let context: AudioContext; // prepared once, suspended while idle
let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let worklet: AudioWorkletNode | null = null;
let chunks: Float32Array[] = [];

function prepare(): Promise<void> {
  // Asking for a 16 kHz context makes Chromium resample the mic (usually 48 kHz) for us.
  context = new AudioContext({ sampleRate: SAMPLE_RATE });
  return context.audioWorklet.addModule('recorder-worklet.js').then(() => context.suspend()); // idle: no audio processing at all
}

async function startRecording(): Promise<void> {
  try {
    await ready;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false, // keep the voice natural; Whisper handles the rest
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, 'capture');
    chunks = [];
    worklet.port.onmessage = (e: MessageEvent) => {
      if (e.data instanceof Float32Array) chunks.push(e.data);
    };
    source.connect(worklet);
    worklet.connect(context.destination); // outputs silence; keeps the node running
    await context.resume();
    window.recorder.started();
  } catch (err) {
    cleanup();
    const e = err as Error;
    window.recorder.failed(`${e.name}: ${e.message}`);
  }
}

async function stopRecording(): Promise<void> {
  const node = worklet;
  if (!node) {
    window.recorder.failed('Not recording');
    return;
  }
  // Ask the worklet for its last partial chunk before shutting down.
  await new Promise<void>((resolve) => {
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data instanceof Float32Array) chunks.push(e.data);
      else if (e.data === 'flushed') resolve();
    };
    node.port.postMessage('flush');
  });
  const samples = mergeChunks(chunks);
  cleanup();
  window.recorder.audio(encodeWav(samples, SAMPLE_RATE));
}

function cleanup(): void {
  stream?.getTracks().forEach((t) => t.stop()); // turns off the mic (orange dot goes away)
  source?.disconnect();
  worklet?.disconnect();
  void context?.suspend();
  stream = source = worklet = null;
  chunks = [];
}

function mergeChunks(list: Float32Array[]): Float32Array {
  const total = list.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of list) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Build a standard 16-bit PCM mono WAV file (44-byte header + samples).
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) =>
    [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i])); // float -1..1 → int16
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// ---------- feedback sounds (generated, no sound files) ----------
// Soft sine-wave notes with a quick fade-in and a smooth fade-out (no clicks).
// A separate AudioContext at the normal sample rate, so it never touches the mic one.
let sfx: AudioContext | null = null;

function note(ctx: AudioContext, freq: number, startAt: number, length: number, volume: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = ctx.currentTime + startAt;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.012); // fade in over 12 ms
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length); // gentle fade out
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

const SOUNDS: Record<SoundName, (ctx: AudioContext) => void> = {
  // E5 → B5 (rising: "listening")
  start: (ctx) => {
    note(ctx, 659, 0, 0.14, 0.1);
    note(ctx, 988, 0.07, 0.2, 0.1);
  },
  // B5 → E5 (falling: "finished")
  done: (ctx) => {
    note(ctx, 988, 0, 0.14, 0.1);
    note(ctx, 659, 0.07, 0.24, 0.1);
  },
  // A4, single soft low note: "nothing heard"
  none: (ctx) => note(ctx, 440, 0, 0.22, 0.07),
};

async function playSound(name: SoundName): Promise<void> {
  if (!SOUNDS[name]) return;
  sfx = sfx || new AudioContext();
  if (sfx.state !== 'running') await sfx.resume();
  SOUNDS[name](sfx);
}

const ready = prepare(); // engine prepared (awaited before the mic opens)
window.recorder.onStart(startRecording);
window.recorder.onStop(stopRecording);
window.recorder.onPlaySound(playSound);
