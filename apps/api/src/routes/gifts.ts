/**
 * GiftBox: a tag that opens a page of photos, each with a caption beside it
 * and a note + date on its back. Reading happens through the normal tap
 * (GET /api/tags/:tag_id returns `gift` to everyone). These routes are the
 * writes, and all but setup and invite redemption need an editor's token.
 *
 *   POST   /api/gifts                              set up an unclaimed gift tag -> first editor secret
 *   PATCH  /api/gifts/:tag_id                      change the title
 *   POST   /api/gifts/:tag_id/photos               add a photo (multipart: image, caption, note, taken_at)
 *   PATCH  /api/gifts/:tag_id/photos/:photo_id     change caption / note / taken_at
 *   DELETE /api/gifts/:tag_id/photos/:photo_id     remove a photo
 *   POST   /api/gifts/:tag_id/invites              mint a one-time link that lets another device edit
 *   POST   /api/gifts/:tag_id/editors              redeem an invite code -> that device's own secret
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { AppDeps } from '../createApp.js';
import type { Repo } from '../db/repo.js';
import { ApiError, badRequest, conflict, notFound, unauthorized } from '../errors.js';
import type { Item, Tag } from '../models/types.js';
import { bearerToken, canEditTag, mintInviteCode, mintOwnerSecret, newId, sha256Hex } from '../services/auth.js';
import { giftPhotoKey, isSupportedImage } from '../services/mediaStore.js';
import { publicItem } from './serialize.js';

const MAX_TITLE = 120;
const MAX_CAPTION = 500;
const MAX_NOTE = 2000;
const MAX_PHOTOS = 60;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-31). */
function isCalendarDate(v: string): boolean {
  if (!new RegExp(DATE_PATTERN).test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Mints a one-time invite. The code rides in the URL fragment, which browsers
 * never send to a server, so it stays out of access logs.
 */
export async function createInvite(repo: Repo, config: Config, tagId: string, label: string | null) {
  const code = mintInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await repo.createEditorInvite({ id: newId('inv'), tagId, codeHash: code.hash, label, expiresAt });
  return { invite_code: code.raw, expires_at: expiresAt, url: `${config.publicWebUrl}/t/${tagId}#invite=${code.raw}` };
}

const titleSchema = { type: 'string', minLength: 1, maxLength: MAX_TITLE, pattern: '\\S' };

const createSchema = {
  body: {
    type: 'object',
    required: ['tag_id', 'title'],
    properties: { tag_id: { type: 'string', minLength: 1, maxLength: 32 }, title: titleSchema },
  },
};

const patchGiftSchema = {
  body: { type: 'object', required: ['title'], properties: { title: titleSchema } },
};

const patchPhotoSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    properties: {
      caption: { type: 'string', maxLength: MAX_CAPTION },
      note: { type: 'string', maxLength: MAX_NOTE },
      taken_at: { anyOf: [{ type: 'null' }, { type: 'string', pattern: DATE_PATTERN }] },
    },
  },
};

const inviteSchema = {
  body: { type: 'object', properties: { label: { type: 'string', maxLength: 60 } } },
};

const redeemSchema = {
  body: {
    type: 'object',
    required: ['invite_code'],
    properties: { invite_code: { type: 'string', minLength: 8, maxLength: 64 } },
  },
};

export async function giftRoutes(app: FastifyInstance, { repo, media, config }: AppDeps) {
  /** The tag, if it is a gift that has been set up. */
  const giftTag = async (tagId: string): Promise<Tag & { item_id: string }> => {
    const tag = await repo.getTag(tagId);
    if (!tag || tag.kind !== 'gift' || tag.status === 'unclaimed' || !tag.item_id) throw notFound('GIFT_NOT_FOUND', 'Gift not found');
    return tag as Tag & { item_id: string };
  };

  /** Every write goes through this. Hiding the Edit button in the UI is not the gate; this is. */
  const editableGift = async (req: FastifyRequest<{ Params: { tag_id: string } }>) => {
    const tag = await giftTag(req.params.tag_id);
    if (!(await canEditTag(repo, tag, bearerToken(req.headers.authorization)))) throw unauthorized('Missing or invalid editor token');
    return tag;
  };

  app.post<{ Body: { tag_id: string; title: string } }>('/api/gifts', { schema: createSchema }, async (req, reply) => {
    const tag = await repo.getTag(req.body.tag_id);
    if (!tag) throw notFound('TAG_NOT_FOUND', 'Tag not found');
    if (tag.status !== 'unclaimed') throw conflict('TAG_ALREADY_CLAIMED', 'Tag is already claimed');
    if (tag.kind !== 'gift') throw conflict('WRONG_KIND', `This tag is set up for "${tag.kind}", not "gift"`);

    const ts = new Date().toISOString();
    const item: Item = {
      id: newId('item'),
      tenant_id: tag.tenant_id,
      kind: 'gift',
      title: req.body.title.trim(),
      artist: null,
      year: null,
      image_url: null,
      context: { summary: '' },
      raw_recognition_data: {},
      created_at: ts,
      updated_at: ts,
    };
    const secret = mintOwnerSecret();
    if (!(await repo.claimGiftTag({ tagId: tag.id, ownerTokenHash: secret.hash, item }))) {
      throw conflict('TAG_ALREADY_CLAIMED', 'Tag was claimed by another device during setup');
    }

    reply.code(201);
    return {
      tag_id: tag.id,
      raw_owner_secret: secret.raw,
      item: publicItem(item),
      gift: { title: item.title, photos: [], updated_at: ts },
    };
  });

  app.patch<{ Params: { tag_id: string }; Body: { title: string } }>(
    '/api/gifts/:tag_id',
    { schema: patchGiftSchema },
    async (req) => {
      const tag = await editableGift(req);
      const title = req.body.title.trim();
      return { title, updated_at: await repo.updateItemTitle(tag.item_id, title) };
    },
  );

  app.post<{ Params: { tag_id: string } }>('/api/gifts/:tag_id/photos', async (req, reply) => {
    const tag = await editableGift(req);
    if (!media.stores) {
      throw new ApiError(503, 'MEDIA_STORAGE_OFF', 'Image storage is not configured on this server, so photos cannot be added yet');
    }
    if (!req.isMultipart()) throw badRequest('EXPECTED_MULTIPART', 'Send multipart/form-data with an image');

    const fields: Record<string, string> = {};
    let image: { mime: string; bytes: Buffer } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'image') {
          await part.toBuffer();
          continue;
        }
        if (!isSupportedImage(part.mimetype)) {
          await part.toBuffer();
          throw badRequest('UNSUPPORTED_IMAGE', `Unsupported image type: ${part.mimetype}`);
        }
        image = { mime: part.mimetype, bytes: await part.toBuffer() };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }

    if (!image || image.bytes.length === 0) throw badRequest('MISSING_IMAGE', 'image is required');
    const caption = fields.caption ?? '';
    const note = fields.note ?? '';
    const takenAt = fields.taken_at?.trim() || null;
    if (caption.length > MAX_CAPTION) throw badRequest('FIELD_TOO_LONG', `caption exceeds ${MAX_CAPTION} characters`);
    if (note.length > MAX_NOTE) throw badRequest('FIELD_TOO_LONG', `note exceeds ${MAX_NOTE} characters`);
    if (takenAt && !isCalendarDate(takenAt)) throw badRequest('BAD_DATE', 'taken_at must be a date like 2026-02-14');
    if ((await repo.countGiftPhotos(tag.item_id)) >= MAX_PHOTOS) {
      throw conflict('TOO_MANY_PHOTOS', `A gift holds at most ${MAX_PHOTOS} photos`);
    }

    const id = newId('photo');
    const key = giftPhotoKey(tag.tenant_id, tag.item_id, id, image.mime);
    await media.put(key, image.mime, image.bytes);
    try {
      const photo = await repo.addGiftPhoto({
        id,
        itemId: tag.item_id,
        tenantId: tag.tenant_id,
        imageKey: key,
        imageUrl: media.publicUrl(key),
        caption,
        note,
        takenAt,
      });
      reply.code(201);
      return photo;
    } catch (err) {
      await media.remove(key).catch(() => {}); // don't leave a file with no row
      throw err;
    }
  });

  app.patch<{
    Params: { tag_id: string; photo_id: string };
    Body: { caption?: string; note?: string; taken_at?: string | null };
  }>('/api/gifts/:tag_id/photos/:photo_id', { schema: patchPhotoSchema }, async (req) => {
    const tag = await editableGift(req);
    if (req.body.taken_at && !isCalendarDate(req.body.taken_at)) throw badRequest('BAD_DATE', 'taken_at must be a date like 2026-02-14');
    const photo = await repo.updateGiftPhoto(tag.item_id, req.params.photo_id, req.body);
    if (!photo) throw notFound('PHOTO_NOT_FOUND', 'Photo not found');
    return photo;
  });

  app.delete<{ Params: { tag_id: string; photo_id: string } }>('/api/gifts/:tag_id/photos/:photo_id', async (req, reply) => {
    const tag = await editableGift(req);
    const key = await repo.deleteGiftPhoto(tag.item_id, req.params.photo_id);
    if (!key) throw notFound('PHOTO_NOT_FOUND', 'Photo not found');
    await media.remove(key).catch(() => {});
    reply.code(204);
  });

  app.post<{ Params: { tag_id: string }; Body: { label?: string } | undefined }>(
    '/api/gifts/:tag_id/invites',
    { schema: inviteSchema },
    async (req, reply) => {
      const tag = await editableGift(req);
      reply.code(201);
      return createInvite(repo, config, tag.id, req.body?.label?.trim() || null);
    },
  );

  // No token needed: the invite code is the credential. It works once.
  app.post<{ Params: { tag_id: string }; Body: { invite_code: string } }>(
    '/api/gifts/:tag_id/editors',
    { schema: redeemSchema },
    async (req, reply) => {
      const tag = await giftTag(req.params.tag_id);
      const secret = mintOwnerSecret();
      const ok = await repo.redeemEditorInvite({
        tagId: tag.id,
        codeHash: sha256Hex(req.body.invite_code),
        editorId: newId('editor'),
        tokenHash: secret.hash,
      });
      if (!ok) throw new ApiError(410, 'INVITE_INVALID', 'This invite link was already used or has expired');
      reply.code(201);
      return { tag_id: tag.id, raw_owner_secret: secret.raw };
    },
  );
}
