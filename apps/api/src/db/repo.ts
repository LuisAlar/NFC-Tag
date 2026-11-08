/**
 * Data access. Everything above this file talks to `Repo`, never to SQL.
 * The only dependency is the `Sql` seam (sql.ts), so the same queries run on
 * Neon in production and on PGlite locally and in tests.
 *
 * Efficiency notes (each tap is a billed function call):
 *   - Tag resolution is one round trip: tag + item + entry in a single join.
 *   - Ownership checks fetch only what they need (tag hash with the entry).
 */

import type { Entry, Item, ItemKind, Tag, TagStatus, Tenant } from '../models/types.js';
import type { RunRecord } from '../services/runlog/index.js';
import type { Sql } from './sql.js';

type Row = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
/** JSONB comes back parsed from both drivers; tolerate strings just in case. */
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const toTag = (r: Row, prefix = ''): Tag => ({
  id: r[`${prefix}id`] as string,
  tenant_id: r[`${prefix}tenant_id`] as string,
  item_id: (r[`${prefix}item_id`] as string | null) ?? null,
  status: r[`${prefix}status`] as TagStatus,
  owner_token_hash: (r[`${prefix}owner_token_hash`] as string | null) ?? null,
  claimed_at: isoOrNull(r[`${prefix}claimed_at`]),
  created_at: iso(r[`${prefix}created_at`]),
});

const toItem = (r: Row, prefix = ''): Item => ({
  id: r[`${prefix}id`] as string,
  tenant_id: r[`${prefix}tenant_id`] as string,
  kind: r[`${prefix}kind`] as ItemKind,
  title: r[`${prefix}title`] as string,
  artist: (r[`${prefix}artist`] as string | null) ?? null,
  year: (r[`${prefix}year`] as string | null) ?? null,
  image_url: (r[`${prefix}image_url`] as string | null) ?? null,
  context: json(r[`${prefix}context`], { summary: '' }),
  raw_recognition_data: json(r[`${prefix}raw_recognition_data`], {}),
  created_at: iso(r[`${prefix}created_at`]),
  updated_at: iso(r[`${prefix}updated_at`]),
});

const toEntry = (r: Row, prefix = ''): Entry => ({
  id: r[`${prefix}id`] as string,
  item_id: r[`${prefix}item_id`] as string,
  tenant_id: r[`${prefix}tenant_id`] as string,
  prompts: json(r[`${prefix}prompts`], []),
  content: json(r[`${prefix}content`], { type: 'doc', content: [] }),
  created_at: iso(r[`${prefix}created_at`]),
  updated_at: iso(r[`${prefix}updated_at`]),
});

/** Prefixed column lists so one join can return three records without name clashes. */
const cols = (table: string, alias: string, names: string[]) => names.map((n) => `${alias}.${n} AS ${table}_${n}`).join(', ');
const TAG_COLS = ['id', 'tenant_id', 'item_id', 'status', 'owner_token_hash', 'claimed_at', 'created_at'];
const ITEM_COLS = ['id', 'tenant_id', 'kind', 'title', 'artist', 'year', 'image_url', 'context', 'raw_recognition_data', 'created_at', 'updated_at'];
const ENTRY_COLS = ['id', 'item_id', 'tenant_id', 'prompts', 'content', 'created_at', 'updated_at'];

export interface ClaimInput {
  tagId: string;
  ownerTokenHash: string;
  item: Item;
  entry: Entry;
}

/** Everything a tap needs, fetched in one query. */
export interface TagView {
  tag: Tag;
  item: Item | null;
  entry: Entry | null;
}

export class Repo {
  constructor(readonly sql: Sql) {}

  close(): Promise<void> {
    return this.sql.close();
  }

  // -- Tenants ---------------------------------------------------------------

  async ensureTenant(t: Pick<Tenant, 'id' | 'name' | 'slug'>): Promise<void> {
    await this.sql.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [t.id, t.name, t.slug]);
  }

  // -- Tags ------------------------------------------------------------------

  async getTag(id: string): Promise<Tag | null> {
    const { rows } = await this.sql.query('SELECT * FROM tags WHERE id = $1', [id]);
    return rows[0] ? toTag(rows[0]) : null;
  }

  /**
   * The tap path. Returns the tag with its item and entry (if claimed) in a
   * single round trip. The route decides what the caller may see; the entry
   * is dropped for guests before anything is sent.
   */
  async getTagView(id: string): Promise<TagView | null> {
    const { rows } = await this.sql.query(
      `SELECT ${cols('tag', 't', TAG_COLS)}, ${cols('item', 'i', ITEM_COLS)}, ${cols('entry', 'e', ENTRY_COLS)}
         FROM tags t
         LEFT JOIN items i ON i.id = t.item_id
         LEFT JOIN entries e ON e.item_id = i.id
        WHERE t.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      tag: toTag(r, 'tag_'),
      item: r.item_id ? toItem(r, 'item_') : null,
      entry: r.entry_id ? toEntry(r, 'entry_') : null,
    };
  }

  /** Returns false if the id is already taken. */
  async createTag(id: string, tenantId: string): Promise<boolean> {
    const { rowCount } = await this.sql.query(
      `INSERT INTO tags (id, tenant_id, status) VALUES ($1, $2, 'unclaimed') ON CONFLICT (id) DO NOTHING`,
      [id, tenantId],
    );
    return rowCount === 1;
  }

  async listTags(tenantId: string): Promise<Tag[]> {
    const { rows } = await this.sql.query('SELECT * FROM tags WHERE tenant_id = $1 ORDER BY created_at', [tenantId]);
    return rows.map((r) => toTag(r));
  }

  /**
   * Inserts the item and entry and locks the tag to them in one transaction.
   * The tag update is conditional on status = 'unclaimed'. In Postgres, a
   * second concurrent claim blocks on the tag's row lock, then re-checks the
   * condition after the first commits, finds 'active', and rolls back.
   * Returns false (writing nothing) if the tag was no longer unclaimed.
   */
  async claimTag({ tagId, ownerTokenHash, item, entry }: ClaimInput): Promise<boolean> {
    const LOST = Symbol('lost');
    try {
      return await this.sql.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO items (id, tenant_id, kind, title, artist, year, image_url, context, raw_recognition_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $10)`,
          [
            item.id,
            item.tenant_id,
            item.kind,
            item.title,
            item.artist,
            item.year,
            item.image_url,
            JSON.stringify(item.context),
            JSON.stringify(item.raw_recognition_data),
            item.created_at,
          ],
        );
        await tx.query(
          `INSERT INTO entries (id, item_id, tenant_id, prompts, content, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $6)`,
          [entry.id, entry.item_id, entry.tenant_id, JSON.stringify(entry.prompts), JSON.stringify(entry.content), entry.created_at],
        );
        const { rowCount } = await tx.query(
          `UPDATE tags SET status = 'active', item_id = $1, owner_token_hash = $2, claimed_at = $3
            WHERE id = $4 AND status = 'unclaimed'`,
          [item.id, ownerTokenHash, item.created_at, tagId],
        );
        if (rowCount !== 1) throw LOST; // rolls back the inserts
        return true;
      });
    } catch (err) {
      if (err === LOST) return false;
      throw err;
    }
  }

  // -- Items & entries -------------------------------------------------------

  async getItem(id: string): Promise<Item | null> {
    const { rows } = await this.sql.query('SELECT * FROM items WHERE id = $1', [id]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  /** The entry for an item plus the owning tag's hash, for the owner check. */
  async getEntryWithOwner(by: { itemId: string } | { entryId: string }): Promise<{ entry: Entry; ownerTokenHash: string | null } | null> {
    const [where, value] = 'itemId' in by ? ['e.item_id', by.itemId] : ['e.id', by.entryId];
    const { rows } = await this.sql.query(
      `SELECT e.*, t.owner_token_hash FROM entries e LEFT JOIN tags t ON t.item_id = e.item_id WHERE ${where} = $1`,
      [value],
    );
    const r = rows[0];
    return r ? { entry: toEntry(r), ownerTokenHash: (r.owner_token_hash as string | null) ?? null } : null;
  }

  /** Writes content (and prompts, when given). Returns the new updated_at. */
  async updateEntry(id: string, patch: { content: unknown; prompts?: string[] }): Promise<string> {
    const { rows } = await this.sql.query<{ updated_at: unknown }>(
      `UPDATE entries
          SET content = $2::jsonb,
              prompts = COALESCE($3::jsonb, prompts),
              updated_at = NOW()
        WHERE id = $1
        RETURNING updated_at`,
      [id, JSON.stringify(patch.content), patch.prompts ? JSON.stringify(patch.prompts) : null],
    );
    return iso(rows[0]?.updated_at);
  }

  // -- Pipeline runs ---------------------------------------------------------

  async insertRun(run: RunRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO pipeline_runs (id, tenant_id, item_id, tag_id, pipeline_name, pipeline_version, trigger, status,
                                  started_at, finished_at, duration_ms, total_usd, record)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        run.runId,
        run.subject.tenantId,
        // Only link rows that exist; a failed onboarding never created its item.
        null,
        run.subject.tagId ?? null,
        run.pipeline.name,
        run.pipeline.version,
        run.trigger,
        run.status,
        run.startedAt,
        run.finishedAt ?? null,
        run.durationMs ?? null,
        run.totals.usd,
        JSON.stringify(run),
      ],
    );
    if (run.subject.itemId) {
      // Set separately so a missing item can't fail the insert on the FK.
      await this.sql.query(
        'UPDATE pipeline_runs SET item_id = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM items WHERE id = $2)',
        [run.runId, run.subject.itemId],
      );
    }
  }
}
