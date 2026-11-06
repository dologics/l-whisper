// Find the AI command-line tool (Claude Code's `claude`, or Codex's `codex`) on this Mac.
//
// Why not just run "claude"? Apps started from the Dock or at login don't get the Terminal's
// PATH (only /usr/bin:/bin:/usr/sbin:/sbin), so we look in the places these tools install to,
// then ask a login shell as a last resort. On some Macs `claude` in the Terminal is a shell
// function or alias — we always want the real program file, never that.
import fs from 'node:fs';
import path from 'node:path';
import type { AiProvider } from '../../shared/types';
import { run } from '../util';

/** The program name of each provider. */
export const CLI_NAME: Record<AiProvider, string> = { claude: 'claude', codex: 'codex' };
/** What the user sees. */
export const PROVIDER_LABEL: Record<AiProvider, string> = { claude: 'Claude Code', codex: 'Codex' };

/** An existing, executable file (symlinks followed)? */
export function isExecutable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Folders to look in, most likely first. */
export function candidateDirs(home: string): string[] {
  const dirs = [
    path.join(home, '.local/bin'), // Claude Code's own installer
    path.join(home, '.claude/local'), // older Claude Code installs
    '/opt/homebrew/bin', // Homebrew (Apple Silicon)
    '/usr/local/bin', // Homebrew (Intel), npm's default global folder
    path.join(home, '.npm-global/bin'),
    path.join(home, '.bun/bin'),
    path.join(home, '.volta/bin'),
  ];
  // nvm: one folder per Node version — newest first
  const nvm = path.join(home, '.nvm/versions/node');
  try {
    const versions = fs.readdirSync(nvm).sort().reverse();
    dirs.push(...versions.map((v) => path.join(nvm, v, 'bin')));
  } catch {
    // no nvm
  }
  return dirs;
}

export interface FindCliOptions {
  home: string;
  /** a path the user chose by hand (Settings → Choose…) — wins if it's usable */
  manualPath?: string;
  /** last resort: ask the login shell (tests turn this off) */
  shellLookup?: (name: string) => Promise<string | null>;
}

/** Ask the user's login shell for the real program file (`whence -p` skips functions and aliases). */
export async function loginShellLookup(name: string): Promise<string | null> {
  try {
    const out = await Promise.race([
      run('/bin/zsh', ['-lc', `whence -p ${name}`]),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    const found = out.trim().split('\n')[0];
    return found && isExecutable(found) ? found : null;
  } catch {
    return null;
  }
}

/** The full path of the provider's program, or null if it isn't installed (that we can find). */
export async function findCli(provider: AiProvider, opts: FindCliOptions): Promise<string | null> {
  if (opts.manualPath && isExecutable(opts.manualPath)) return opts.manualPath;
  const name = CLI_NAME[provider];
  for (const dir of candidateDirs(opts.home)) {
    const file = path.join(dir, name);
    if (isExecutable(file)) return file;
  }
  return opts.shellLookup ? opts.shellLookup(name) : null;
}
