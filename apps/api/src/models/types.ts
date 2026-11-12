/**
 * Domain records and API payload shapes. API payloads use snake_case to match
 * docs/openapi.yaml; the web client consumes them as-is.
 */

export type TagStatus = 'unclaimed' | 'registered' | 'active' | 'archived';

/**
 * Which experience a tag opens. The tap/ownership/entry core is the same for
 * every kind; only onboarding and the UI differ. Add a kind by registering an
 * onboarder in services/onboarding/index.ts.
 */
export const ITEM_KINDS = ['artwork', 'gift'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Fact {
  value: string;
  sourceUrl?: string;
}

export interface ItemContext {
  summary: string;
  source_url?: string;
  page_id?: number;
  extract?: string;
  year?: string;
  /** Every fact the pipeline kept, each with its source. */
  facts?: Record<string, Fact>;
  /** Model guesses, shown as "AI-inferred", never as facts. */
  inferred?: Record<string, string>;
}

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
}

export interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  theme_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  tenant_id: string;
  item_id: string | null;
  /** The experience this tag is meant for, set at provisioning. */
  kind: ItemKind;
  status: TagStatus;
  owner_token_hash: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  tenant_id: string;
  kind: ItemKind;
  title: string;
  artist: string | null;
  year: string | null;
  /** Null when no photo is stored (e.g. object storage not configured yet). */
  image_url: string | null;
  context: ItemContext;
  raw_recognition_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Entry {
  id: string;
  item_id: string;
  tenant_id: string;
  prompts: string[];
  content: TipTapDocument;
  created_at: string;
  updated_at: string;
}

/** One photo in a gift. Public: every tap can read it, only editors write. */
export interface GiftPhoto {
  id: string;
  image_url: string;
  /** Text shown beside the photo. */
  caption: string;
  /** Text shown on the back of the photo. */
  note: string;
  /** YYYY-MM-DD, or null when unknown. */
  taken_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** The public content of a gift item. */
export interface Gift {
  title: string;
  photos: GiftPhoto[];
  updated_at: string;
}

/** Item as served to clients. raw_recognition_data is internal (audit only). */
export type PublicItem = Omit<Item, 'raw_recognition_data'>;

export interface ErrorBody {
  message: string;
  code: string;
}
