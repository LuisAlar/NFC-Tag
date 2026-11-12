/** PATCH /api/entries/:entry_id — debounced auto-save (Flow B1). Owner token required. */

import type { FastifyInstance } from 'fastify';
import { unauthorized } from '../errors.js';
import { bearerToken, isOwner } from '../services/auth.js';
import type { AppDeps } from '../createApp.js';

interface PatchBody {
  content: { type: 'doc'; content: unknown[] };
  prompts?: string[];
}

const patchSchema = {
  body: {
    type: 'object',
    required: ['content'],
    additionalProperties: false,
    properties: {
      content: {
        type: 'object',
        required: ['type', 'content'],
        properties: {
          type: { const: 'doc' },
          content: { type: 'array' },
        },
      },
      prompts: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
    },
  },
};

export async function entryRoutes(app: FastifyInstance, { repo }: AppDeps) {
  app.patch<{ Params: { entry_id: string }; Body: PatchBody }>(
    '/api/entries/:entry_id',
    { schema: patchSchema },
    async (req) => {
      const found = await repo.getEntryWithOwner({ entryId: req.params.entry_id });
      if (!found || !isOwner(found.ownerTokenHash, bearerToken(req.headers.authorization))) {
        throw unauthorized();
      }
      const { entry } = found;
      const updated_at = await repo.updateEntry(entry.id, { content: req.body.content, prompts: req.body.prompts });
      return { entry_id: entry.id, updated_at, status: 'saved' };
    },
  );
}
