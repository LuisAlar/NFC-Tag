/**
 * Builds the Fastify app from its dependencies. server.ts calls this with
 * real config (locally and on Vercel); tests call it with in-memory PGlite
 * and use app.inject().
 *
 * Named createApp.ts, not app.ts, on purpose: Vercel's Fastify detection
 * looks for src/{app,index,server}.ts, and server.ts must be the only match.
 */

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Repo } from './db/repo.js';
import { ApiError } from './errors.js';
import type { ItemKind } from './models/types.js';
import { adminRoutes } from './routes/admin.js';
import { entryRoutes } from './routes/entries.js';
import { giftRoutes } from './routes/gifts.js';
import { itemRoutes } from './routes/items.js';
import { tagRoutes } from './routes/tags.js';
import { diskMediaStore, noMediaStore, type MediaStore } from './services/mediaStore.js';
import { artworkOnboarder } from './services/onboarding/artwork.js';
import type { Onboarder } from './services/onboarding/types.js';
import { fakeProviders, type Scenario } from './services/providers/fake.js';
import type { RunSink } from './services/runlog/index.js';

export interface AppDeps {
  config: Config;
  repo: Repo;
  media: MediaStore;
  runSinks: RunSink[];
  /** Onboarding flows per item kind, chosen per request (lets dev pick a fake scenario). */
  onboardersFor: (req: FastifyRequest) => Partial<Record<ItemKind, Onboarder>>;
}

/** Until real providers exist, every kind runs on fakes. */
function defaultOnboarders(config: Config) {
  return (req: FastifyRequest): Partial<Record<ItemKind, Onboarder>> => {
    const header = req.headers['x-fake-scenario'];
    const scenario: Scenario =
      config.allowScenarioHeader && (header === 'thrift' || header === 'famous') ? header : config.fakeScenario;
    return { artwork: artworkOnboarder(fakeProviders(scenario)) };
  };
}

function mediaFor(config: Config): MediaStore {
  switch (config.mediaDriver) {
    case 'disk':
      return diskMediaStore(config.mediaDir);
    case 'none':
      return noMediaStore();
    default:
      throw new Error(`Unknown MEDIA_DRIVER "${config.mediaDriver}"`);
  }
}

export async function buildApp(
  config: Config,
  repo: Repo,
  opts: { runSinks?: RunSink[]; logger?: boolean; onboardersFor?: AppDeps['onboardersFor'] } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  const deps: AppDeps = {
    config,
    repo,
    media: mediaFor(config),
    runSinks: opts.runSinks ?? [],
    onboardersFor: opts.onboardersFor ?? defaultOnboarders(config),
  };

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-fake-scenario'],
    // Lets browsers skip the preflight OPTIONS call for a day: fewer invocations.
    maxAge: 86_400,
  });
  await app.register(multipart, { limits: { fileSize: config.maxImageBytes, files: 1, fields: 10 } });

  // Only the disk driver is served by this API. Object storage will serve its own URLs.
  if (deps.media.driver === 'disk') {
    const { default: fastifyStatic } = await import('@fastify/static');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(config.mediaDir, { recursive: true });
    await app.register(fastifyStatic, { root: config.mediaDir, prefix: '/media/', index: false, list: false });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ message: err.message, code: err.code });
    }
    const e = err as { validation?: unknown; code?: string; statusCode?: number; message: string };
    if (e.validation) {
      return reply.code(400).send({ message: e.message, code: 'VALIDATION_ERROR' });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ message: 'Image is too large', code: 'IMAGE_TOO_LARGE' });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ message: e.message, code: e.code ?? 'BAD_REQUEST' });
    }
    req.log.error(err);
    return reply.code(500).send({ message: 'Internal server error', code: 'INTERNAL' });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ message: 'Route not found', code: 'ROUTE_NOT_FOUND' }));

  // Doesn't touch the database, so uptime pings never wake Neon.
  app.get('/health', async () => ({ status: 'ok', media: deps.media.driver }));

  await app.register(async (scope) => {
    await tagRoutes(scope, deps);
    await itemRoutes(scope, deps);
    await entryRoutes(scope, deps);
    await giftRoutes(scope, deps);
    await adminRoutes(scope, deps);
  });

  return app;
}
