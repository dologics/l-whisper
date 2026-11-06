// Runs on Chromium's real-time audio thread. Collects mic samples in chunks
// and posts them to recorder.ts. (Posting every 128 samples would be too chatty.)
class CaptureProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(4096);
  private filled = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'flush') {
        this.send();
        this.port.postMessage('flushed');
      }
    };
  }

  private send(): void {
    if (this.filled > 0) {
      this.port.postMessage(this.buffer.slice(0, this.filled));
      this.filled = 0;
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0] && inputs[0][0]; // first input, first (mono) channel
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.buffer.length) this.send();
      }
    }
    return true; // keep running
  }
}

registerProcessor('capture', CaptureProcessor);
