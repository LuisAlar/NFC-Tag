import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setOwnerSecret, clearOwnerSecret, getAllStoredTagSecrets } from '../lib/storage';

export function SimConsole() {
  const navigate = useNavigate();
  const [customTag, setCustomTag] = useState('');
  const [storedSecrets, setStoredSecrets] = useState<Record<string, string>>(() => getAllStoredTagSecrets());

  const refreshSecrets = () => {
    setStoredSecrets(getAllStoredTagSecrets());
  };

  const handleSimulateUnclaimed = () => {
    const randomTag = `tag_new_${Math.random().toString(36).substring(2, 6)}`;
    navigate(`/t/${randomTag}`);
  };

  const handleSimulateOwner = () => {
    const tagId = 'tag_art_01';
    setOwnerSecret(tagId, 'secret_owner_art_01_token');
    refreshSecrets();
    navigate(`/t/${tagId}`);
  };

  const handleSimulateGuest = () => {
    const tagId = 'tag_art_01';
    clearOwnerSecret(tagId);
    refreshSecrets();
    navigate(`/t/${tagId}`);
  };

  const handleCustomNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTag.trim()) return;
    navigate(`/t/${encodeURIComponent(customTag.trim())}`);
  };

  const handleClearAllSecrets = () => {
    Object.keys(storedSecrets).forEach((tagId) => clearOwnerSecret(tagId));
    refreshSecrets();
  };

  return (
    <div className="sim-console">
      <header className="console-header">
        <h1>NFC Art Journal &bull; Routing Simulation Console</h1>
        <p className="console-description">
          Testing physical tap routing lifecycles without requiring hardware NFC stickers.
          Navigating to <code>/t/:tag_id</code> reproduces the exact mobile browser event
          triggered when tapping an NTAG213 chip.
        </p>
      </header>

      <div className="sim-grid">
        <div className="sim-card">
          <div className="card-badge badge-unclaimed">Flow A</div>
          <h3>Simulate Unclaimed Tag</h3>
          <p>
            Simulates tapping an unprogrammed or newly purchased NFC sticker behind a fresh artwork.
          </p>
          <button
            onClick={handleSimulateUnclaimed}
            className="action-button primary"
          >
            Tap Fresh NFC Sticker (/t/tag_new)
          </button>
        </div>

        <div className="sim-card">
          <div className="card-badge badge-owner">Flow B1</div>
          <h3>Simulate Claimed Tag (Owner)</h3>
          <p>
            Simulates the collector tapping an artwork using their authorized personal phone with matching device secret.
          </p>
          <button
            onClick={handleSimulateOwner}
            className="action-button primary"
          >
            Tap Tag as Owner (/t/tag_art_01)
          </button>
        </div>

        <div className="sim-card">
          <div className="card-badge badge-guest">Flow B2</div>
          <h3>Simulate Claimed Tag (Guest)</h3>
          <p>
            Simulates a gallery guest, visitor, or incognito browser tapping a claimed artwork without owner credentials.
          </p>
          <button
            onClick={handleSimulateGuest}
            className="action-button secondary"
          >
            Tap Tag as Guest (/t/tag_art_01)
          </button>
        </div>
      </div>

      <div className="custom-tap-panel">
        <h3>Simulate Custom NFC Tag Tap</h3>
        <form onSubmit={handleCustomNavigate} className="custom-tag-form">
          <input
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Enter any custom tag ID (e.g. xK9_2pL9q0)"
            className="text-input"
          />
          <button type="submit" className="action-button primary">
            Simulate Tap
          </button>
        </form>
      </div>

      <div className="secrets-inspector">
        <div className="inspector-header">
          <h3>Local Device Secrets Inspector</h3>
          {Object.keys(storedSecrets).length > 0 && (
            <button
              onClick={handleClearAllSecrets}
              className="action-button danger-sm"
            >
              Clear All Stored Secrets
            </button>
          )}
        </div>
        <p className="inspector-help">
          These secrets represent keys stored in your browser's <code>localStorage</code> simulating your authorized mobile device.
        </p>
        {Object.keys(storedSecrets).length === 0 ? (
          <div className="empty-secrets">No device owner secrets currently stored in this browser session.</div>
        ) : (
          <ul className="secrets-list">
            {Object.entries(storedSecrets).map(([tagId, secret]) => (
              <li key={tagId} className="secret-item">
                <span className="secret-tag">Tag: <code>{tagId}</code></span>
                <span className="secret-value">Secret: <code>{secret}</code></span>
                <button
                  onClick={() => {
                    clearOwnerSecret(tagId);
                    refreshSecrets();
                  }}
                  className="remove-btn"
                  title="Remove Secret"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
