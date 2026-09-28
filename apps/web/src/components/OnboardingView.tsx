import { useState } from 'react';
import { onboardTag, type TagOwnerResponse } from '../lib/tagClient';
import { setOwnerSecret } from '../lib/storage';

interface OnboardingViewProps {
  tagId: string;
  onClaimSuccess: (ownerResponse: TagOwnerResponse) => void;
}

export function OnboardingView({ tagId, onClaimSuccess }: OnboardingViewProps) {
  const [title, setTitle] = useState('Thrifted Landscape Painting');
  const [artist, setArtist] = useState('Unknown Local Painter');
  const [year, setYear] = useState('Circa 1978');
  const [submitting, setSubmitting] = useState(false);
  const [photoSelected, setPhotoSelected] = useState<string | null>(null);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoSelected(file.name);
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { secret, response } = await onboardTag(tagId, {
        title,
        artist,
        year,
      });
      // Storing minted owner secret in localStorage
      setOwnerSecret(tagId, secret);
      onClaimSuccess(response);
    } catch (err) {
      console.error('Error claiming tag:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flow-card onboarding-card">
      <div className="card-badge badge-unclaimed">
        Flow A: First Tap Onboarding
      </div>

      <div className="tag-meta">
        <span className="label">Unclaimed NFC Tag:</span>
        <code className="tag-pill">{tagId}</code>
      </div>

      <div className="info-box">
        <h3>New Artwork Detected</h3>
        <p>
          This physical tag has not been linked to an artwork yet. Registering this item
          mints a permanent owner secret stored directly in your phone's browser.
        </p>
      </div>

      <form onSubmit={handleClaim} className="onboarding-form">
        <div className="form-group">
          <label htmlFor="photo">Artwork Photo (Camera Trigger):</label>
          <label className="camera-trigger-button">
            <input
              id="photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden-file-input"
            />
            {photoSelected ? `Attached: ${photoSelected}` : 'Take Photo or Choose File'}
          </label>
          <small className="form-help">
            Simulates the HTML5 mobile camera trigger used behind physical paintings.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="title">Artwork Title:</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="text-input"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="artist">Artist Name:</label>
            <input
              id="artist"
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="text-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="year">Year / Era:</label>
            <input
              id="year"
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="text-input"
            />
          </div>
        </div>

        <button type="submit" disabled={submitting} className="action-button primary">
          {submitting ? 'Minting Secret & Registering...' : 'Claim Artwork & Mint Owner Key'}
        </button>
      </form>
    </div>
  );
}
