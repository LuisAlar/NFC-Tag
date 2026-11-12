/**
 * Environment-driven settings. Two profiles, picked by the VERCEL env var
 * that Vercel sets on every deployment:
 *
 *   local  - PGlite in data/pglite, images on disk, JSONL run log, dev admin token
 *   vercel - DATABASE_URL (Neon) required, Vercel Blob when connected, run log in Postgres
 */

import { resolve } from 'node:path';
import type { MediaDriver } from './services/mediaStore.js';
import type { Scenario } from './services/providers/fake.js';

/** The portfolio domain the tap URLs live on. */
const PORTFOLIO_ORIGIN = 'https://luis-alarcon.vercel.app';

export interface Config {
  onVercel: boolean;
  port: number;
  host: string;
  /** Postgres connection string. Null = embedded PGlite (local dev only). */
  databaseUrl: string | null;
  /** PGlite data folder when databaseUrl is null. Undefined = in-memory. */
  pgliteDir: string | undefined;
  mediaDriver: MediaDriver;
  /** Root folder for the disk media driver. */
  mediaDir: string;
  /** JSONL run log path (local only; Vercel has no persistent disk). */
  runlogPath: string | null;
  /** Required to call the tag-provisioning endpoints. Null = those routes are off. */
  adminToken: string | null;
  defaultTenantId: string;
  /** Web app origin; tap and invite URLs are `${publicWebUrl}/t/{tag_id}`. */
  publicWebUrl: string;
  /** Allowed browser origins for CORS. Not needed when the portfolio proxies /api same-origin. */
  corsOrigins: string[];
  /** Fake-provider scenario until real Vision/Wikipedia/LLM providers land. */
  fakeScenario: Scenario;
  /** Allow the x-fake-scenario header to override fakeScenario per request. */
  allowScenarioHeader: boolean;
  /** Max upload size in bytes. Vercel rejects request bodies over 4.5 MB before our code runs. */
  maxImageBytes: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const onVercel = Boolean(env.VERCEL);
  const isProd = onVercel || env.NODE_ENV === 'production';
  const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
  // The web app and API share one Vercel project (root vercel.json), so on
  // Vercel the page lives on this project's own production domain. Vercel sets
  // VERCEL_PROJECT_PRODUCTION_URL without a scheme; the portfolio is the fallback.
  const vercelOrigin = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : PORTFOLIO_ORIGIN;
  const webOrigin = onVercel ? vercelOrigin : 'http://localhost:5173';

  return {
    onVercel,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR ?? resolve('data/pglite'),
    // On Vercel, a connected Blob store turns image storage on by itself.
    mediaDriver: (env.MEDIA_DRIVER as MediaDriver | undefined) ?? (onVercel ? (env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'none') : 'disk'),
    mediaDir: env.MEDIA_DIR ?? resolve('data/media'),
    runlogPath: onVercel ? null : (env.RUNLOG_PATH ?? resolve('runs/onboarding.jsonl')),
    adminToken: env.ADMIN_TOKEN || (isProd ? null : 'dev-admin'),
    defaultTenantId: env.DEFAULT_TENANT_ID ?? 'tenant_01',
    publicWebUrl: env.PUBLIC_WEB_URL ?? webOrigin,
    corsOrigins: list(env.CORS_ORIGINS ?? webOrigin),
    fakeScenario: env.FAKE_SCENARIO === 'thrift' ? 'thrift' : 'famous',
    allowScenarioHeader: !isProd || env.ALLOW_SCENARIO_HEADER === '1',
    maxImageBytes: Number(env.MAX_IMAGE_BYTES ?? 4 * 1024 * 1024),
    ...overrides,
  };
}
