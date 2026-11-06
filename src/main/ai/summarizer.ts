// Runs the user's AI command-line tool (Claude Code or Codex) to summarize a transcript,
// using the subscription the user is signed in with in that tool. No API keys here.
//
// Safety:
//   - only when the user clicks Summarize / Test (never automatically);
//   - only text goes in (the prompt + transcript, on stdin) — never audio or files;
//   - the program is run directly (no shell), in an EMPTY temporary folder, with all of its
//     tools turned off, so it can only answer with text;
//   - 5-minute timeout, Cancel stops it.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AiProvider } from '../../shared/types';
import { onLines } from '../util';
import { CLI_NAME, PROVIDER_LABEL } from './find-cli';

export class SummaryCancelled extends Error {}

/** Command-line arguments for each provider (checked against their --help, task 26 Notes). */
export function cliArgs(provider: AiProvider, lastMessageFile: string): string[] {
  if (provider === 'claude') {
    // -p: answer once and exit · json: a clear result/error · --tools "": no tools at all
    // --strict-mcp-config / --setting-sources "": skip the user's MCP servers, hooks and plugins
    // --no-session-persistence: don't add these runs to the user's Claude Code history
    // (not --bare: it skips the keychain, where the subscription login lives)
    // prettier-ignore
    return ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '',
      '--no-session-persistence'];
  }
  // codex exec: one non-interactive run · read-only sandbox · final answer written to a file · prompt from stdin
  // prettier-ignore
  return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never',
    '--output-last-message', lastMessageFile, '-'];
}

/** Turn a tool's error text into a plain message for the user. */
export function friendlyError(provider: AiProvider, raw: string): string {
  const name = PROVIDER_LABEL[provider];
  const text = raw.trim();
  if (/not logged in|log ?in|sign ?in|unauthori[sz]ed|authenticat|401|api key/i.test(text)) {
    return `${name} isn't signed in. Open Terminal, run “${CLI_NAME[provider]}”, sign in with your subscription, then try again.`;
  }
  if (/usage limit|rate limit|limit reached|quota|429|too many requests/i.test(text)) {
    return `Your ${name} usage limit is reached for now. Try again later.`;
  }
  const short = text.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
  return short ? `${name} failed: ${short}` : `${name} failed without saying why.`;
}

/** Claude Code's --output-format json answer (only the fields we read). */
interface ClaudeJson {
  is_error?: boolean;
  result?: string;
}

export interface SummarizerOptions {
  /** stop waiting after this long (default 5 min) */
  timeoutMs?: number;
  log?: (line: string) => void;
}

export class Summarizer {
  private readonly timeoutMs: number;
  private readonly log: (line: string) => void;
  private child: ChildProcess | null = null;
  private cancelled = false;
  busy = false;

  constructor({ timeoutMs = 5 * 60_000, log = () => {} }: SummarizerOptions = {}) {
    this.timeoutMs = timeoutMs;
    this.log = log;
  }

  /** Send `prompt` to the provider's CLI at `cliPath`; resolves with its text answer. */
  async ask(provider: AiProvider, cliPath: string, prompt: string): Promise<string> {
    if (this.busy) throw new Error('A summary is already being made.');
    this.busy = true;
    this.cancelled = false;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-desktop-ai-')); // empty: nothing to read
    const lastMessage = path.join(workDir, 'answer.txt');
    const t0 = Date.now();
    try {
      const { code, stdout, stderr } = await this.runCli(cliPath, cliArgs(provider, lastMessage), prompt, workDir);
      if (this.cancelled) throw new SummaryCancelled();
      this.log(`${CLI_NAME[provider]} finished in ${((Date.now() - t0) / 1000).toFixed(1)} s (exit ${code})`);
      let answer: string;
      if (provider === 'claude') {
        let data: ClaudeJson;
        try {
          data = JSON.parse(stdout.trim().split('\n').pop() || '{}') as ClaudeJson;
        } catch {
          throw new Error(friendlyError(provider, stderr || stdout));
        }
        if (data.is_error || code !== 0) throw new Error(friendlyError(provider, data.result || stderr));
        answer = data.result ?? '';
      } else {
        if (code !== 0) throw new Error(friendlyError(provider, stderr || stdout));
        answer = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, 'utf8') : stdout;
      }
      if (!answer.trim()) throw new Error(`${PROVIDER_LABEL[provider]} sent back an empty answer. Try again.`);
      return answer.trim();
    } finally {
      this.busy = false;
      this.child = null;
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** Stop the run in progress (if any). */
  cancel(): void {
    if (!this.child) return;
    this.cancelled = true;
    this.child.kill('SIGTERM');
  }

  /** Run the program with `input` on stdin; collect its output. Rejects on timeout or if it can't start. */
  private runCli(
    cliPath: string,
    args: string[],
    input: string,
    cwd: string
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      // The tool's own folder first in PATH: e.g. codex is a Node script that needs `node` from there.
      const extraPath = [path.dirname(cliPath), '/opt/homebrew/bin', '/usr/local/bin'];
      const env = { ...process.env, PATH: [...extraPath, process.env.PATH ?? ''].join(':') };
      const child = spawn(cliPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      onLines(child.stderr, (line) => (stderr += `${line}\n`));
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('No answer after 5 minutes. Try again, or try a shorter recording.'));
      }, this.timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Couldn't start ${path.basename(cliPath)}: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
      child.stdin.on('error', () => {}); // the tool may exit before reading everything (e.g. not signed in)
      child.stdin.end(input);
    });
  }
}
