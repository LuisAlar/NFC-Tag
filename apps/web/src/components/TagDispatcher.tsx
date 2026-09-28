import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { resolveTag, type TagResolutionResponse, type TagOwnerResponse } from '../lib/tagClient';
import { getOwnerSecret } from '../lib/storage';
import { OnboardingView } from './OnboardingView';
import { ArtworkCanvas } from './ArtworkCanvas';

export function TagDispatcher() {
  const { tag_id } = useParams<{ tag_id: string }>();
  const [loading, setLoading] = useState(true);
  const [resolution, setResolution] = useState<TagResolutionResponse | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const reloadTag = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!tag_id) return;

    const storedSecret = getOwnerSecret(tag_id);
    resolveTag(tag_id, storedSecret)
      .then((res) => {
        if (!ignore) {
          setResolution(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error('Error resolving tag:', err);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [tag_id, refreshToken]);

  if (!tag_id) {
    return (
      <div className="flow-card error-card">
        <h3>Missing Tag Parameter</h3>
        <p>No tag ID was provided in the URL.</p>
        <Link to="/" className="action-button secondary">
          Return to Simulator
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flow-card loading-card">
        <div className="loading-spinner"></div>
        <h3>Resolving Tag Lifecycle...</h3>
        <p>
          Simulating backend lookup for tag <code>{tag_id}</code>
        </p>
      </div>
    );
  }

  if (!resolution) {
    return (
      <div className="flow-card error-card">
        <h3>Resolution Failed</h3>
        <p>Could not resolve state for tag: {tag_id}</p>
        <button
          onClick={reloadTag}
          className="action-button secondary"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="tag-dispatcher-container">
      <div className="routing-breadcrumbs">
        <Link to="/" className="breadcrumb-link">&larr; Simulator Console</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">Tag: {tag_id}</span>
      </div>

      {resolution.status === 'unclaimed' && (
        <OnboardingView
          tagId={tag_id}
          onClaimSuccess={(ownerData: TagOwnerResponse) => {
            setResolution(ownerData);
          }}
        />
      )}

      {resolution.status === 'claimed' && (
        <ArtworkCanvas
          tagId={tag_id}
          item={resolution.item}
          entry={resolution.role === 'owner' ? resolution.entry : undefined}
          canEdit={resolution.can_edit}
          onRefreshRole={reloadTag}
        />
      )}
    </div>
  );
}
