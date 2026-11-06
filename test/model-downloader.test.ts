// Run: npm test — downloads from a local test server (no internet), into a temp folder.
import test from 'node:test';
import assert from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DownloadCancelled, ModelDownloader, type DownloadProgress } from '../src/main/models/model-downloader';
import type { ModelInfo } from '../src/main/models/catalog';

const DATA = randomBytes(600 * 1024); // the "model file"
const SHA = createHash('sha256').update(DATA).digest('hex');

interface ServerMode {
  /** close the connection after sending this many bytes (first request only) */
  cutAfter?: number;
  /** answer every request with the whole file (as if Range weren't supported) */
  ignoreRange?: boolean;
  /** send in small chunks with pauses (to test cancel) */
  slow?: boolean;
}

/** A tiny HTTP server that serves DATA at /test.bin and records the Range headers it got. */
async function startServer(mode: ServerMode = {}) {
  const ranges: (string | undefined)[] = [];
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    ranges.push(req.headers.range);
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const start = m && !mode.ignoreRange ? Number(m[1]) : 0;
    const body = DATA.subarray(start);
    res.writeHead(start ? 206 : 200, { 'Content-Length': body.length });
    if (mode.cutAfter && requests === 1) {
      res.write(body.subarray(0, mode.cutAfter), () => res.destroy()); // connection drops
    } else if (mode.slow) {
      let i = 0;
      const timer = setInterval(() => {
        if (res.destroyed || i >= body.length) return clearInterval(timer);
        res.write(body.subarray(i, i + 16 * 1024));
        i += 16 * 1024;
        if (i >= body.length) res.end();
      }, 30);
    } else {
      res.end(body);
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/`, ranges, close: () => server.close() };
}

function setup(sha256 = SHA) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-test-'));
  const model: ModelInfo = { id: 'test', label: 'Test', file: 'test.bin', sizeBytes: DATA.length, sha256, note: '' };
  return { dir, model, target: path.join(dir, 'test.bin'), part: path.join(dir, 'test.bin.part') };
}

test('downloads, verifies and renames the file', async () => {
  const srv = await startServer();
  const { dir, model, target, part } = setup();
  const progress: DownloadProgress[] = [];
  const result = await new ModelDownloader({ dir, baseUrl: srv.baseUrl }).download(model, (p) => progress.push(p));
  srv.close();
  assert.strictEqual(result, target);
  assert.ok(fs.readFileSync(target).equals(DATA));
  assert.ok(!fs.existsSync(part));
  assert.strictEqual(progress.at(-1)?.phase, 'verifying');
});

test('a cut connection keeps the .part file and the next try resumes from it', async () => {
  const srv = await startServer({ cutAfter: 200 * 1024 });
  const { dir, model, target, part } = setup();
  const downloader = new ModelDownloader({ dir, baseUrl: srv.baseUrl });
  await assert.rejects(downloader.download(model), /interrupted|stopped early/);
  const kept = fs.statSync(part).size;
  assert.ok(kept > 0 && kept < DATA.length, `kept ${kept} bytes`);

  await downloader.download(model);
  srv.close();
  assert.ok(fs.readFileSync(target).equals(DATA));
  assert.strictEqual(srv.ranges[1], `bytes=${kept}-`); // second request asked only for the rest
});

test('a server that ignores Range still gives a correct file', async () => {
  const srv = await startServer({ ignoreRange: true });
  const { dir, model, target, part } = setup();
  fs.writeFileSync(part, DATA.subarray(0, 1000)); // leftover from an earlier try
  await new ModelDownloader({ dir, baseUrl: srv.baseUrl }).download(model);
  srv.close();
  assert.ok(fs.readFileSync(target).equals(DATA));
});

test('a wrong checksum removes the file and reports it', async () => {
  const srv = await startServer();
  const { dir, model, target, part } = setup('0'.repeat(64));
  await assert.rejects(new ModelDownloader({ dir, baseUrl: srv.baseUrl }).download(model), /checksum/);
  srv.close();
  assert.ok(!fs.existsSync(target));
  assert.ok(!fs.existsSync(part));
});

test('cancel stops the download and keeps the .part for later', async () => {
  const srv = await startServer({ slow: true });
  const { dir, model, target, part } = setup();
  const downloader = new ModelDownloader({ dir, baseUrl: srv.baseUrl });
  const job = downloader.download(model, () => downloader.cancel()); // cancel at the first progress report
  await assert.rejects(job, DownloadCancelled);
  srv.close();
  assert.ok(!fs.existsSync(target));
  assert.ok(fs.statSync(part).size > 0, 'the bytes received so far are kept');
  assert.strictEqual(downloader.busyWith, null);
});
