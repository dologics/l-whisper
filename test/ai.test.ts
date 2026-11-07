// Run: npm test — fake "claude" / "codex" programs (small Node scripts), no real AI is ever called.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { candidateDirs, findCli } from '../src/main/ai/find-cli';
import { buildSummaryPrompt } from '../src/main/ai/prompt';
import { Summarizer, SummaryCancelled, friendlyError } from '../src/main/ai/summarizer';

/** Write an executable Node script that pretends to be the AI tool. */
function fakeCli(dir: string, name: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

/** A fake `claude -p --output-format json` that records its args/stdin/cwd and answers `reply`. */
function fakeClaude(reply: object, exitCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
  const log = path.join(dir, 'call.json');
  const cli = fakeCli(
    dir,
    'claude',
    `let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }));
  console.log(JSON.stringify(${JSON.stringify(reply)}));
  process.exit(${exitCode});
});`
  );
  const call = () => JSON.parse(fs.readFileSync(log, 'utf8')) as { args: string[]; input: string; cwd: string };
  return { cli, call };
}

// ---------- finding the program ----------

test('findCli finds claude in ~/.local/bin even without the Terminal PATH', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-home-'));
  const cli = fakeCli(path.join(home, '.local/bin'), 'claude', '');
  assert.strictEqual(await findCli('claude', { home }), cli);
});

test('findCli: a hand-picked path wins; a missing one is ignored', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-home-'));
  const found = fakeCli(path.join(home, '.local/bin'), 'claude', '');
  const manual = fakeCli(path.join(home, 'elsewhere'), 'claude', '');
  assert.strictEqual(await findCli('claude', { home, manualPath: manual }), manual);
  assert.strictEqual(await findCli('claude', { home, manualPath: '/nope/claude' }), found);
});

test('findCli: not installed → null; non-executable files are skipped', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-home-'));
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local/bin/codex'), 'not a program'); // not executable
  const result = await findCli('codex', { home, shellLookup: async () => null });
  // only a real codex in /opt/homebrew/bin or /usr/local/bin on this Mac could be found
  assert.ok(result === null || !result.startsWith(home), String(result));
});

test('candidateDirs includes nvm Node folders, newest first', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-home-'));
  for (const v of ['v18.0.0', 'v22.1.0'])
    fs.mkdirSync(path.join(home, '.nvm/versions/node', v, 'bin'), { recursive: true });
  const dirs = candidateDirs(home).filter((d) => d.includes('.nvm'));
  assert.deepStrictEqual(dirs, [
    path.join(home, '.nvm/versions/node/v22.1.0/bin'),
    path.join(home, '.nvm/versions/node/v18.0.0/bin'),
  ]);
});

// ---------- running it ----------

test('claude: prompt on stdin, tools off, empty temp folder, answer returned', async () => {
  const { cli, call } = fakeClaude({ type: 'result', is_error: false, result: '## Summary\nThey met.' });
  const prompt = buildSummaryPrompt('Hello there.\nWe agreed on Friday.', 'Weekly call');
  const answer = await new Summarizer().ask('claude', cli, prompt);
  assert.strictEqual(answer, '## Summary\nThey met.');
  const { args, input, cwd } = call();
  assert.strictEqual(input, prompt); // the transcript goes in on stdin, not as an argument
  assert.ok(args.includes('-p'));
  assert.strictEqual(args[args.indexOf('--tools') + 1], ''); // no tools at all
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!args.some((a) => /dangerously|bypass/i.test(a)));
  assert.ok(path.basename(cwd).startsWith('whisper-desktop-ai-')); // an empty temp folder…
  assert.ok(!fs.existsSync(cwd)); // …removed afterwards
});

test('claude: "Not logged in" → a plain sign-in message', async () => {
  const { cli } = fakeClaude({ is_error: true, result: 'Not logged in · Please run /login' }, 1);
  await assert.rejects(new Summarizer().ask('claude', cli, 'x'), /Claude Code isn't signed in/);
});

test('usage limit and other errors become plain messages', () => {
  assert.match(friendlyError('codex', 'Error: 429 Too Many Requests'), /usage limit/);
  assert.match(friendlyError('claude', 'Claude AI usage limit reached'), /usage limit/);
  assert.match(friendlyError('codex', 'something odd\nreally odd'), /^Codex failed: something odd really odd$/);
});

test('an empty answer is an error, not an empty summary', async () => {
  const { cli } = fakeClaude({ is_error: false, result: '   ' });
  await assert.rejects(new Summarizer().ask('claude', cli, 'x'), /empty answer/);
});

test('codex: answer read from --output-last-message, prompt from stdin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
  const cli = fakeCli(
    dir,
    'codex',
    `const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (args[0] !== 'exec' || args[args.length - 1] !== '-') process.exit(2);
  console.log('progress noise on stdout');
  require('fs').writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Summary from codex: ' + input.length);
});`
  );
  assert.strictEqual(await new Summarizer().ask('codex', cli, 'abc'), 'Summary from codex: 3');
});

test('timeout and Cancel stop the program', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
  const slow = fakeCli(dir, 'claude', 'setTimeout(() => {}, 60000);');
  await assert.rejects(new Summarizer({ timeoutMs: 300 }).ask('claude', slow, 'x'), /No answer after/);

  const s = new Summarizer();
  const running = s.ask('claude', slow, 'x');
  setTimeout(() => s.cancel(), 200);
  await assert.rejects(running, SummaryCancelled);
  assert.strictEqual(s.busy, false);
});

test('prompt: instructions + title + plain transcript', () => {
  const p = buildSummaryPrompt('  Line one.\nLine two.  ', 'Client call');
  assert.match(p, /simple, plain English/);
  assert.match(p, /third person/);
  assert.match(p, /## Action items/);
  assert.match(p, /Title: Client call\n\nTranscript:\nLine one.\nLine two.\n$/);
});

test('prompt: meeting-minutes style — outcome first, five short sections, one page (task 32)', () => {
  const p = buildSummaryPrompt('Hi.', 'Call');
  // the sections, in this order
  const order = ['## Overview', '## Decisions', '## Action items', '## Discussion', '## Open questions'].map((h) =>
    p.indexOf(h)
  );
  assert.ok(
    order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])),
    `sections in order: ${order}`
  );
  assert.match(p, /\*\*Owner\*\* — task/); // owner-first action items
  assert.match(p, /Unassigned/);
  assert.match(p, /Never nest bullets/);
  assert.match(p, /150–400 words/);
  assert.match(p, /Leave out any section that would be empty/);
  assert.doesNotMatch(p, /## Key points|## Summary/); // the old long sections are gone
});

test('meeting with speakers: the prompt says who the names are', () => {
  const p = buildSummaryPrompt('Sara: Hi.\n\nSpeaker 2: Hello.', 'Call', { mic: 'Sara', system: 'Speaker 2' });
  assert.ok(p.includes('"Sara" is the person who recorded this meeting'));
  assert.ok(p.includes('"Speaker 2" is everyone else on the call'));
  assert.ok(!buildSummaryPrompt('Hi.', 'Call').includes('recorded this meeting')); // no labels → no note
});
