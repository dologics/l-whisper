// Run: npm test — uses a temporary models folder with small fake model files.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelStore } from '../src/main/models/model-store';
import { recommendedModelId, type ModelInfo } from '../src/main/models/catalog';

const fake = (id: string, sizeBytes: number): ModelInfo => ({
  id,
  label: id,
  file: `ggml-${id}.bin`,
  sizeBytes,
  sha256: '',
  note: '',
});
const CATALOG = [fake('tiny', 10), fake('small', 20), fake('large-v3-turbo', 30)];

function setup(active?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-store-test-'));
  const saved = { active };
  const store = new ModelStore({
    dir,
    catalog: CATALOG,
    getActive: () => saved.active,
    saveActive: (id) => (saved.active = id),
  });
  const put = (file: string, bytes: number) => fs.writeFileSync(path.join(dir, file), Buffer.alloc(bytes));
  return { dir, store, saved, put };
}

test('list shows downloaded, partial and missing models', () => {
  const { store, put } = setup('small');
  put('ggml-small.bin', 20);
  put('ggml-tiny.bin.part', 4);
  put('ggml-large-v3-turbo.bin', 12); // wrong size = not (fully) downloaded
  const byId = Object.fromEntries(store.list().map((m) => [m.id, m]));
  assert.deepStrictEqual([byId.small.downloaded, byId.small.active], [true, true]);
  assert.deepStrictEqual([byId.tiny.downloaded, byId.tiny.bytesOnDisk], [false, 4]);
  assert.strictEqual(byId['large-v3-turbo'].downloaded, false);
});

test('no active model when nothing is chosen or its file is gone', () => {
  assert.strictEqual(setup().store.activeId(), null);
  assert.strictEqual(setup('small').store.activeId(), null); // chosen but not on disk
});

test('migrate makes an existing large-v3-turbo the active model', () => {
  const { store, saved, put } = setup();
  put('ggml-tiny.bin', 10);
  put('ggml-large-v3-turbo.bin', 30);
  store.migrate();
  assert.strictEqual(saved.active, 'large-v3-turbo');
  assert.ok(store.activePath()?.endsWith('ggml-large-v3-turbo.bin'));
});

test('migrate leaves an existing choice alone', () => {
  const { store, saved, put } = setup('tiny');
  put('ggml-tiny.bin', 10);
  put('ggml-large-v3-turbo.bin', 30);
  store.migrate();
  assert.strictEqual(saved.active, 'tiny');
});

test('setActive needs a downloaded model; delete refuses the active one', () => {
  const { store, put, dir } = setup();
  assert.throws(() => store.setActive('small'), /isn't downloaded/);
  put('ggml-small.bin', 20);
  put('ggml-tiny.bin', 10);
  store.setActive('small');
  assert.throws(() => store.delete('small'), /in use/);
  store.delete('tiny');
  assert.ok(!fs.existsSync(path.join(dir, 'ggml-tiny.bin')));
  assert.throws(() => store.info('nope'), /Unknown model/);
});

test('recommended model: compact Large v3 Turbo on Apple Silicon, Small on Intel or < 8 GB', () => {
  assert.strictEqual(recommendedModelId(16 * 1024 ** 3, 'arm64'), 'large-v3-turbo-q5_0');
  assert.strictEqual(recommendedModelId(16 * 1024 ** 3, 'x64'), 'small');
  assert.strictEqual(recommendedModelId(4 * 1024 ** 3, 'arm64'), 'small');
});
