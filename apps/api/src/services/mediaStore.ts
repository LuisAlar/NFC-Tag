/**
 * Image storage behind one interface, so the backend can change without
 * touching onboarding or routes.
 *
 *   disk  - local dev. Files under MEDIA_DIR, served by this API at /media/*.
 *   blob  - Vercel Blob (public store). The default on Vercel when the
 *           project has BLOB_READ_WRITE_TOKEN. Images are served from the
 *           Blob CDN and never cost a function call.
 *   none  - Vercel without a Blob store. Function disks are temporary and
 *           read-only, so nothing is stored: artwork items get
 *           image_url = null, and adding a gift photo returns 503.
 *
 * Keys follow the object-storage layout from docs/processes.md:
 *   tenants/{tenant_id}/items/{item_id}/original.{ext}
 *
 * Planned change once storage exists: the browser resizes the photo and
 * uploads it straight to storage with a short-lived signed URL, then sends
 * only the key to /api/items/onboard. That keeps image bytes out of the
 * function entirely (Vercel caps request bodies at 4.5 MB).
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const isSupportedImage = (mime: string) => mime in EXT_BY_MIME;

export const originalKey = (tenantId: string, itemId: string, mime: string) =>
  `tenants/${tenantId}/items/${itemId}/original.${EXT_BY_MIME[mime] ?? 'bin'}`;

/** One gift photo. The id is in the key so photos never overwrite each other. */
export const giftPhotoKey = (tenantId: string, itemId: string, photoId: string, mime: string) =>
  `tenants/${tenantId}/items/${itemId}/photos/${photoId}.${EXT_BY_MIME[mime] ?? 'bin'}`;

export type MediaDriver = 'disk' | 'blob' | 'none';

export interface MediaStore {
  readonly driver: MediaDriver;
  /** False when uploads are accepted but not kept (driver 'none'). */
  readonly stores: boolean;
  /**
   * Saves the image and returns the URL clients load it from. The URL comes
   * back from the store (Blob only knows it after the upload), so callers
   * save this value rather than building one from the key.
   */
  put(key: string, mime: string, bytes: Buffer): Promise<string>;
  remove(key: string): Promise<void>;
}

export function diskMediaStore(root: string, urlPrefix = '/media/'): MediaStore {
  return {
    driver: 'disk',
    stores: true,
    async put(key, _mime, bytes) {
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      return urlPrefix + key;
    },
    remove: (key) => rm(join(root, key), { force: true }),
  };
}

/**
 * Vercel Blob. @vercel/blob reads BLOB_READ_WRITE_TOKEN from the environment,
 * which connecting a Blob store to the project sets. Keys are unique per
 * image (ids are in the path) and never rewritten, so the CDN may cache them
 * for a year. The key doubles as the Blob pathname, so remove(key) works.
 */
export function blobMediaStore(token = process.env.BLOB_READ_WRITE_TOKEN): MediaStore {
  if (!token) throw new Error('MEDIA_DRIVER is "blob" but BLOB_READ_WRITE_TOKEN is not set. Connect a Blob store to this Vercel project.');
  const sdk = import('@vercel/blob');
  return {
    driver: 'blob',
    stores: true,
    async put(key, mime, bytes) {
      const { put } = await sdk;
      const blob = await put(key, bytes, {
        access: 'public',
        contentType: mime,
        addRandomSuffix: false,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
        token,
      });
      return blob.url;
    },
    async remove(key) {
      const { del } = await sdk;
      await del(key, { token });
    },
  };
}

export function noMediaStore(): MediaStore {
  return {
    driver: 'none',
    stores: false,
    put: async () => '',
    async remove() {},
  };
}
