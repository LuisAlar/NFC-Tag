import { useState } from 'react';
import type { GiftPhoto } from '../../lib/giftClient';

interface PhotoCardProps {
  photo: GiftPhoto;
  editing: boolean;
  onChange: (patch: Partial<Pick<GiftPhoto, 'note' | 'taken_at'>>) => void;
}

function formatTakenAt(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  // Built from parts so the date doesn't shift a day in timezones behind UTC.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * A photo that flips on click to show its note and date.
 * The card is a div with role=button (not a <button>) because in edit mode
 * the back holds form fields, which can't be nested inside a button.
 */
export function PhotoCard({ photo, editing, onChange }: PhotoCardProps) {
  const [flipped, setFlipped] = useState(false);
  // width / height of the loaded image, so the card takes the photo's own shape instead of cropping it.
  const [ratio, setRatio] = useState<number | null>(null);
  const toggle = () => setFlipped((f) => !f);
  const portrait = ratio !== null && ratio < 1;

  return (
    <div
      className={`photo-card${flipped ? ' is-flipped' : ''}${portrait ? ' is-portrait' : ''}`}
      style={ratio ? { aspectRatio: String(Math.min(Math.max(ratio, 0.6), 1.9)) } : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={flipped ? 'Show the photo' : 'Flip to read the note'}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // typing in a field on the back
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="photo-card-inner">
        <div className="photo-face photo-front">
          <img
            src={photo.image_url}
            alt={photo.caption || 'Photo'}
            decoding="async"
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w && h) setRatio(w / h);
            }}
          />
        </div>

        {/* inert keeps the hidden back's fields out of the tab order */}
        <div className="photo-face photo-back" inert={!flipped}>
          {editing ? (
            <div className="photo-back-form" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={photo.note}
                onChange={(e) => onChange({ note: e.target.value })}
                placeholder="Note on the back"
                maxLength={2000}
                aria-label="Note on the back"
              />
              <input
                type="date"
                value={photo.taken_at ?? ''}
                onChange={(e) => onChange({ taken_at: e.target.value || null })}
                aria-label="Date taken"
              />
            </div>
          ) : (
            <>
              <p className={`photo-note${photo.note ? '' : ' is-empty'}`}>{photo.note || 'No note yet.'}</p>
              {photo.taken_at && <p className="photo-date">{formatTakenAt(photo.taken_at)}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
