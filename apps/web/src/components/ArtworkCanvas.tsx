import { useState } from 'react';
import type { Item, Entry } from '../lib/tagClient';
import { clearOwnerSecret, setOwnerSecret, getOwnerSecret } from '../lib/storage';

interface ArtworkCanvasProps {
  tagId: string;
  item: Item;
  entry?: Entry;
  canEdit: boolean;
  onRefreshRole: () => void;
}

export function ArtworkCanvas({
  tagId,
  item,
  entry,
  canEdit,
  onRefreshRole,
}: ArtworkCanvasProps) {
  const currentSecret = getOwnerSecret(tagId);
  const [newNote, setNewNote] = useState('');
  const [notes, setNotes] = useState<string[]>(entry?.content?.paragraphs || []);

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    setNotes([...notes, newNote.trim()]);
    setNewNote('');
  };

  const handleClearSecret = () => {
    clearOwnerSecret(tagId);
    onRefreshRole();
  };

  const handleSimulateClaimSecret = () => {
    setOwnerSecret(tagId, 'secret_owner_art_01_token');
    onRefreshRole();
  };

  return (
    <article className="flow-card canvas-card">
      <div className="canvas-header-bar">
        <span className={`card-badge ${canEdit ? 'badge-owner' : 'badge-guest'}`}>
          {canEdit ? 'Studio Canvas (Owner)' : 'Exhibition Canvas (Guest)'}
        </span>
        <span className={`tag-pill ${canEdit ? 'owner-pill' : 'guest-pill'}`}>
          {canEdit ? 'Authorized Device' : 'Visitor Mode'}
        </span>
      </div>

      <header className="header-meta">
        <div>
          <h2>{item.title}</h2>
          <p className="subtitle">
            {item.artist || 'Unknown Artist'} &bull; {item.year || 'Unknown Era'}
          </p>
        </div>
      </header>

      <div className="artwork-preview">
        {item.image_url && (
          <img src={item.image_url} alt={item.title} className="artwork-image" />
        )}
      </div>

      {item.context.wikipedia_summary && (
        <section className="context-box">
          <h4>Historical Context (Archival Record)</h4>
          <p>{item.context.wikipedia_summary}</p>
          {item.context.source_url && (
            <a
              href={item.context.source_url}
              target="_blank"
              rel="noreferrer"
              className="source-link"
            >
              Source: Wikipedia Reference
            </a>
          )}
        </section>
      )}

      {/* Permission-Gated Journal Section */}
      {canEdit ? (
        <section className="journal-section">
          <h3>Private Studio Journal</h3>
          <p className="section-help">
            Introspective reflections and curatorial prompts for this artwork:
          </p>

          {entry?.prompts && entry.prompts.length > 0 && (
            <div className="prompts-list">
              {entry.prompts.map((prompt, idx) => (
                <div key={idx} className="prompt-item">
                  <span className="prompt-bullet">&bull;</span>
                  <span>{prompt}</span>
                </div>
              ))}
            </div>
          )}

          <div className="notes-list">
            {notes.map((paragraph, idx) => (
              <div key={idx} className="note-card">
                <p>{paragraph}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddNote} className="note-input-form">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Record a thought, thrift story, or observation..."
              rows={3}
              className="textarea-input"
            />
            <button type="submit" className="action-button primary">
              Save Journal Reflection
            </button>
          </form>

          <footer className="device-security-panel">
            <h4>Device Authentication</h4>
            <p>
              Device secret recognized in local storage:
            </p>
            <code className="secret-code">
              {currentSecret ? `${currentSecret.substring(0, 20)}...` : 'Secret active'}
            </code>
            <div className="panel-actions">
              <button
                type="button"
                onClick={handleClearSecret}
                className="action-button secondary"
              >
                Simulate Clearing Secret (Switch to Guest View)
              </button>
            </div>
          </footer>
        </section>
      ) : (
        <section className="guest-section">
          <div className="guest-notice">
            <h4>Private Reflections Locked</h4>
            <p>
              This piece is cataloged in the collector's personal journal. Studio notes,
              introspective entries, and provenance details are accessible exclusively on
              the owner's authorized device.
            </p>
          </div>

          <div className="guest-actions">
            <button
              type="button"
              onClick={handleSimulateClaimSecret}
              className="action-button secondary"
            >
              Simulate Authorizing Device (Restore Owner Secret)
            </button>
          </div>
        </section>
      )}
    </article>
  );
}
