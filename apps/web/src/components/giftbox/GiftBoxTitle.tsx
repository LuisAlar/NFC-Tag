interface GiftBoxTitleProps {
  title: string;
  /**
   * The names graphic. Until the SVG exists the title renders as text.
   * Drop the file in src/assets and pass its imported URL here.
   */
  graphicSrc?: string;
}

export function GiftBoxTitle({ title, graphicSrc }: GiftBoxTitleProps) {
  return (
    <h1 className="gift-title">
      {graphicSrc ? (
        <img src={graphicSrc} alt={title} className="gift-title-graphic" />
      ) : (
        <span className="gift-title-text">
          {title.split('&').map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="gift-title-amp">&amp;</span>}
              {part}
            </span>
          ))}
        </span>
      )}
    </h1>
  );
}
