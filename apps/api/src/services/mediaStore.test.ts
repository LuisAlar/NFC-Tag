import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadConfig } from '../config.js';
import { blobMediaStore, diskMediaStore, noMediaStore } from './mediaStore.js';

const dir = mkdtempSync(join(tmpdir(), 'media-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Runs fn with these env vars set (undefined = unset), then restores them. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test('disk put returns the URL the API serves the file at', async () => {
  const store = diskMediaStore(dir);
  const url = await store.put('a/b.jpg', 'image/jpeg', Buffer.from('x'));
  assert.equal(url, '/media/a/b.jpg');
  assert.equal(existsSync(join(dir, 'a/b.jpg')), true);
  await store.remove('a/b.jpg');
  assert.equal(existsSync(join(dir, 'a/b.jpg')), false);
});

test('none stores nothing', async () => {
  const store = noMediaStore();
  assert.equal(store.stores, false);
  assert.equal(await store.put('k', 'image/jpeg', Buffer.from('x')), '');
});

test('blob refuses to start without a token', () => {
  assert.throws(() => blobMediaStore(''), /BLOB_READ_WRITE_TOKEN/);
  assert.equal(blobMediaStore('vercel_blob_rw_test').driver, 'blob');
});

test('on Vercel, a connected Blob store picks the blob driver; MEDIA_DRIVER still wins', () => {
  withEnv({ VERCEL: '1', MEDIA_DRIVER: undefined, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test' }, () =>
    assert.equal(loadConfig().mediaDriver, 'blob'),
  );
  withEnv({ VERCEL: '1', MEDIA_DRIVER: undefined, BLOB_READ_WRITE_TOKEN: undefined }, () =>
    assert.equal(loadConfig().mediaDriver, 'none'),
  );
  withEnv({ VERCEL: '1', MEDIA_DRIVER: 'none', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test' }, () =>
    assert.equal(loadConfig().mediaDriver, 'none'),
  );
  withEnv({ VERCEL: undefined, MEDIA_DRIVER: undefined, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test' }, () =>
    assert.equal(loadConfig().mediaDriver, 'disk'),
  );
});
