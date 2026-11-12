-- Pipeline run log.
--
-- One row per pipeline run (e.g. one onboarding of one painting). The full
-- RunRecord from src/services/runlog/types.ts is stored in `record`; the
-- columns beside it are copied out so the common questions are cheap:
--   "show me every failed onboarding this week"
--   "every run for this item, newest first"
--
-- Relationship to items.raw_recognition_data (docs/data-model.md):
-- items keeps the latest result for display; this table keeps every attempt,
-- including re-runs, so history is never overwritten. Store the winning
-- run_id in items.raw_recognition_data->>'run_id' to link the two.

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id               UUID PRIMARY KEY,                       -- RunRecord.runId
    tenant_id        VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    item_id          VARCHAR(36) REFERENCES items(id) ON DELETE SET NULL,
    tag_id           VARCHAR(32) REFERENCES tags(id) ON DELETE SET NULL,
    pipeline_name    VARCHAR(100) NOT NULL,
    pipeline_version VARCHAR(50)  NOT NULL,
    trigger          VARCHAR(50)  NOT NULL,
    status           VARCHAR(20)  NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    started_at       TIMESTAMPTZ  NOT NULL,
    finished_at      TIMESTAMPTZ,
    duration_ms      NUMERIC(12, 1),
    total_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,
    record           JSONB NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_started ON pipeline_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_item ON pipeline_runs (item_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs (status) WHERE status <> 'succeeded';

-- Example: hit rate per step across all runs in the last 30 days.
--
-- SELECT s->>'name' AS step,
--        COUNT(*) FILTER (WHERE s->>'status' IN ('hit','miss','error')) AS ran,
--        ROUND(100.0 * COUNT(*) FILTER (WHERE s->>'status' = 'hit')
--              / NULLIF(COUNT(*) FILTER (WHERE s->>'status' IN ('hit','miss','error')), 0)) AS hit_pct
-- FROM pipeline_runs, jsonb_array_elements(record->'steps') AS s
-- WHERE started_at > NOW() - INTERVAL '30 days'
-- GROUP BY 1
-- ORDER BY 1;
