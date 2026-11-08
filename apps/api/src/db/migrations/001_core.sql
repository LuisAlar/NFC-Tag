-- Core schema: tenants, items, tags, entries (docs/data-model.md).
--
-- Additions over the data-model doc:
--   * items.kind: which experience a tap opens ('artwork' today, 'gift' later).
--     Validated in code, not with a CHECK, so adding a kind needs no migration.
--   * items.image_url is nullable: an item can exist before (or without) a
--     stored photo, e.g. while object storage isn't configured, and a gift's
--     images will live in their own table rather than one column.

CREATE TABLE IF NOT EXISTS tenants (
    id           VARCHAR(36) PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    slug         VARCHAR(100) UNIQUE NOT NULL,
    theme_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
    id                   VARCHAR(36) PRIMARY KEY,
    tenant_id            VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind                 VARCHAR(32) NOT NULL DEFAULT 'artwork',
    title                VARCHAR(255) NOT NULL,
    artist               VARCHAR(255),
    year                 VARCHAR(50),
    image_url            TEXT,
    context              JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_recognition_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
    id               VARCHAR(32) PRIMARY KEY, -- NanoID handle written to the chip
    tenant_id        VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    item_id          VARCHAR(36) UNIQUE REFERENCES items(id) ON DELETE SET NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'unclaimed'
                     CHECK (status IN ('unclaimed', 'registered', 'active', 'archived')),
    owner_token_hash CHAR(64), -- SHA-256 hex of the device secret
    claimed_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
    id         VARCHAR(36) PRIMARY KEY,
    item_id    VARCHAR(36) UNIQUE NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tenant_id  VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prompts    JSONB NOT NULL DEFAULT '[]'::jsonb,
    content    JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- tags.item_id and entries.item_id are UNIQUE, which already gives them an index.
CREATE INDEX IF NOT EXISTS idx_tags_tenant_id ON tags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_tenant_id ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entries_tenant_id ON entries(tenant_id);
