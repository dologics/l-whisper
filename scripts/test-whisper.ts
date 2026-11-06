// Terminal test for the Whisper engine module (no Electron needed).
// Usage: npx tsx scripts/test-whisper.ts [audio.wav]
import path from 'node:path';
import { WhisperEngine } from '../src/main/whisper';

const root = path.join(__dirname, '..');
const audio = process.argv[2] || path.join(root, 'samples', 'test-speech.wav');

(async () => {
  const engine = new WhisperEngine({
    binaryPath: path.join(root, 'bin', process.arch, 'whisper-server'), // npm run build:tools
    modelPath: path.join(root, 'models', 'ggml-large-v3-turbo.bin'),
    log: (m) => console.log(`[whisper] ${m}`),
  });
  try {
    await engine.start();
    for (let i = 1; i <= 2; i++) {
      const t0 = Date.now();
      const text = await engine.transcribe(audio);
      console.log(`run ${i} (${Date.now() - t0} ms): "${text}"`);
    }
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    engine.stop();
  }
})();
