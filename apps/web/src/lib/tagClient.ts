/**
 * Tag API Client Contract Layer
 *
 * Matches the OpenAPI specification in docs/openapi.yaml.
 * For this initial routing phase, this service resolves tag states using
 * in-memory and mock responses. When the backend API is connected,
 * this file will be updated to make live HTTP requests without
 * changing any consumer components.
 */

export interface ItemContext {
  artist: string | null;
  year: string | null;
  art_movement?: string;
  medium?: string;
  wikipedia_summary: string;
  source_url?: string;
}

export interface Item {
  id: string;
  tenant_id: string;
  title: string;
  artist: string | null;
  year: string | null;
  image_url: string;
  context: ItemContext;
  created_at: string;
  updated_at: string;
}

export interface EntryContent {
  type: string;
  text?: string;
  paragraphs?: string[];
}

export interface Entry {
  id: string;
  item_id: string;
  tenant_id: string;
  prompts: string[];
  content: EntryContent;
  created_at: string;
  updated_at: string;
}

export interface TagUnclaimedResponse {
  status: 'unclaimed';
  tag_id: string;
  tenant_id: string;
  action: 'onboard';
}

export interface TagOwnerResponse {
  status: 'claimed';
  role: 'owner';
  tag_id: string;
  tenant_id: string;
  item: Item;
  entry: Entry;
  can_edit: true;
}

export interface TagGuestResponse {
  status: 'claimed';
  role: 'guest';
  tag_id: string;
  tenant_id: string;
  item: Item;
  can_edit: false;
}

export type TagResolutionResponse =
  | TagUnclaimedResponse
  | TagOwnerResponse
  | TagGuestResponse;

// Default mock database of claimed items
const MOCK_REGISTERED_ITEMS: Record<string, { secret: string; item: Item; entry: Entry }> = {
  tag_art_01: {
    secret: 'secret_owner_art_01_token',
    item: {
      id: 'item_98a72b1',
      tenant_id: 'tenant_01',
      title: 'The Gleaners',
      artist: 'Jean-Francois Millet',
      year: '1857',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Jean-Fran%C3%A7ois_Millet_-_Gleaners_-_Google_Art_Project_2.jpg/640px-Jean-Fran%C3%A7ois_Millet_-_Gleaners_-_Google_Art_Project_2.jpg',
      context: {
        artist: 'Jean-Francois Millet',
        year: '1857',
        art_movement: 'Realism',
        medium: 'Oil on canvas',
        wikipedia_summary: 'The Gleaners is an oil painting by Jean-Francois Millet completed in 1857. It depicts three peasant women gleaning a field of stray stalks of wheat after the harvest. The painting is famous for featuring what were then the lowest ranks of rural society.',
        source_url: 'https://en.wikipedia.org/wiki/The_Gleaners',
      },
      created_at: new Date('2026-09-01T12:00:00Z').toISOString(),
      updated_at: new Date('2026-09-20T15:30:00Z').toISOString(),
    },
    entry: {
      id: 'entry_41f80e',
      item_id: 'item_98a72b1',
      tenant_id: 'tenant_01',
      prompts: [
        'What about the muted rural landscape caught your eye in the thrift store?',
        'Does the quiet dignity of the figures resonate with your own daily routines?'
      ],
      content: {
        type: 'doc',
        paragraphs: [
          'Found this framed print tucked behind an old lamp in a local shop.',
          'The evening light on the field feels peaceful yet heavy. It reminds me to slow down after long coding sessions.'
        ]
      },
      created_at: new Date('2026-09-01T12:00:00Z').toISOString(),
      updated_at: new Date('2026-09-20T15:30:00Z').toISOString(),
    },
  },
};

// Checking dynamically claimed tags stored in session during demo runs
const DYNAMIC_CLAIMS_KEY = 'nfc_dynamic_claims_store';

function getDynamicClaims(): Record<string, { secret: string; item: Item; entry: Entry }> {
  try {
    const raw = sessionStorage.getItem(DYNAMIC_CLAIMS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDynamicClaim(tagId: string, record: { secret: string; item: Item; entry: Entry }): void {
  try {
    const current = getDynamicClaims();
    current[tagId] = record;
    sessionStorage.setItem(DYNAMIC_CLAIMS_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed saving dynamic claim:', err);
  }
}

/**
 * Resolving tag status based on tag_id and client device secret.
 * Simulates the GET /api/tags/{tag_id} endpoint.
 */
export async function resolveTag(
  tagId: string,
  deviceSecret?: string | null
): Promise<TagResolutionResponse> {
  // Simulating 180ms network latency
  await new Promise((resolve) => setTimeout(resolve, 180));

  const dynamicClaims = getDynamicClaims();
  const registered = dynamicClaims[tagId] || MOCK_REGISTERED_ITEMS[tagId];

  if (!registered) {
    return {
      status: 'unclaimed',
      tag_id: tagId,
      tenant_id: 'tenant_01',
      action: 'onboard',
    };
  }

  // Authorizing owner vs guest
  const isOwner = Boolean(deviceSecret && deviceSecret === registered.secret);

  if (isOwner) {
    return {
      status: 'claimed',
      role: 'owner',
      tag_id: tagId,
      tenant_id: registered.item.tenant_id,
      item: registered.item,
      entry: registered.entry,
      can_edit: true,
    };
  }

  return {
    status: 'claimed',
    role: 'guest',
    tag_id: tagId,
    tenant_id: registered.item.tenant_id,
    item: registered.item,
    can_edit: false,
  };
}

/**
 * Simulating the POST /api/items/onboard endpoint.
 * Mints an owner secret and links the item to the tag.
 */
export async function onboardTag(
  tagId: string,
  data: { title: string; artist?: string; year?: string }
): Promise<{ secret: string; response: TagOwnerResponse }> {
  await new Promise((resolve) => setTimeout(resolve, 250));

  const mintedSecret = `secret_${tagId}_${Math.random().toString(36).substring(2, 10)}`;
  const itemId = `item_${Math.random().toString(36).substring(2, 9)}`;
  const entryId = `entry_${Math.random().toString(36).substring(2, 9)}`;

  const newItem: Item = {
    id: itemId,
    tenant_id: 'tenant_01',
    title: data.title || 'Untitled Artwork',
    artist: data.artist || 'Unknown Artist',
    year: data.year || 'Unknown Year',
    image_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=640&auto=format&fit=crop&q=80',
    context: {
      artist: data.artist || 'Unknown Artist',
      year: data.year || 'Unknown Year',
      art_movement: 'Contemporary Discovery',
      medium: 'Canvas print',
      wikipedia_summary: `Newly registered art piece cataloged under tag ${tagId}. Archived for personal journaling and memory keeping.`,
      source_url: 'https://wikipedia.org',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const newEntry: Entry = {
    id: entryId,
    item_id: itemId,
    tenant_id: 'tenant_01',
    prompts: [
      'Where did you discover this piece?',
      'What feeling does this work evoke in your space?'
    ],
    content: {
      type: 'doc',
      paragraphs: ['Just acquired and tagged this piece today. Ready to record thoughts and memories here.']
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  saveDynamicClaim(tagId, { secret: mintedSecret, item: newItem, entry: newEntry });

  return {
    secret: mintedSecret,
    response: {
      status: 'claimed',
      role: 'owner',
      tag_id: tagId,
      tenant_id: 'tenant_01',
      item: newItem,
      entry: newEntry,
      can_edit: true,
    },
  };
}
