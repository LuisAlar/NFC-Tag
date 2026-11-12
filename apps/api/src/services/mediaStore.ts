/**
 * Image storage behind one interface, so the backend can change without
 * touching onboarding or routes.
 *
 *   disk  - local dev. Files under MEDIA_DIR, served by this API at /media/*.
 *   none  - default on Vercel until object storage is chosen. Function disks
 *           are temporary and read-only, so nothing is stored; items get
 *           image_url = null and onboarding still works end to end.
 *   (next) r2 / blob - same interface. put() uploads with the provider SDK,
 *           publicUrl() returns the bucket/CDN URL, so images are served by
 *           the storage CDN and never cost a function call or Vercel bandwidth.
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

export type MediaDriver = 'disk' | 'none';

export interface MediaStore {
  readonly driver: MediaDriver;
  /** False when uploads are accepted but not kept (driver 'none'). */
  readonly stores: boolean;
  put(key: string, mime: string, bytes: Buffer): Promise<void>;
  /** URL clients load the image from. */
  publicUrl(key: string): string;
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
    },
    publicUrl: (key) => urlPrefix + key,
    remove: (key) => rm(join(root, key), { force: true }),
  };
}

export function noMediaStore(): MediaStore {
  return {
    driver: 'none',
    stores: false,
    async put() {},
    publicUrl: () => '',
    async remove() {},
  };
}
