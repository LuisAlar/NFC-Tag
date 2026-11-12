/**
 * Applies src/db/migrations/*.sql in filename order, each once, each in its
 * own transaction, tracked in schema_migrations.
 *
 * Migrations are run deliberately, never on a function cold start: every
 * cold start would otherwise pay for a round of schema queries.
 *
 *   npm run db:migrate                         # local PGlite (data/pglite)
 *   DATABASE_URL=postgres://... npm run db:migrate   # Neon / any Postgres
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Sql } from './sql.js';

const DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export async function migrate(sql: Sql, log: (msg: string) => void = () => {}): Promise<string[]> {
  await sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const done = new Set((await sql.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

  const applied: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const text = readFileSync(DIR + file, 'utf8');
    await sql.transaction(async (tx) => {
      await tx.exec(text);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`applied ${file}`);
    applied.push(file);
  }
  if (!applied.length) log('schema is up to date');
  return applied;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadConfig } = await import('../config.js');
  const { connect } = await import('./sql.js');
  const config = loadConfig();
  const sql = await connect(config.databaseUrl, config.pgliteDir);
  console.log(`migrating ${config.databaseUrl ? 'DATABASE_URL' : `PGlite at ${config.pgliteDir}`}`);
  await migrate(sql, console.log);
  await sql.close();
}
