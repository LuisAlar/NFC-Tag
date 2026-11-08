/**
 * GET /api/tags/:tag_id — the tap dispatcher (docs/processes.md, Process 2).
 *
 *   unclaimed                 -> { status: 'unclaimed', action: 'onboard' }  (Flow A)
 *   claimed + owner token     -> { status: 'claimed', role: 'owner', item, entry }  (Flow B1)
 *   claimed, no/wrong token   -> { status: 'claimed', role: 'guest', item }  (Flow B2)
 */

import type { FastifyInstance } from 'fastify';
import { ApiError, notFound } from '../errors.js';
import { bearerToken, isOwner } from '../services/auth.js';
import type { AppDeps } from '../createApp.js';
import { publicItem } from './serialize.js';

export async function tagRoutes(app: FastifyInstance, { repo }: AppDeps) {
  app.get<{ Params: { tag_id: string } }>('/api/tags/:tag_id', async (req) => {
    const view = await repo.getTagView(req.params.tag_id);
    if (!view) throw notFound('TAG_NOT_FOUND', 'Tag not found');
    const { tag, item, entry } = view;

    if (tag.status === 'unclaimed') {
      return { tag_id: tag.id, tenant_id: tag.tenant_id, status: 'unclaimed', action: 'onboard' };
    }

    if (!item) throw new ApiError(410, 'TAG_UNAVAILABLE', `Tag is ${tag.status} and not linked to an item`);

    const base = { tag_id: tag.id, tenant_id: tag.tenant_id, status: 'claimed', item: publicItem(item) };

    if (isOwner(tag.owner_token_hash, bearerToken(req.headers.authorization))) {
      return { ...base, role: 'owner', entry, can_edit: true };
    }
    return { ...base, role: 'guest', can_edit: false };
  });
}
