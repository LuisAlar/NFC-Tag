/**
 * The API entrypoint, locally and on Vercel.
 *
 * Vercel detects this file (src/server.ts) as a Fastify app and runs the
 * whole thing as one function with Fluid compute. Everything at module top
 * level runs once per cold start, so keep it to: read config, open a pool
 * (lazy, no query), register routes. Migrations are NOT run here.
 *
 *   npm run dev       # local, watch mode, PGlite in data/pglite
 *   npm run db:migrate && npm run seed   # first-time local setup
 */

import { buildApp } from './createApp.js';
import { loadConfig } from './config.js';
import { Repo } from './db/repo.js';
import { connect } from './db/sql.js';
import { consoleSink, jsonlSink, type RunSink } from './services/runlog/index.js';
import { pgSink } from './services/runlog/pgSink.js';

const config = loadConfig();

if (config.onVercel && !config.databaseUrl) {
  // PGlite on a function would be an in-memory database that vanishes per instance.
  throw new Error('DATABASE_URL is not set. Connect a Neon database to this Vercel project.');
}

const sql = await connect(config.databaseUrl, config.pgliteDir);
if (!config.databaseUrl) {
  // Local convenience only: PGlite starts empty, so bring its schema up to date.
  const { migrate } = await import('./db/migrate.js');
  await migrate(sql);
}
const repo = new Repo(sql);

const runSinks: RunSink[] = [pgSink(repo)];
if (config.runlogPath) runSinks.push(consoleSink(), jsonlSink(config.runlogPath));

const app = await buildApp(config, repo, { logger: true, runSinks });

if (!config.onVercel) {
  const shutdown = async () => {
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (config.onVercel) {
  // Vercel replaces listen() and hands requests to the app itself; it may
  // never report "listening". Awaiting it would keep this module from ever
  // finishing loading, and every request would hang. Vercel's own Fastify
  // example calls listen() without await, so match that here.
  app.listen({ port: config.port, host: config.host }).catch((err) => app.log.error(err));
} else {
  await app.listen({ port: config.port, host: config.host });
}
