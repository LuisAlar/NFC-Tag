/**
 * The one seam between the app and a Postgres connection.
 *
 *   DATABASE_URL set   -> node-postgres Pool (Neon in production, any Postgres locally)
 *   DATABASE_URL unset -> PGlite: real Postgres compiled to WASM, in-process.
 *                         Zero setup for local dev (data/pglite) and tests (memory).
 *
 * Both speak the same SQL, so what passes locally is what runs on Vercel.
 */

import type { Pool, PoolClient } from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Runs fn inside BEGIN/COMMIT; any throw rolls back. */
  transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R>;
  /** Multi-statement SQL with no parameters (migrations). */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

// -- node-postgres -----------------------------------------------------------

function pgClientSql(client: Pool | PoolClient): Omit<Sql, 'transaction' | 'close'> {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await client.query(text, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async exec(text) {
      await client.query(text);
    },
  };
}

export async function pgSql(connectionString: string): Promise<Sql> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString,
    // A function instance handles requests concurrently under Fluid compute,
    // but this app needs at most a couple of connections at once. Keep it
    // small so Neon's free-tier connection limit is never the bottleneck.
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  // On Vercel, lets idle connections close before the instance is suspended
  // instead of leaking until Neon times them out. No-op elsewhere.
  if (process.env.VERCEL) {
    const { attachDatabasePool } = await import('@vercel/functions');
    attachDatabasePool(pool);
  }

  return {
    ...pgClientSql(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ ...pgClientSql(client), transaction: () => Promise.reject(new Error('nested transaction')), close: async () => {} });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// -- PGlite ------------------------------------------------------------------

/** dataDir: a folder for a persistent local database, or undefined for in-memory. */
export async function pgliteSql(dataDir?: string): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(dataDir);

  type Q = Pick<Sql, 'query' | 'exec'>;
  const wrap = (q: { query: typeof db.query; exec: typeof db.exec }): Q => ({
    async query<T>(text: string, params?: unknown[]) {
      const res = await q.query<T>(text, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
    async exec(text) {
      await q.exec(text);
    },
  });

  return {
    ...wrap(db),
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({ ...wrap(tx), transaction: () => Promise.reject(new Error('nested transaction')), close: async () => {} }),
      ),
    close: () => db.close(),
  };
}

/** Picks the driver from config. */
export function connect(databaseUrl: string | null, pgliteDir?: string): Promise<Sql> {
  return databaseUrl ? pgSql(databaseUrl) : pgliteSql(pgliteDir);
}
