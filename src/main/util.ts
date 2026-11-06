// Small helpers used by several main-process modules.
import { execFile } from 'node:child_process';
import type { Readable } from 'node:stream';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The message of anything thrown (TypeScript treats caught errors as `unknown`). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run a command and return its stdout (rejects if it fails). */
export function run(cmd: string, args: string[], { maxBuffer = 1024 * 1024 } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/**
 * Call fn for every complete line a stream prints. `split` decides where lines end
 * (whisper-cli/ffmpeg also use "\r" for progress updates).
 */
export function onLines(stream: Readable, fn: (line: string) => void, split: RegExp | string = '\n'): void {
  let buf = '';
  stream.on('data', (d: Buffer) => {
    buf += d.toString();
    const parts = buf.split(split);
    buf = parts.pop() ?? '';
    parts.forEach(fn);
  });
}
