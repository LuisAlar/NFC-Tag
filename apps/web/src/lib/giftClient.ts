/**
 * GiftBox API client. Unlike tagClient.ts (still mocked for artwork), this
 * talks to the real API in apps/api. In dev, Vite proxies /api and /media to
 * http://localhost:3000 (vite.config.ts), so requests are same-origin, the
 * same way the portfolio will proxy them in production.
 *
 * A gift is public: every tap reads it. Writes need this device's secret,
 * which the server checks on every request.
 */

export interface GiftPhoto {
  id: string;
  image_url: string;
  /** Text shown beside the photo. */
  caption: string;
  /** Text shown on the back after the flip. */
  note: string;
  /** Date the photo was taken, YYYY-MM-DD, or null when unknown. */
  taken_at: string | null;
  position: number;
}

export interface GiftBox {
  title: string;
  photos: GiftPhoto[];
  updated_at: string;
}

export type GiftTagResolution =
  | { status: 'unclaimed'; kind: 'gift'; tag_id: string; tenant_id: string; action: 'onboard' }
  | { status: 'claimed'; kind: 'gift'; tag_id: string; tenant_id: string; role: 'owner' | 'guest'; can_edit: boolean; gift: GiftBox };

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(path: string, init: RequestInit = {}, secret?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (secret) headers.set('authorization', `Bearer ${secret}`);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiRequestError(res.status, body?.code ?? 'ERROR', body?.message ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

/**
 * Asks the API about a tag. Returns the resolution when it is a gift tag, and
 * null when it is not (or the API is unreachable), so the caller can fall
 * back to the artwork mock.
 */
export async function resolveGiftTag(tagId: string, secret: string | null): Promise<GiftTagResolution | null> {
  let body: Record<string, unknown> & { item?: { kind?: string } };
  try {
    body = await api(`/api/tags/${enc(tagId)}`, {}, secret);
  } catch {
    return null;
  }
  if (body.status === 'unclaimed' && body.kind === 'gift') return body as unknown as GiftTagResolution;
  if (body.status === 'claimed' && body.item?.kind === 'gift' && body.gift) {
    return { ...body, kind: 'gift' } as unknown as GiftTagResolution;
  }
  return null;
}

/** First tap on a new gift tag. Returns this device's secret; the server never shows it again. */
export function setUpGift(tagId: string, title: string) {
  return api<{ raw_owner_secret: string; gift: GiftBox }>('/api/gifts', { method: 'POST', body: JSON.stringify({ tag_id: tagId, title }) });
}

export function updateGiftTitle(tagId: string, secret: string | null, title: string) {
  return api<{ title: string; updated_at: string }>(`/api/gifts/${enc(tagId)}`, { method: 'PATCH', body: JSON.stringify({ title }) }, secret);
}

export function addGiftPhoto(tagId: string, secret: string | null, image: Blob, takenAt: string | null = null) {
  const form = new FormData();
  form.append('image', image, 'photo.jpg');
  if (takenAt) form.append('taken_at', takenAt);
  return api<GiftPhoto>(`/api/gifts/${enc(tagId)}/photos`, { method: 'POST', body: form }, secret);
}

/** Saves a new photo order. photoIds must list every photo in the gift, first to last. */
export function reorderGiftPhotos(tagId: string, secret: string | null, photoIds: string[]) {
  return api<{ photos: GiftPhoto[] }>(
    `/api/gifts/${enc(tagId)}/photos/order`,
    { method: 'PUT', body: JSON.stringify({ photo_ids: photoIds }) },
    secret,
  );
}

/**
 * The day a photo was taken, YYYY-MM-DD, from its EXIF data, or null when
 * the file has none (screenshots, edited or messaged photos). Read from the
 * original file: prepareImage re-encodes through a canvas, which drops EXIF.
 *
 * EXIF dates carry no timezone; they are the camera's local wall-clock time,
 * which is the date to show, so local getters are used, not UTC ones.
 * exifr loads on first use, so viewers who never upload don't download it.
 */
export async function readTakenAt(file: File): Promise<string | null> {
  try {
    const { default: exifr } = await import('exifr');
    const tags = (await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized'] })) as
      | Record<string, unknown>
      | undefined;
    const date = [tags?.DateTimeOriginal, tags?.CreateDate, tags?.DateTimeDigitized].find(
      (d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()),
    );
    if (!date) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  } catch {
    return null; // unreadable metadata never blocks the upload
  }
}

export function updateGiftPhoto(
  tagId: string,
  secret: string | null,
  photoId: string,
  patch: Partial<Pick<GiftPhoto, 'caption' | 'note' | 'taken_at'>>,
) {
  return api<GiftPhoto>(`/api/gifts/${enc(tagId)}/photos/${enc(photoId)}`, { method: 'PATCH', body: JSON.stringify(patch) }, secret);
}

export function deleteGiftPhoto(tagId: string, secret: string | null, photoId: string) {
  return api<void>(`/api/gifts/${enc(tagId)}/photos/${enc(photoId)}`, { method: 'DELETE' }, secret);
}

/** A one-time link that lets another phone edit this gift. */
export function createEditorInvite(tagId: string, secret: string | null) {
  return api<{ url: string; expires_at: string }>(`/api/gifts/${enc(tagId)}/invites`, { method: 'POST', body: '{}' }, secret);
}

// One request per code, even when React StrictMode runs the effect twice in dev.
const redemptions = new Map<string, Promise<string>>();

/** Trades an invite code for this device's own secret. Works once per code. */
export function redeemEditorInvite(tagId: string, code: string): Promise<string> {
  const key = `${tagId}:${code}`;
  let pending = redemptions.get(key);
  if (!pending) {
    pending = api<{ raw_owner_secret: string }>(`/api/gifts/${enc(tagId)}/editors`, {
      method: 'POST',
      body: JSON.stringify({ invite_code: code }),
    }).then((r) => r.raw_owner_secret);
    redemptions.set(key, pending);
  }
  return pending;
}

const MAX_EDGE = 1600;

/**
 * Shrinks a picked photo to a JPEG at most 1600px on its long side before
 * upload. Phone photos are 3-6 MB and the API (and Vercel) cap uploads near
 * 4 MB; this brings them to a few hundred KB and turns HEIC into JPEG, which
 * every browser can show.
 */
export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("This browser can't read that photo. Try a JPEG or PNG, or add it from your iPhone.");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that photo.'))), 'image/jpeg', 0.85),
  );
}
