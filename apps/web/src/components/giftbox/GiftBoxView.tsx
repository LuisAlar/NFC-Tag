import { useRef, useState } from 'react';
import {
  addGiftPhoto,
  createEditorInvite,
  deleteGiftPhoto,
  prepareImage,
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

export function GiftBoxView({ tagId, gift, canEdit, notice }: GiftBoxViewProps) {
  const [saved, setSaved] = useState(gift);
  const [draft, setDraft] = useState(gift);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'uploading' | 'inviting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = editing ? draft : saved;
  const secret = () => getOwnerSecret(tagId);
  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  const patchPhoto = (id: string, patch: PhotoPatch) =>
    setDraft((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  const removePhoto = (id: string) => setDraft((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));

  /** Uploads right away (the photo needs an id before it can be captioned), then joins the draft. */
  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy('uploading');
    setError(null);
    try {
      const photo = await addGiftPhoto(tagId, secret(), await prepareImage(file));
      setSaved((s) => ({ ...s, photos: [...s.photos, photo] }));
      setDraft((d) => ({ ...d, photos: [...d.photos, photo] }));
    } catch (err) {
      fail(err, 'Could not add that photo.');
    } finally {
      setBusy(null);
    }
  };

  const startEditing = () => {
    setDraft(saved);
    setError(null);
    setEditing(true);
  };

  /** Sends only what changed: the title, edited photos, and removed photos. */
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
    <div className="giftbox-page">
      <div className="giftbox">
        {canEdit && (
          <div className="giftbox-toolbar">
            {editing && (
              <button type="button" className="gift-btn ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="gift-btn"
              onClick={editing ? finishEditing : startEditing}
              disabled={busy !== null || (editing && !draft.title.trim())}
            >
              {editing ? (busy === 'saving' ? 'Saving…' : 'Done') : 'Edit'}
            </button>
          </div>
        )}

        <header className="giftbox-header">
          {editing ? (
            <input
              className="gift-input gift-title-input"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              maxLength={120}
              aria-label="Gift title (read aloud in place of the names artwork)"
            />
          ) : (
            <GiftBoxTitle title={shown.title} />
          )}
        </header>

        {notice && <p className="gift-notice" role="status">{notice}</p>}
        {error && <p className="gift-error" role="alert">{error}</p>}

        {shown.photos.length === 0 && !editing && (
          <p className="gift-empty">{canEdit ? 'No photos yet. Tap Edit to add the first one.' : 'No photos yet.'}</p>
        )}

        <ol className="photo-list">
          {shown.photos.map((photo) => (
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

        {editing && (
          <div className="gift-edit-tools">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void addPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" className="gift-btn outline wide" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              {busy === 'uploading' ? 'Adding photo…' : '+ Add photo'}
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
    </div>
  );
}
