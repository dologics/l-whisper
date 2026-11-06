// AI summary (task 26): Settings → AI summary + the Library's Summarize button.
// Joins the settings (which tool), find-cli (where it is), the Summarizer (runs it)
// and the Library (transcript in, <name>.summary.md out).
//
// Nothing here runs by itself: only Test and Summarize (user clicks) send text to the AI.
import os from 'node:os';
import type { AiProvider, AiStatus, Outcome, SummaryInfo } from '../../shared/types';
import type { Library } from '../library';
import type { Settings } from '../settings';
import { errorMessage, run } from '../util';
import { findCli, isExecutable, loginShellLookup, PROVIDER_LABEL } from './find-cli';
import { buildSummaryPrompt } from './prompt';
import { Summarizer, SummaryCancelled } from './summarizer';

export interface AiSummaryOptions {
  settings: Settings;
  library: Library;
  log?: (line: string) => void;
}

export class AiSummary {
  private readonly settings: Settings;
  private readonly library: Library;
  private readonly log: (line: string) => void;
  readonly summarizer: Summarizer;

  constructor({ settings, library, log = () => {} }: AiSummaryOptions) {
    this.settings = settings;
    this.library = library;
    this.log = log;
    this.summarizer = new Summarizer({ log });
  }

  /** The chosen tool, or 'off' (the default — nothing is ever sent). */
  provider(): 'off' | AiProvider {
    const p = this.settings.get('aiProvider');
    return p === 'claude' || p === 'codex' ? p : 'off';
  }

  setProvider(provider: unknown): void {
    const p = provider === 'claude' || provider === 'codex' ? provider : 'off';
    if (p !== this.provider()) this.settings.set('aiCliPath', undefined); // a hand-picked path belongs to the old tool
    this.settings.set('aiProvider', p);
    this.log(`provider → ${p}`);
  }

  /** Use this program file for the current provider (from Settings → Choose…). */
  setManualPath(file: string): void {
    this.settings.set('aiCliPath', isExecutable(file) ? file : undefined);
  }

  /** Where the chosen tool is, and its version. */
  async status(): Promise<AiStatus> {
    const provider = this.provider();
    if (provider === 'off') return { provider, path: null, version: null, manual: false };
    const manualPath = this.settings.get('aiCliPath');
    const found = await findCli(provider, { home: os.homedir(), manualPath, shellLookup: loginShellLookup });
    let version: string | null = null;
    if (found) version = (await run(found, ['--version']).catch(() => '')).trim().split('\n')[0] || null;
    return { provider, path: found, version, manual: Boolean(found && found === manualPath) };
  }

  /** The program to run, or an Outcome saying what to set up. */
  private async ready(): Promise<{ provider: AiProvider; cli: string } | Outcome> {
    const provider = this.provider();
    if (provider === 'off') {
      return { ok: false, needsSetup: true, error: 'Choose Claude Code or Codex in Settings → AI summary first.' };
    }
    const { path } = await this.status();
    if (!path) {
      const name = PROVIDER_LABEL[provider];
      return { ok: false, needsSetup: true, error: `${name} isn't installed on this Mac (or wasn't found).` };
    }
    return { provider, cli: path };
  }

  /** Settings → Test: a tiny prompt, to check the tool is installed and signed in. */
  async test(): Promise<Outcome<{ reply: string }>> {
    const r = await this.ready();
    if ('ok' in r) return r as Outcome<{ reply: string }>;
    try {
      const reply = await this.summarizer.ask(r.provider, r.cli, 'Reply with exactly: OK');
      return { ok: true, reply: reply.slice(0, 200) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  /** Summarize a Library item's transcript and save it next to it. */
  async summarize(id: string): Promise<Outcome<{ summary: SummaryInfo }>> {
    const r = await this.ready();
    if ('ok' in r) return r as Outcome<{ summary: SummaryInfo }>;
    try {
      const text = this.library.transcriptText(id);
      if (!text) return { ok: false, error: 'Transcribe it first — there is no transcript to summarize yet.' };
      this.log(`summarizing “${id}” with ${r.provider} (${text.length} characters)`);
      const answer = await this.summarizer.ask(r.provider, r.cli, buildSummaryPrompt(text, id));
      return { ok: true, summary: this.library.saveSummary(id, answer, r.provider) };
    } catch (err) {
      if (err instanceof SummaryCancelled) return { ok: false, cancelled: true };
      this.log(`summary failed: ${errorMessage(err)}`);
      return { ok: false, error: errorMessage(err) };
    }
  }

  cancel(): void {
    this.summarizer.cancel();
  }
}
