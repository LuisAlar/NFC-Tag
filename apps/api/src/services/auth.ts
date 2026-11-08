/**
 * Passwordless device ownership (docs/processes.md, Flow A step 6).
 *
 * Onboarding mints a 256-bit secret, returns it once to the claiming device,
 * and stores only its SHA-256. Every owner request sends the raw secret as a
 * Bearer token; we hash it and compare in constant time.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function mintOwnerSecret(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  return { raw, hash: sha256Hex(raw) };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1] : null;
}

/** ownerTokenHash: the tag's stored hash (null for unclaimed tags). */
export function isOwner(ownerTokenHash: string | null | undefined, rawToken: string | null): boolean {
  if (!ownerTokenHash || !rawToken) return false;
  const a = Buffer.from(sha256Hex(rawToken), 'hex');
  const b = Buffer.from(ownerTokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// -- IDs ----------------------------------------------------------------------

const TAG_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

/** NanoID-style tag handle: 10 chars from a 64-symbol alphabet = 60 bits. */
export function newTagId(length = 10): string {
  const bytes = randomBytes(length);
  let id = '';
  for (const b of bytes) id += TAG_ALPHABET[b & 63];
  return id;
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
