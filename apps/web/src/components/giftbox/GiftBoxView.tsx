import { useEffect, useRef, useState } from 'react';
import {
  addGiftPhoto,
  createEditorInvite,
  deleteGiftPhoto,
  prepareImage,
  readTakenAt,
  reorderGiftPhotos,
  updateGiftPhoto,
  updateGiftTitle,
  type GiftBox,
  type GiftPhoto,
} from '../../lib/giftClient';
import { getOwnerSecret } from '../../lib/storage';
import { GiftBoxTitle } from './GiftBoxTitle';
import { PhotoCard } from './PhotoCard';
import './giftbox.css';

interface GiftBoxViewProps {
  tagId: string;
  gift: GiftBox;
  /** From the tag resolution. Only decides what is shown; the API re-checks the secret on every write. */
  canEdit: boolean;
  /** One-line message from the dispatcher, e.g. the result of opening an invite link. */
  notice?: string | null;
}

type PhotoPatch = Partial<Pick<GiftPhoto, 'caption' | 'note' | 'taken_at'>>;
type Busy = 'saving' | 'uploading' | 'inviting' | null;

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function GiftBoxView({ tagId, gift, canEdit, notice }: GiftBoxViewProps) {
  const [saved, setSaved] = useState(gift);
  const [draft, setDraft] = useState(gift);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const shown = editing ? draft : saved;
  const secret = () => getOwnerSecret(tagId);
  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  // Close the + menu on a tap outside it or on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const patchPhoto = (id: string, patch: PhotoPatch) =>
    setDraft((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  const removePhoto = (id: string) => setDraft((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));

  /** Moves a photo one place up (-1) or down (+1) in the draft. Saved with Done. */
  const movePhoto = (index: number, step: -1 | 1) =>
    setDraft((d) => {
      const to = index + step;
      if (to < 0 || to >= d.photos.length) return d;
      const photos = [...d.photos];
      [photos[index], photos[to]] = [photos[to], photos[index]];
      return { ...d, photos };
    });

  /**
   * Uploads each picked photo in turn, dated from its own metadata. Uploads
   * happen right away (a photo needs an id before it can be captioned), so
   * they also join the draft when editing.
   */
  const addPhotos = async (files: File[]) => {
    if (!files.length) return;
    setBusy('uploading');
    setError(null);
    let failed = 0;
    for (const [i, file] of files.entries()) {
      setProgress(files.length > 1 ? `Adding photo ${i + 1} of ${files.length}…` : 'Adding photo…');
      try {
        const takenAt = await readTakenAt(file);
        const photo = await addGiftPhoto(tagId, secret(), await prepareImage(file), takenAt);
        setSaved((s) => ({ ...s, photos: [...s.photos, photo] }));
        setDraft((d) => ({ ...d, photos: [...d.photos, photo] }));
      } catch (err) {
        failed += 1;
        fail(err, 'Could not add that photo.');
      }
    }
    if (failed && files.length > 1) setError(`${failed} of ${files.length} photos could not be added.`);
    setProgress(null);
    setBusy(null);
  };

  const pickPhotos = () => {
    setMenuOpen(false);
    fileInput.current?.click();
  };

  const startEditing = () => {
    setMenuOpen(false);
    setDraft(saved);
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setInviteUrl(null);
    setError(null);
  };

  /** Sends only what changed: title, edited and removed photos, then the order. */
  const finishEditing = async () => {
    setBusy('saving');
    setError(null);
    try {
      const s = secret();
      const title = draft.title.trim();
      const work: Promise<unknown>[] = [];
      if (title !== saved.title) work.push(updateGiftTitle(tagId, s, title));
      for (const before of saved.photos) {
        const after = draft.photos.find((p) => p.id === before.id);
        if (!after) {
          work.push(deleteGiftPhoto(tagId, s, before.id));
          continue;
        }
        const patch: PhotoPatch = {};
        if (after.caption !== before.caption) patch.caption = after.caption;
        if (after.note !== before.note) patch.note = after.note;
        if (after.taken_at !== before.taken_at) patch.taken_at = after.taken_at;
        if (Object.keys(patch).length) work.push(updateGiftPhoto(tagId, s, before.id, patch));
      }
      await Promise.all(work);

      // The order call must list exactly the photos left after removals, so it goes last.
      const order = draft.photos.map((p) => p.id);
      const savedOrder = saved.photos.map((p) => p.id).filter((id) => order.includes(id));
      if (!sameOrder(order, savedOrder)) await reorderGiftPhotos(tagId, s, order);

      setSaved({ ...draft, title });
      setEditing(false);
      setInviteUrl(null);
    } catch (err) {
      fail(err, 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    setBusy('inviting');
    setError(null);
    setCopied(false);
    try {
      setInviteUrl((await createEditorInvite(tagId, secret())).url);
    } catch (err) {
      fail(err, 'Could not create an invite link.');
    } finally {
      setBusy(null);
    }
  };

  const shareInvite = async () => {
    if (!inviteUrl) return;
    try {
      if (navigator.share) await navigator.share({ url: inviteUrl });
      else {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
      }
    } catch {
      // Share sheet dismissed or clipboard blocked: the link stays on screen to copy by hand.
    }
  };

  return (
    <div className={`giftbox-page${editing ? ' is-editing' : ''}`}>
      <div className="giftbox">
        <header className="giftbox-header">
          <GiftBoxTitle title={editing ? draft.title : saved.title} />
          {editing && (
            <label className="gift-title-field">
              <span>Title text, read aloud in place of the artwork</span>
              <input
                className="gift-input"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                maxLength={120}
              />
            </label>
          )}
        </header>

        {notice && <p className="gift-notice" role="status">{notice}</p>}
        {error && <p className="gift-error" role="alert">{error}</p>}

        {shown.photos.length === 0 && (
          <p className="gift-empty">{canEdit ? 'No photos yet. Tap + to add the first one.' : 'No photos yet.'}</p>
        )}

        <ol className="photo-list">
          {shown.photos.map((photo, index) => (
            <li key={photo.id} className="photo-row">
              <PhotoCard photo={photo} editing={editing} onChange={(patch) => patchPhoto(photo.id, patch)} />
              <div className="photo-caption">
                {editing ? (
                  <>
                    <textarea
                      value={photo.caption}
                      onChange={(e) => patchPhoto(photo.id, { caption: e.target.value })}
                      placeholder="Title or a few words"
                      maxLength={500}
                      aria-label="Caption"
                    />
                    <div className="photo-row-tools">
                      <button
                        type="button"
                        className="gift-icon-btn"
                        onClick={() => movePhoto(index, -1)}
                        disabled={index === 0}
                        aria-label="Move photo up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="gift-icon-btn"
                        onClick={() => movePhoto(index, 1)}
                        disabled={index === shown.photos.length - 1}
                        aria-label="Move photo down"
                      >
                        ↓
                      </button>
                    </div>
                    <button type="button" className="gift-link" onClick={() => removePhoto(photo.id)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <p>{photo.caption}</p>
                )}
              </div>
            </li>
          ))}
        </ol>

        {canEdit && (
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addPhotos(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        )}

        {progress && <p className="gift-progress" role="status">{progress}</p>}

        {canEdit && !editing && (
          <div className={`gift-fab${menuOpen ? ' is-open' : ''}`} ref={menuRef}>
            <button
              type="button"
              className="gift-fab-toggle"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={busy !== null}
              aria-expanded={menuOpen}
              aria-controls="gift-fab-options"
              aria-label={menuOpen ? 'Close menu' : 'Add photos or edit'}
            >
              <span aria-hidden="true">+</span>
            </button>
            <div className="gift-fab-options" id="gift-fab-options" inert={!menuOpen}>
              <button type="button" className="gift-btn" onClick={pickPhotos}>
                Add photos
              </button>
              <button type="button" className="gift-btn ghost" onClick={startEditing}>
                Edit
              </button>
            </div>
          </div>
        )}

        {editing && (
          <div className="gift-edit-tools">
            <button type="button" className="gift-btn outline wide" onClick={pickPhotos} disabled={busy !== null}>
              + Add photos
            </button>
            <button type="button" className="gift-btn ghost wide" onClick={invite} disabled={busy !== null}>
              {busy === 'inviting' ? 'Creating link…' : 'Let another phone edit'}
            </button>
            {inviteUrl && (
              <div className="gift-invite">
                <p>Open this link on the other phone. It works once and expires in 7 days.</p>
                <input className="gift-input" readOnly value={inviteUrl} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <button type="button" className="gift-btn wide" onClick={shareInvite}>
                  {copied ? 'Copied' : 'Share link'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="gift-edit-bar">
          <button type="button" className="gift-btn ghost" onClick={cancelEditing} disabled={busy !== null}>
            Cancel
          </button>
          <button type="button" className="gift-btn" onClick={finishEditing} disabled={busy !== null || !draft.title.trim()}>
            {busy === 'saving' ? 'Saving…' : 'Done'}
          </button>
        </div>
      )}
    </div>
  );
}
