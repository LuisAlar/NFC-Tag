/**
 * The hand-drawn names artwork shown in place of the typed gift title.
 *
 * The typed title is still saved: it becomes the artwork's alt text (read
 * aloud by screen readers) and shows if the image fails to load.
 *
 *   null     -> a placeholder frame the size of the artwork
 *   a URL    -> the artwork
 *
 * To add the SVG: put it at src/assets/title/luis-raina.svg, then
 *
 *   import luisRaina from '../../assets/title/luis-raina.svg';
 *   export const TITLE_ART: string | null = luisRaina;
 *
 * One artwork covers every gift tag, since there is one gift. If more gifts
 * get their own art later, turn this into a map keyed by tag id.
 */
export const TITLE_ART: string | null = null;
