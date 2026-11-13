import { useState } from 'react';
import { TITLE_ART } from './titleArt';

interface GiftBoxTitleProps {
  /** The typed title. Shown only as the artwork's alt text, or if the artwork fails to load. */
  title: string;
  /** The names artwork. Defaults to TITLE_ART; null shows the placeholder. */
  graphicSrc?: string | null;
}

/**
 * The gift's title band: the hand-drawn names artwork, or a placeholder frame
 * in its place until the artwork exists.
 */
export function GiftBoxTitle({ title, graphicSrc = TITLE_ART }: GiftBoxTitleProps) {
  const [broken, setBroken] = useState(false);

  if (graphicSrc && !broken) {
    return (
      <h1 className="gift-title">
        <img src={graphicSrc} alt={title} className="gift-title-graphic" onError={() => setBroken(true)} />
      </h1>
    );
  }

  if (!graphicSrc) {
    return (
      <h1 className="gift-title">
        <span className="gift-title-placeholder" aria-hidden="true">
          <span className="gift-title-placeholder-heart">♥</span>
        </span>
        <span className="visually-hidden">{title}</span>
      </h1>
    );
  }

  // The artwork failed to load: fall back to the typed title.
  return (
    <h1 className="gift-title">
      <span className="gift-title-text">
        {title.split('&').map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="gift-title-amp">&amp;</span>}
            {part}
          </span>
        ))}
      </span>
    </h1>
  );
}
