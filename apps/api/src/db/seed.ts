/**
 * Seeds the default tenant and a few unclaimed tags whose IDs match the web
 * simulator's links. Safe to re-run: existing tags are left alone.
 *
 *   npm run seed                              # local PGlite
 *   npm run seed -- --reset                   # wipe local PGlite + media first
 *   DATABASE_URL=postgres://... npm run seed  # Neon (run db:migrate first)
 */

import { rmSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { migrate } from './migrate.js';
import { Repo } from './repo.js';
import { connect } from './sql.js';

const SEED_TAGS = ['test_unclaimed', 'tag_art_01', 'tag_art_02', 'tag_gift_01'];

const config = loadConfig();
if (process.argv.includes('--reset')) {
  if (config.databaseUrl) throw new Error('--reset only wipes the local PGlite database; refusing with DATABASE_URL set.');
  if (config.pgliteDir) rmSync(config.pgliteDir, { recursive: true, force: true });
  rmSync(config.mediaDir, { recursive: true, force: true });
  console.log(`Removed ${config.pgliteDir} and ${config.mediaDir}`);
}

const sql = await connect(config.databaseUrl, config.pgliteDir);
if (!config.databaseUrl) await migrate(sql);
const repo = new Repo(sql);
await repo.ensureTenant({ id: config.defaultTenantId, name: 'Default studio', slug: config.defaultTenantId });

for (const id of SEED_TAGS) {
  const kind = id.startsWith('tag_gift') ? 'gift' : 'artwork';
  const created = await repo.createTag(id, config.defaultTenantId, kind);
  // A database seeded before tags had a kind: fix it up while the tag is still unclaimed.
  if (!created) await repo.setUnclaimedTagKind(id, kind);
  const tag = (await repo.getTag(id))!;
  console.log(`${created ? 'created ' : 'exists  '} ${id.padEnd(16)} ${tag.kind.padEnd(8)} ${tag.status.padEnd(10)} ${config.publicWebUrl}/t/${id}`);
}
await repo.close();
