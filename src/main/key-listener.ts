// Runs the Swift helper (bin/fn-listener — the file keeps its old name so macOS keeps its permissions):
//   - turns its output lines into events:
//       'mods'        → the modifier keys held right now, e.g. ['control', 'option'] ([] = none)
//       'key'         → a normal key was pressed while a modifier was held (no key code)
//       'status'      → 'ready' | 'permission-needed' | 'permission-granted' | 'error: …' | 'stopped'
//       'permissions' → { input: true, accessibility: false }
//   - paste(text): asks the helper to paste text into the focused app (clipboard is restored)
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import readline from 'node:readline';
import type { Modifier } from '../shared/types';
import { parseMods } from './hotkey';

/** What the helper reports for `status`: "status input=1 accessibility=0". */
export type HelperPermissions = Record<string, boolean>;

/** Typed events, so listeners get the right argument type. */
interface KeyListenerEvents {
  mods: [mods: Modifier[]];
  key: [];
  status: [status: string];
  permissions: [perms: HelperPermissions];
}

export class KeyListener extends EventEmitter<KeyListenerEvents> {
  private readonly binaryPath: string;
  private readonly log: (line: string) => void;
  private child: ChildProcessWithoutNullStreams | null = null;
  private pasteQueue: Promise<unknown> = Promise.resolve(); // one paste at a time
  private pasteReply: ((reply: string) => void) | null = null; // resolver for the paste in progress

  constructor({ binaryPath, log = () => {} }: { binaryPath: string; log?: (line: string) => void }) {
    super();
    this.binaryPath = binaryPath;
    this.log = log;
  }

  /**
   * Paste text into whatever app has focus. Resolves with the helper's reply
   * ('pasted' / 'pasted (clipboard changed, not restored)'); rejects on 'paste-error: …'.
   * dry = clipboard only, no ⌘V (used by automated tests).
   */
  paste(text: string, { dry = false }: { dry?: boolean } = {}): Promise<string> {
    const job = this.pasteQueue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          const child = this.child;
          if (!child) return reject(new Error('helper is not running'));
          const timer = setTimeout(() => {
            this.pasteReply = null;
            reject(new Error('helper did not answer'));
          }, 3000);
          this.pasteReply = (reply) => {
            clearTimeout(timer);
            this.pasteReply = null;
            if (reply.startsWith('paste-error')) reject(new Error(reply.replace('paste-error: ', '')));
            else resolve(reply);
          };
          // base64 keeps newlines/quotes/emoji safe on a single line
          const command = dry ? 'paste-dry' : 'paste';
          child.stdin.write(`${command} ${Buffer.from(text, 'utf8').toString('base64')}\n`);
        })
    );
    this.pasteQueue = job.catch(() => {}); // a failed paste doesn't block the next one
    return job;
  }

  start(): void {
    if (!fs.existsSync(this.binaryPath)) {
      this.emit('status', `error: key helper not built — run: npm run build:native`);
      return;
    }
    // stdin stays open; the helper exits by itself when we close it (or when we quit).
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', (raw) => {
      const line = raw.trim();
      if (line === 'mods' || line.startsWith('mods ')) this.emit('mods', parseMods(line));
      else if (line === 'key') this.emit('key');
      else if (line.startsWith('paste')) this.pasteReply?.(line);
      else if (line.startsWith('status ')) {
        // "status input=1 accessibility=0" → { input: true, accessibility: false }
        const perms = Object.fromEntries(
          line
            .slice(7)
            .split(' ')
            .map((kv) => kv.split('='))
            .map(([k, v]) => [k, v === '1'])
        );
        this.emit('permissions', perms);
      } else if (line) this.emit('status', line);
    });
    child.stderr.on('data', (d: Buffer) => this.log(`helper stderr: ${d.toString().trim()}`));
    child.on('exit', (code) => {
      this.child = null;
      this.emit('status', `stopped (exit code ${code})`);
    });
  }

  /** Show macOS's Accessibility prompt (first-run setup); also lists the app in System Settings. */
  askAccessibility(): void {
    this.child?.stdin.write('ask-accessibility\n');
  }

  /** Ask the helper which permissions it has; answer arrives as a 'permissions' event. */
  requestPermissions(): void {
    this.child?.stdin.write('status\n');
  }

  stop(): void {
    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
      this.child = null;
    }
  }
}
