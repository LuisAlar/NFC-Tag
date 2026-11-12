import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { resolveTag, type TagResolutionResponse, type TagOwnerResponse } from '../lib/tagClient';
import { redeemEditorInvite, resolveGiftTag, type GiftTagResolution } from '../lib/giftClient';
import { getOwnerSecret, setOwnerSecret } from '../lib/storage';
import { OnboardingView } from './OnboardingView';
import { ArtworkCanvas } from './ArtworkCanvas';
import { AppShell } from './AppShell';
import { GiftBoxView } from './giftbox/GiftBoxView';
import { GiftSetup } from './giftbox/GiftSetup';

type Resolution = TagResolutionResponse | GiftTagResolution;

const isGift = (r: Resolution): r is GiftTagResolution => 'kind' in r && r.kind === 'gift';

/** The one-time code from an invite link: /t/{tag_id}#invite={code}. */
function inviteCodeFromHash(): string | null {
  const m = /^#invite=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  return m ? m[1] : null;
}

export function TagDispatcher() {
  const { tag_id } = useParams<{ tag_id: string }>();
  const [searchParams] = useSearchParams();
  // ?guest=1 previews the visitor view without throwing away this device's secret.
  const asGuest = searchParams.has('guest');
  const [loading, setLoading] = useState(true);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const reloadTag = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  // An invite link opened while this tag's page is already showing only changes the hash.
  useEffect(() => {
    window.addEventListener('hashchange', reloadTag);
    return () => window.removeEventListener('hashchange', reloadTag);
  }, [reloadTag]);

  useEffect(() => {
    let ignore = false;
    if (!tag_id) return;

    (async () => {
      // An invite link makes this device an editor before the tag is resolved.
      const code = inviteCodeFromHash();
      if (code) {
        let message: string;
        try {
          setOwnerSecret(tag_id, await redeemEditorInvite(tag_id, code));
          message = 'This phone can now edit.';
        } catch {
          message = 'That invite link was already used or has expired.';
        }
        // Drop the spent code from the address bar and history, even if this effect run was superseded.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        if (ignore) return;
        setNotice(message);
      }

      const secret = asGuest ? null : getOwnerSecret(tag_id);
      // Gift tags are live on the API; anything else still resolves through the mock.
      const res: Resolution = (await resolveGiftTag(tag_id, secret)) ?? (await resolveTag(tag_id, secret));
      if (!ignore) {
        setResolution(res);
        setLoading(false);
      }
    })().catch((err) => {
      if (!ignore) {
        console.error('Error resolving tag:', err);
        setLoading(false);
      }
    });

    return () => {
      ignore = true;
    };
  }, [tag_id, refreshToken, asGuest]);

  if (!tag_id) {
    return (
      <AppShell>
        <div className="flow-card error-card">
          <h3>Missing Tag Parameter</h3>
          <p>No tag ID was provided in the URL.</p>
          <Link to="/" className="action-button secondary">
            Return to Simulator
          </Link>
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flow-card loading-card">
          <div className="loading-spinner"></div>
          <h3>Resolving Tag Lifecycle...</h3>
          <p>
            Looking up tag <code>{tag_id}</code>
          </p>
        </div>
      </AppShell>
    );
  }

  if (!resolution) {
    return (
      <AppShell>
        <div className="flow-card error-card">
          <h3>Resolution Failed</h3>
          <p>Could not resolve state for tag: {tag_id}</p>
          <button onClick={reloadTag} className="action-button secondary">
            Retry
          </button>
        </div>
      </AppShell>
    );
  }

  // The gift is its own full-screen page, without the app shell.
  if (isGift(resolution)) {
    if (resolution.status === 'unclaimed') return <GiftSetup tagId={tag_id} onDone={reloadTag} />;
    return (
      // key: remount when the role changes so edit state never leaks into a guest view.
      <GiftBoxView
        key={`${tag_id}:${resolution.can_edit}`}
        tagId={tag_id}
        gift={resolution.gift}
        canEdit={resolution.can_edit}
        notice={notice}
      />
    );
  }

  return (
    <AppShell>
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
    </AppShell>
  );
}
