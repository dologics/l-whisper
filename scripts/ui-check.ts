// Dev tool: drives the app window over the Chrome DevTools Protocol and saves screenshots.
// Start the app with:  npm start -- --remote-debugging-port=9222
// Then:               npx tsx scripts/ui-check.ts <outDir> <step> [<step> …]
// Steps: shot:<name> | eval:<js> | wait:<ms> | dark | light | print:<js> (logs the result)
// UI_TARGET=recorder/recorder.html connects to the hidden recorder window instead.
import fs from 'node:fs';
import path from 'node:path';

/** One entry of http://127.0.0.1:9222/json (a page or worker DevTools can attach to). */
interface DevToolsTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}
/** A DevTools Protocol reply (only the fields we read). */
interface CdpReply {
  id: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

const [outDir, ...steps] = process.argv.slice(2);

(async () => {
  const targets = (await (await fetch('http://127.0.0.1:9222/json')).json()) as DevToolsTarget[];
  const want = process.env.UI_TARGET || 'renderer/index.html';
  const page = targets.find((t) => t.type === 'page' && t.url.endsWith(want));
  if (!page) throw new Error(`window not found: ${want}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map<number, (msg: CdpReply) => void>();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data)) as CdpReply;
    const resolve = pending.get(msg.id);
    if (resolve) {
      resolve(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method: string, params: object = {}): Promise<CdpReply> =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  for (const step of steps) {
    const [kind, ...rest] = step.split(':');
    const arg = rest.join(':');
    if (kind === 'shot') {
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(outDir, `${arg}.png`);
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
      console.log(`saved ${file}`);
    } else if (kind === 'eval') {
      const { result } = await send('Runtime.evaluate', { expression: arg, awaitPromise: false });
      if (result.exceptionDetails) console.log(`eval error: ${result.exceptionDetails.text}`);
    } else if (kind === 'print') {
      const { result } = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
      console.log(`${arg} → ${JSON.stringify(result.result?.value)}`);
    } else if (kind === 'wait') {
      await new Promise((r) => setTimeout(r, Number(arg)));
    } else if (kind === 'dark' || kind === 'light') {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: kind }],
      });
    }
  }
  ws.close();
})().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
