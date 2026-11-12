/**
 * POST /api/items/onboard      — Flow A, multipart upload (tag_id, image, overrides)
 * GET  /api/items/:item_id     — public item view (guest exhibition)
 * GET  /api/items/:item_id/entry — private entry, owner token required
 */

import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { ITEM_KINDS, type ItemKind } from '../models/types.js';
import { bearerToken, isOwner } from '../services/auth.js';
import { isSupportedImage } from '../services/mediaStore.js';
import { onboardItem } from '../services/onboarding/index.js';
import type { AppDeps } from '../createApp.js';
import { publicItem } from './serialize.js';

const MAX_TEXT_FIELD = 255;

export async function itemRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;

  app.post('/api/items/onboard', async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('EXPECTED_MULTIPART', 'Send multipart/form-data with tag_id and image');

    const fields: Record<string, string> = {};
    let image: { mime: string; bytes: Buffer } | undefined;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'image') {
          await part.toBuffer(); // drain unknown files
          continue;
        }
        if (!isSupportedImage(part.mimetype)) {
          await part.toBuffer();
          throw badRequest('UNSUPPORTED_IMAGE', `Unsupported image type: ${part.mimetype}`);
        }
        image = { mime: part.mimetype, bytes: await part.toBuffer() };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value.trim();
      }
    }

    const tagId = fields.tag_id;
    if (!tagId) throw badRequest('MISSING_TAG_ID', 'tag_id is required');
    if (!image || image.bytes.length === 0) throw badRequest('MISSING_IMAGE', 'image is required');

    const kind = (fields.kind || 'artwork') as ItemKind;
    if (!ITEM_KINDS.includes(kind)) throw badRequest('UNSUPPORTED_KIND', `kind must be one of: ${ITEM_KINDS.join(', ')}`);

    for (const f of ['title_override', 'artist_override']) {
      if (fields[f] && fields[f].length > MAX_TEXT_FIELD) throw badRequest('FIELD_TOO_LONG', `${f} exceeds ${MAX_TEXT_FIELD} characters`);
    }

    const result = await onboardItem(
      { ...deps, onboarders: deps.onboardersFor(req) },
      {
        tagId,
        kind,
        image,
        titleOverride: fields.title_override || undefined,
        artistOverride: fields.artist_override || undefined,
      },
    );

    reply.code(201);
    return {
      tag_id: tagId,
      raw_owner_secret: result.rawOwnerSecret,
      item: publicItem(result.item),
      entry: result.entry,
      run_id: result.runId,
    };
  });

  app.get<{ Params: { item_id: string } }>('/api/items/:item_id', async (req) => {
    const item = await repo.getItem(req.params.item_id);
    if (!item) throw notFound('ITEM_NOT_FOUND', 'Item not found');
    return publicItem(item);
  });

  app.get<{ Params: { item_id: string } }>('/api/items/:item_id/entry', async (req) => {
    const found = await repo.getEntryWithOwner({ itemId: req.params.item_id });
    // Same 401 whether the item is missing or the token is wrong, so guests can't probe ids.
    if (!found || !isOwner(found.ownerTokenHash, bearerToken(req.headers.authorization))) throw unauthorized();
    return found.entry;
  });
}
