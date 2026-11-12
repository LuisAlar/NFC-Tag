import type { Item, PublicItem } from '../models/types.js';

/** Strips internal-only fields before an item leaves the server. */
export function publicItem(item: Item): PublicItem {
  const { raw_recognition_data: _internal, ...rest } = item;
  return rest;
}
