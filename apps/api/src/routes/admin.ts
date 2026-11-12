/**
 * Tag provisioning (docs/processes.md, Process 1). Not in the public contract:
 * these mint the IDs you write onto physical chips.
 *
 *   POST /api/admin/tags  { count?: 1..50, tenant_id?, ids?: string[], kind?: 'artwork' | 'gift' }  -> new unclaimed tags + tap URLs
 *   GET  /api/admin/tags  -> every tag for the tenant
 *   POST /api/admin/tags/:tag_id/invites -> editor invite for a claimed gift tag (recovery when every device lost its secret)
 *
 * Requires `x-admin-token: $ADMIN_TOKEN`. With ADMIN_TOKEN unset in production the routes are off.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, conflict } from '../errors.js';
import { newTagId } from '../services/auth.js';
import type { AppDeps } from '../createApp.js';
import { ITEM_KINDS, type ItemKind } from '../models/types.js';
import { createInvite } from './gifts.js';

interface CreateBody {
  count?: number;
  tenant_id?: string;
  ids?: string[];
  /** What the new tags are for. Defaults to 'artwork'. */
  kind?: ItemKind;
}

const createSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      count: { type: 'integer', minimum: 1, maximum: 50 },
      tenant_id: { type: 'string', minLength: 1, maxLength: 36 },
      kind: { enum: [...ITEM_KINDS] },
      ids: { type: 'array', maxItems: 50, items: { type: 'string', pattern: '^[A-Za-z0-9_-]{3,32}$' } },
    },
  },
};

export async function adminRoutes(app: FastifyInstance, { repo, config }: AppDeps) {
  const guard = async (req: FastifyRequest) => {
    if (!config.adminToken || req.headers['x-admin-token'] !== config.adminToken) {
      throw new ApiError(403, 'FORBIDDEN', 'Admin token required');
    }
  };

  const tapUrl = (id: string) => `${config.publicWebUrl}/t/${id}`;

  app.post<{ Body: CreateBody | undefined }>('/api/admin/tags', { schema: createSchema, preHandler: guard }, async (req, reply) => {
    const body = req.body ?? {};
    const tenantId = body.tenant_id ?? config.defaultTenantId;
    await repo.ensureTenant({ id: tenantId, name: tenantId, slug: tenantId });

    const created: string[] = [];
    if (body.ids?.length) {
      for (const id of body.ids) {
        if (!(await repo.createTag(id, tenantId, body.kind))) throw conflict('TAG_EXISTS', `Tag ${id} already exists`);
        created.push(id);
      }
    } else {
      for (let i = 0; i < (body.count ?? 1); i++) {
        let id = newTagId();
        while (!(await repo.createTag(id, tenantId, body.kind))) id = newTagId();
        created.push(id);
      }
    }

    reply.code(201);
    return { tenant_id: tenantId, tags: created.map((id) => ({ tag_id: id, kind: body.kind ?? 'artwork', status: 'unclaimed', tap_url: tapUrl(id) })) };
  });

  app.post<{ Params: { tag_id: string } }>('/api/admin/tags/:tag_id/invites', { preHandler: guard }, async (req, reply) => {
    const tag = await repo.getTag(req.params.tag_id);
    if (!tag) throw new ApiError(404, 'TAG_NOT_FOUND', 'Tag not found');
    if (tag.kind !== 'gift' || tag.status === 'unclaimed') throw conflict('NOT_A_CLAIMED_GIFT', 'Invites are for gift tags that have been set up');
    reply.code(201);
    return createInvite(repo, config, tag.id, 'recovery');
  });

  app.get<{ Querystring: { tenant_id?: string } }>('/api/admin/tags', { preHandler: guard }, async (req) => {
    const tenantId = req.query.tenant_id ?? config.defaultTenantId;
    return {
      tenant_id: tenantId,
      tags: (await repo.listTags(tenantId)).map((t) => ({
        tag_id: t.id,
        kind: t.kind,
        status: t.status,
        item_id: t.item_id,
        claimed_at: t.claimed_at,
        tap_url: tapUrl(t.id),
      })),
    };
  });
}
