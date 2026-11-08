/**
 * End-to-end tests for the three tap flows over HTTP (app.inject, no network):
 *   A  unclaimed tag -> onboard -> owner secret
 *   B1 owner token -> owner view, read + auto-save entry
 *   B2 no/wrong token -> guest view, entry locked
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../createApp.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { Repo } from '../db/repo.js';
import { pgliteSql } from '../db/sql.js';
import { memorySink } from '../services/runlog/index.js';
import { pgSink } from '../services/runlog/pgSink.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(fields: Record<string, string>, file?: { name: string; mime: string; bytes: Buffer }) {
  const boundary = '----nfctest' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="photo"\r\nContent-Type: ${file.mime}\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

let app: FastifyInstance;
let repo: Repo;
let mediaDir: string;
const sink = memorySink();

before(async () => {
  mediaDir = mkdtempSync(join(tmpdir(), 'nfc-media-'));
  const config = loadConfig({ databaseUrl: null, mediaDriver: 'disk', mediaDir, adminToken: 'test-admin' });
  const sql = await pgliteSql(); // in-memory Postgres
  await migrate(sql);
  repo = new Repo(sql);
  await repo.ensureTenant({ id: 'tenant_01', name: 'Test', slug: 'tenant_01' });
  for (const id of ['tag_a', 'tag_b', 'tag_race', 'tag_thrift', 'tag_nomedia']) await repo.createTag(id, 'tenant_01');
  app = await buildApp(config, repo, { runSinks: [sink, pgSink(repo)] });
});

after(async () => {
  await app.close();
  await repo.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

const onboard = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const mp = multipart(fields, { name: 'image', mime: 'image/png', bytes: PNG });
  return app.inject({ method: 'POST', url: '/api/items/onboard', payload: mp.payload, headers: { ...mp.headers, ...headers } });
};

describe('tag resolution', () => {
  test('unknown tag is 404', async () => {
    const res = await app.inject('/api/tags/nope');
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, 'TAG_NOT_FOUND');
  });

  test('unclaimed tag routes to onboarding', async () => {
    const res = await app.inject('/api/tags/tag_a');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { tag_id: 'tag_a', tenant_id: 'tenant_01', status: 'unclaimed', action: 'onboard' });
  });
});

describe('flows A, B1, B2', () => {
  let secret: string;
  let itemId: string;
  let entryId: string;

  test('A: onboarding claims the tag and returns a secret once', async () => {
    const res = await onboard({ tag_id: 'tag_a' });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json();
    assert.match(body.raw_owner_secret, /^[0-9a-f]{64}$/);
    assert.equal(body.item.kind, 'artwork');
    assert.equal(body.item.title, 'The Gleaners');
    assert.ok(body.item.context.summary.length > 0);
    assert.ok(body.entry.prompts.length > 0);
    assert.equal(body.item.raw_recognition_data, undefined, 'internal data must not leak');
    assert.match(body.item.image_url, /^\/media\/tenants\/tenant_01\/items\/item_[0-9a-f]+\/original\.png$/);
    secret = body.raw_owner_secret;
    itemId = body.item.id;
    entryId = body.entry.id;

    // Only the hash is stored, and the run is linked from the item.
    const tag = (await repo.getTag('tag_a'))!;
    assert.equal(tag.status, 'active');
    assert.notEqual(tag.owner_token_hash, secret);
    assert.equal((await repo.getItem(itemId))!.raw_recognition_data.run_id, body.run_id);
    assert.ok(sink.runs.some((r) => r.runId === body.run_id));

    // The run log row exists in Postgres and links back to the item.
    const { rows } = await repo.sql.query<{ item_id: string; status: string }>('SELECT item_id, status FROM pipeline_runs WHERE id = $1', [body.run_id]);
    assert.equal(rows[0]?.item_id, itemId);
    assert.equal(rows[0]?.status, 'succeeded'); // Vision recognizes it, so no fallback rung ran
  });

  test('A: the uploaded image is served', async () => {
    const item = (await app.inject(`/api/items/${itemId}`)).json();
    const img = await app.inject(item.image_url);
    assert.equal(img.statusCode, 200);
    assert.deepEqual(img.rawPayload, PNG);
  });

  test('A: a claimed tag cannot be onboarded again', async () => {
    const res = await onboard({ tag_id: 'tag_a' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'TAG_ALREADY_CLAIMED');
  });

  test('B1: owner token gets the owner view with the entry', async () => {
    const res = await app.inject({ url: '/api/tags/tag_a', headers: { authorization: `Bearer ${secret}` } });
    const body = res.json();
    assert.equal(body.status, 'claimed');
    assert.equal(body.role, 'owner');
    assert.equal(body.can_edit, true);
    assert.equal(body.entry.id, entryId);
  });

  test('B1: owner reads and auto-saves the entry', async () => {
    const auth = { authorization: `Bearer ${secret}` };
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Found it behind a lamp.' }] }] };

    const save = await app.inject({ method: 'PATCH', url: `/api/entries/${entryId}`, headers: auth, payload: { content, prompts: ['Only one left'] } });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal(save.json().status, 'saved');

    const read = await app.inject({ url: `/api/items/${itemId}/entry`, headers: auth });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().content, content);
    assert.deepEqual(read.json().prompts, ['Only one left']);
  });

  test('B1: malformed entry body is rejected', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/entries/${entryId}`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { content: { type: 'not-a-doc' } },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'VALIDATION_ERROR');
  });

  test('B2: no token or wrong token gets the guest view without the entry', async () => {
    for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
      const body = (await app.inject({ url: '/api/tags/tag_a', headers })).json();
      assert.equal(body.role, 'guest');
      assert.equal(body.can_edit, false);
      assert.equal(body.entry, undefined);
      assert.equal(body.item.id, itemId);
    }
  });

  test('B2: guests cannot read or write the entry', async () => {
    const read = await app.inject({ url: `/api/items/${itemId}/entry`, headers: { authorization: 'Bearer wrong' } });
    assert.equal(read.statusCode, 401);
    const write = await app.inject({ method: 'PATCH', url: `/api/entries/${entryId}`, payload: { content: { type: 'doc', content: [] } } });
    assert.equal(write.statusCode, 401);
  });

  test("an owner token for one tag doesn't open another tag's entry", async () => {
    const other = (await onboard({ tag_id: 'tag_b', title_override: 'River at Dusk' })).json();
    const res = await app.inject({ url: `/api/items/${other.item.id}/entry`, headers: { authorization: `Bearer ${secret}` } });
    assert.equal(res.statusCode, 401);
  });
});

describe('onboarding edge cases', () => {
  test('manual overrides win and unrecognized work gets generic prompts', async () => {
    const res = await onboard({ tag_id: 'tag_thrift', title_override: 'Pier at Noon', artist_override: 'M. Ito' }, { 'x-fake-scenario': 'thrift' });
    assert.equal(res.statusCode, 201, res.body);
    const { item, entry } = res.json();
    assert.equal(item.title, 'Pier at Noon');
    assert.equal(item.artist, 'M. Ito');
    assert.ok(entry.prompts.length >= 2);
  });

  test('missing image, missing tag id, bad kind and bad file type are 400', async () => {
    const noImage = multipart({ tag_id: 'tag_race' });
    assert.equal((await app.inject({ method: 'POST', url: '/api/items/onboard', ...noImage })).json().code, 'MISSING_IMAGE');
    assert.equal((await onboard({})).json().code, 'MISSING_TAG_ID');
    assert.equal((await onboard({ tag_id: 'tag_race', kind: 'spaceship' })).json().code, 'UNSUPPORTED_KIND');
    const txt = multipart({ tag_id: 'tag_race' }, { name: 'image', mime: 'text/plain', bytes: Buffer.from('hi') });
    assert.equal((await app.inject({ method: 'POST', url: '/api/items/onboard', ...txt })).json().code, 'UNSUPPORTED_IMAGE');
  });

  test('two simultaneous onboardings of one tag: exactly one wins', async () => {
    const results = await Promise.all([onboard({ tag_id: 'tag_race' }), onboard({ tag_id: 'tag_race' })]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    // The loser wrote nothing: exactly one item points at the tag.
    const { rows } = await repo.sql.query('SELECT i.id FROM items i JOIN tags t ON t.item_id = i.id WHERE t.id = $1', ['tag_race']);
    assert.equal(rows.length, 1);
  });

  test("without image storage (Vercel default) onboarding still works and image_url is null", async () => {
    const config = loadConfig({ databaseUrl: null, mediaDriver: 'none', adminToken: 'test-admin' });
    const noMedia = await buildApp(config, repo);
    try {
      const mp = multipart({ tag_id: 'tag_nomedia' }, { name: 'image', mime: 'image/png', bytes: PNG });
      const res = await noMedia.inject({ method: 'POST', url: '/api/items/onboard', ...mp });
      assert.equal(res.statusCode, 201, res.body);
      assert.equal(res.json().item.image_url, null);
      assert.equal((await noMedia.inject('/media/anything')).statusCode, 404);
    } finally {
      await noMedia.close();
    }
  });
});

describe('admin provisioning', () => {
  test('requires the admin token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/tags', payload: {} });
    assert.equal(res.statusCode, 403);
  });

  test('mints unclaimed tags with tap URLs', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/tags', headers: { 'x-admin-token': 'test-admin' }, payload: { count: 3 } });
    assert.equal(res.statusCode, 201);
    const { tags } = res.json();
    assert.equal(tags.length, 3);
    for (const t of tags) {
      assert.match(t.tag_id, /^[A-Za-z0-9_-]{10}$/);
      assert.ok(t.tap_url.endsWith(`/t/${t.tag_id}`));
      assert.equal((await app.inject(`/api/tags/${t.tag_id}`)).json().status, 'unclaimed');
    }
  });
});
