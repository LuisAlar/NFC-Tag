-- GiftBox: a tag that opens a set of photos, each with a caption and a note.
--
--   * tags.kind: which experience an unclaimed tag is meant for, set when the
--     tag is provisioned, so the first tap knows which setup screen to show.
--   * gift_photos: a gift's photos. Public to every tap; only editors write.
--   * tag_editors: extra devices allowed to edit, beyond the claiming device
--     (tags.owner_token_hash). Each device has its own secret, so one can be
--     removed without locking out the others.
--   * editor_invites: one-time codes that let a new device mint its secret.

ALTER TABLE tags ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'artwork';

CREATE TABLE IF NOT EXISTS gift_photos (
    id         VARCHAR(36) PRIMARY KEY,
    item_id    VARCHAR(36) NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tenant_id  VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_key  TEXT NOT NULL, -- storage key, for deleting the file
    image_url  TEXT NOT NULL,
    caption    TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    taken_at   DATE,
    position   INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_photos_item ON gift_photos(item_id, position);

CREATE TABLE IF NOT EXISTS tag_editors (
    id         VARCHAR(36) PRIMARY KEY,
    tag_id     VARCHAR(32) NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL, -- SHA-256 hex of the device secret
    label      VARCHAR(60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tag_id, token_hash)
);

CREATE TABLE IF NOT EXISTS editor_invites (
    id         VARCHAR(36) PRIMARY KEY,
    tag_id     VARCHAR(32) NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    code_hash  CHAR(64) UNIQUE NOT NULL, -- SHA-256 hex of the invite code
    label      VARCHAR(60),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
