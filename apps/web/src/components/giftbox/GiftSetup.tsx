import { useState } from 'react';
import { setUpGift } from '../../lib/giftClient';
import { setOwnerSecret } from '../../lib/storage';
import './giftbox.css';

interface GiftSetupProps {
  tagId: string;
  /** Called once the tag is claimed and this device holds its secret. */
  onDone: () => void;
}

/** First tap on a new gift tag: name the gift, and this phone becomes its first editor. */
export function GiftSetup({ tagId, onDone }: GiftSetupProps) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { raw_owner_secret } = await setUpGift(tagId, title.trim());
      setOwnerSecret(tagId, raw_owner_secret);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up the gift.');
      setBusy(false);
    }
  };

  return (
    <div className="giftbox-page">
      <form className="giftbox gift-setup" onSubmit={submit}>
        <h1>Set up this gift</h1>
        <p>
          This tag is new. Give the gift a title, like your two names. The page shows the names artwork in its place;
          the title is read aloud by screen readers. This phone will be able to edit it; you can let another phone edit
          afterwards.
        </p>
        <label htmlFor="gift-title-input">Title</label>
        <input
          id="gift-title-input"
          className="gift-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Luis & …"
          maxLength={120}
          autoComplete="off"
        />
        {error && <p className="gift-error" role="alert">{error}</p>}
        <button type="submit" className="gift-btn wide" disabled={!title.trim() || busy}>
          {busy ? 'Creating…' : 'Create gift'}
        </button>
      </form>
    </div>
  );
}
