/**
 * GET /api/tags/:tag_id — the tap dispatcher (docs/processes.md, Process 2).
 *
 *   unclaimed                 -> { status: 'unclaimed', action: 'onboard' }  (Flow A)
 *   claimed + owner token     -> { status: 'claimed', role: 'owner', item, entry }  (Flow B1)
 *   claimed, no/wrong token   -> { status: 'claimed', role: 'guest', item }  (Flow B2)
 *
 * A gift (item.kind 'gift') also carries `gift: { title, photos }` for both roles.
 */

import type { FastifyInstance } from 'fastify';
import { ApiError, notFound } from '../errors.js';
import { bearerToken, canEditTag } from '../services/auth.js';
import type { AppDeps } from '../createApp.js';
import { publicItem } from './serialize.js';

export async function tagRoutes(app: FastifyInstance, { repo }: AppDeps) {
  app.get<{ Params: { tag_id: string } }>('/api/tags/:tag_id', async (req) => {
    const view = await repo.getTagView(req.params.tag_id);
    if (!view) throw notFound('TAG_NOT_FOUND', 'Tag not found');
    const { tag, item, entry } = view;

    if (tag.status === 'unclaimed') {
      return { tag_id: tag.id, tenant_id: tag.tenant_id, kind: tag.kind, status: 'unclaimed', action: 'onboard' };
    }

    if (!item) throw new ApiError(410, 'TAG_UNAVAILABLE', `Tag is ${tag.status} and not linked to an item`);

    const base = { tag_id: tag.id, tenant_id: tag.tenant_id, status: 'claimed', item: publicItem(item) };

    const editor = await canEditTag(repo, tag, bearerToken(req.headers.authorization));

    if (item.kind === 'gift') {
      // A gift is the same for everyone who taps; the role only decides who sees Edit.
      const gift = { title: item.title, photos: await repo.listGiftPhotos(item.id), updated_at: item.updated_at };
      return { ...base, gift, role: editor ? 'owner' : 'guest', can_edit: editor };
    }

    if (editor) return { ...base, role: 'owner', entry, can_edit: true };
    return { ...base, role: 'guest', can_edit: false };
  });
}
