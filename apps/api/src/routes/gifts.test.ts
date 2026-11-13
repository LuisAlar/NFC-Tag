/**
 * GiftBox over HTTP (app.inject, in-memory Postgres):
 *   setup -> everyone reads, only editors write -> second device joins by invite
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../createApp.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { Repo } from '../db/repo.js';
import { pgliteSql } from '../db/sql.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(fields: Record<string, string>, file?: { mime: string; bytes: Buffer }) {
  const boundary = '----gifttest' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo"\r\nContent-Type: ${file.mime}\r\n\r\n`),
      file.bytes,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

let app: FastifyInstance;
let noMediaApp: FastifyInstance;
let repo: Repo;
let mediaDir: string;

const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

const setup = (tagId: string, title = 'Luis & Ana') =>
  app.inject({ method: 'POST', url: '/api/gifts', payload: { tag_id: tagId, title } });

const addPhoto = (tagId: string, secret: string | null, fields: Record<string, string> = {}, mime = 'image/png', target = app) => {
  const mp = multipart(fields, { mime, bytes: PNG });
  return target.inject({
    method: 'POST',
    url: `/api/gifts/${tagId}/photos`,
    payload: mp.payload,
    headers: { ...mp.headers, ...(secret ? auth(secret) : {}) },
  });
};

before(async () => {
  mediaDir = mkdtempSync(join(tmpdir(), 'nfc-gift-'));
  const config = loadConfig({ databaseUrl: null, mediaDriver: 'disk', mediaDir, adminToken: 'test-admin', publicWebUrl: 'https://web.test' });
  const sql = await pgliteSql();
  await migrate(sql);
  repo = new Repo(sql);
  await repo.ensureTenant({ id: 'tenant_01', name: 'Test', slug: 'tenant_01' });
  for (const id of ['gift_a', 'gift_b', 'gift_race', 'gift_fresh']) await repo.createTag(id, 'tenant_01', 'gift');
  await repo.createTag('art_a', 'tenant_01');
  app = await buildApp(config, repo);
  noMediaApp = await buildApp({ ...config, mediaDriver: 'none' }, repo);
});

after(async () => {
  await app.close();
  await noMediaApp.close();
  await repo.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

describe('gift setup', () => {
  test('an unclaimed gift tag says it is a gift', async () => {
    const body = (await app.inject('/api/tags/gift_fresh')).json();
    assert.equal(body.status, 'unclaimed');
    assert.equal(body.kind, 'gift');
  });

  test('setup claims the tag and returns the secret once', async () => {
    const res = await setup('gift_a');
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.match(body.raw_owner_secret, /^[0-9a-f]{64}$/);
    assert.equal(body.item.kind, 'gift');
    assert.deepEqual(body.gift.photos, []);
    assert.equal((await setup('gift_a')).statusCode, 409);
  });

  test('an artwork tag cannot be set up as a gift, nor a gift tag as artwork', async () => {
    const res = await setup('art_a');
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'WRONG_KIND');

    const mp = multipart({ tag_id: 'gift_fresh' }, { mime: 'image/png', bytes: PNG });
    const onboard = await app.inject({ method: 'POST', url: '/api/items/onboard', payload: mp.payload, headers: mp.headers });
    assert.equal(onboard.statusCode, 409);
    assert.equal(onboard.json().code, 'WRONG_KIND');
  });

  test('blank title and unknown tag are rejected', async () => {
    assert.equal((await setup('gift_fresh', '   ')).statusCode, 400);
    assert.equal((await setup('nope')).statusCode, 404);
  });

  test('two simultaneous setups: exactly one wins', async () => {
    const codes = (await Promise.all([setup('gift_race'), setup('gift_race')])).map((r) => r.statusCode).sort();
    assert.deepEqual(codes, [201, 409]);
  });
});

describe('gift content', () => {
  let secret: string;
  let otherSecret: string;
  let photoId: string;

  before(async () => {
    secret = (await setup('gift_b')).json().raw_owner_secret;
    otherSecret = (await app.inject({ method: 'POST', url: '/api/gifts', payload: { tag_id: 'gift_fresh', title: 'Other' } })).json()
      .raw_owner_secret;
  });

  test('editor adds a photo; the file is served', async () => {
    const res = await addPhoto('gift_b', secret, { caption: 'First trip', note: 'It rained all day.', taken_at: '2026-02-14' });
    assert.equal(res.statusCode, 201);
    const photo = res.json();
    photoId = photo.id;
    assert.equal(photo.caption, 'First trip');
    assert.equal(photo.taken_at, '2026-02-14');
    assert.equal(photo.position, 1);
    const img = await app.inject(photo.image_url);
    assert.equal(img.statusCode, 200);
    assert.deepEqual(img.rawPayload, PNG);
  });

  test('photos keep the order they were added', async () => {
    const second = (await addPhoto('gift_b', secret, { caption: 'Second' })).json();
    assert.equal(second.position, 2);
    assert.equal(second.taken_at, null);
  });

  test('everyone who taps sees the gift; only the editor can edit', async () => {
    const guest = (await app.inject('/api/tags/gift_b')).json();
    assert.equal(guest.role, 'guest');
    assert.equal(guest.can_edit, false);
    assert.equal(guest.gift.title, 'Luis & Ana');
    assert.deepEqual(guest.gift.photos.map((p: { caption: string }) => p.caption), ['First trip', 'Second']);
    assert.equal(guest.gift.photos[0].note, 'It rained all day.');
    assert.equal('entry' in guest, false);

    const editor = (await app.inject({ url: '/api/tags/gift_b', headers: auth(secret) })).json();
    assert.equal(editor.role, 'owner');
    assert.equal(editor.can_edit, true);
    assert.equal(editor.gift.photos.length, 2);
  });

  test('writes without a token, with a wrong one, or with another gift\'s are 401', async () => {
    for (const s of [null, 'f'.repeat(64), otherSecret]) {
      const headers = s ? auth(s) : {};
      assert.equal((await addPhoto('gift_b', s)).statusCode, 401);
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/gifts/gift_b', payload: { title: 'x' }, headers })).statusCode, 401);
      assert.equal(
        (await app.inject({ method: 'PATCH', url: `/api/gifts/gift_b/photos/${photoId}`, payload: { caption: 'x' }, headers })).statusCode,
        401,
      );
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/gifts/gift_b/photos/${photoId}`, headers })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: '/api/gifts/gift_b/invites', payload: {}, headers })).statusCode, 401);
    }
    assert.equal((await app.inject('/api/tags/gift_b')).json().gift.photos[0].caption, 'First trip');
  });

  test("an editor can't reach another gift's photo through their own gift", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/gifts/gift_fresh/photos/${photoId}`,
      payload: { caption: 'hijacked' },
      headers: auth(otherSecret),
    });
    assert.equal(res.statusCode, 404);
  });

  test('editor changes caption, note, date and title', async () => {
    const url = `/api/gifts/gift_b/photos/${photoId}`;
    const patched = await app.inject({ method: 'PATCH', url, payload: { caption: 'Renamed' }, headers: auth(secret) });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().caption, 'Renamed');
    assert.equal(patched.json().note, 'It rained all day.'); // untouched fields stay
    assert.equal(patched.json().taken_at, '2026-02-14');

    const cleared = await app.inject({ method: 'PATCH', url, payload: { taken_at: null, note: '' }, headers: auth(secret) });
    assert.equal(cleared.json().taken_at, null);
    assert.equal(cleared.json().note, '');

    const title = await app.inject({ method: 'PATCH', url: '/api/gifts/gift_b', payload: { title: ' Ana & Luis ' }, headers: auth(secret) });
    assert.equal(title.json().title, 'Ana & Luis');
    assert.equal((await app.inject('/api/tags/gift_b')).json().gift.title, 'Ana & Luis');
  });

  test('bad dates, bad file types and empty patches are 400', async () => {
    const url = `/api/gifts/gift_b/photos/${photoId}`;
    assert.equal((await app.inject({ method: 'PATCH', url, payload: { taken_at: '2026-02-31' }, headers: auth(secret) })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url, payload: { taken_at: 'yesterday' }, headers: auth(secret) })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url, payload: {}, headers: auth(secret) })).statusCode, 400);
    assert.equal((await addPhoto('gift_b', secret, { taken_at: '14/02/2026' })).statusCode, 400);
    assert.equal((await addPhoto('gift_b', secret, {}, 'application/pdf')).statusCode, 400);
  });

  test('editors reorder photos with the full list; partial lists, strangers and other gifts are refused', async () => {
    const extra = (await addPhoto('gift_b', secret, { caption: 'Reorder me' })).json();
    const ids = (await app.inject('/api/tags/gift_b')).json().gift.photos.map((p: { id: string }) => p.id);
    assert.ok(ids.length >= 2);
    const reversed = [...ids].reverse();
    const url = '/api/gifts/gift_b/photos/order';

    const res = await app.inject({ method: 'PUT', url, payload: { photo_ids: reversed }, headers: auth(secret) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().photos.map((p: { id: string }) => p.id), reversed);
    const after = (await app.inject('/api/tags/gift_b')).json().gift.photos.map((p: { id: string }) => p.id);
    assert.deepEqual(after, reversed);

    // A photo added after a reorder still goes last.
    const last = (await addPhoto('gift_b', secret, { caption: 'Newest' })).json();
    const withNew = (await app.inject('/api/tags/gift_b')).json().gift.photos.map((p: { id: string }) => p.id);
    assert.equal(withNew.at(-1), last.id);

    assert.equal((await app.inject({ method: 'PUT', url, payload: { photo_ids: reversed }, headers: auth(secret) })).statusCode, 409);
    assert.equal((await app.inject({ method: 'PUT', url, payload: { photo_ids: [...withNew, withNew[0]] }, headers: auth(secret) })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url, payload: { photo_ids: withNew } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'PUT', url, payload: { photo_ids: withNew }, headers: auth(otherSecret) })).statusCode, 401);

    for (const p of [extra, last]) await app.inject({ method: 'DELETE', url: `/api/gifts/gift_b/photos/${p.id}`, headers: auth(secret) });
  });

  test('deleting a photo removes the row and the file', async () => {
    const photo = (await addPhoto('gift_b', secret, { caption: 'Temp' })).json();
    const path = join(mediaDir, photo.image_url.replace('/media/', ''));
    assert.equal(existsSync(path), true);
    const url = `/api/gifts/gift_b/photos/${photo.id}`;
    assert.equal((await app.inject({ method: 'DELETE', url, headers: auth(secret) })).statusCode, 204);
    assert.equal(existsSync(path), false);
    assert.equal((await app.inject({ method: 'DELETE', url, headers: auth(secret) })).statusCode, 404);
  });

  test('without image storage, adding a photo fails clearly instead of saving a blank', async () => {
    const res = await addPhoto('gift_b', secret, {}, 'image/png', noMediaApp);
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'MEDIA_STORAGE_OFF');
  });

  test('a second device joins with a one-time invite and gets its own secret', async () => {
    const invite = await app.inject({ method: 'POST', url: '/api/gifts/gift_b/invites', payload: { label: 'her phone' }, headers: auth(secret) });
    assert.equal(invite.statusCode, 201);
    const { invite_code, url } = invite.json();
    assert.equal(url, `https://web.test/t/gift_b#invite=${invite_code}`);

    // The code only opens the gift it was made for.
    const wrongGift = await app.inject({ method: 'POST', url: '/api/gifts/gift_fresh/editors', payload: { invite_code } });
    assert.equal(wrongGift.statusCode, 410);

    const redeem = await app.inject({ method: 'POST', url: '/api/gifts/gift_b/editors', payload: { invite_code } });
    assert.equal(redeem.statusCode, 201);
    const second = redeem.json().raw_owner_secret;
    assert.notEqual(second, secret);

    assert.equal((await app.inject({ url: '/api/tags/gift_b', headers: auth(second) })).json().can_edit, true);
    assert.equal((await addPhoto('gift_b', second, { caption: 'From her phone' })).statusCode, 201);
    // The first device still works, and the second can't edit other gifts.
    assert.equal((await app.inject({ url: '/api/tags/gift_b', headers: auth(secret) })).json().can_edit, true);
    assert.equal((await app.inject({ url: '/api/tags/gift_fresh', headers: auth(second) })).json().can_edit, false);

    const again = await app.inject({ method: 'POST', url: '/api/gifts/gift_b/editors', payload: { invite_code } });
    assert.equal(again.statusCode, 410);
    assert.equal(again.json().code, 'INVITE_INVALID');
  });

  test('an expired invite does not work', async () => {
    const { invite_code } = (await app.inject({ method: 'POST', url: '/api/gifts/gift_b/invites', payload: {}, headers: auth(secret) })).json();
    await repo.sql.query(`UPDATE editor_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE used_at IS NULL`);
    const res = await app.inject({ method: 'POST', url: '/api/gifts/gift_b/editors', payload: { invite_code } });
    assert.equal(res.statusCode, 410);
  });

  test('admin can mint a recovery invite for a claimed gift only', async () => {
    const admin = { 'x-admin-token': 'test-admin' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/tags/gift_b/invites' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/tags/art_a/invites', headers: admin })).statusCode, 409);
    const res = await app.inject({ method: 'POST', url: '/api/admin/tags/gift_b/invites', headers: admin });
    assert.equal(res.statusCode, 201);
    const redeem = await app.inject({ method: 'POST', url: '/api/gifts/gift_b/editors', payload: { invite_code: res.json().invite_code } });
    assert.equal(redeem.statusCode, 201);
  });

  test('admin provisions gift tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tags',
      payload: { ids: ['gift_minted'], kind: 'gift' },
      headers: { 'x-admin-token': 'test-admin' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().tags[0].kind, 'gift');
    assert.equal((await app.inject('/api/tags/gift_minted')).json().kind, 'gift');
  });
});
