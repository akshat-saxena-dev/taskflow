-- TaskFlow jobs schema for Neon PostgreSQL.
-- Run server/sql/schema.sql first so users(id) and update_updated_at_column() exist.
-- This script does not drop jobs or delete rows. It upgrades the earlier text
-- priority values (low/normal/high/critical) to integer values (0/1/2/3).

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'waiting',
    priority INTEGER NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    attempts_in_cycle INTEGER NOT NULL DEFAULT 0,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_jobs_status CHECK (status IN ('waiting', 'active', 'completed', 'failed', 'delayed', 'cancelled')),
    CONSTRAINT chk_jobs_priority CHECK (priority BETWEEN 0 AND 3),
    CONSTRAINT chk_jobs_attempts CHECK (attempts >= 0),
    CONSTRAINT chk_jobs_attempts_in_cycle CHECK (attempts_in_cycle >= 0)
);

-- Bring forward tables created by the previous TaskFlow schema without losing rows.
ALTER TABLE jobs ALTER COLUMN priority DROP DEFAULT;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_jobs_priority;
ALTER TABLE jobs ALTER COLUMN priority TYPE INTEGER USING (
    CASE priority::text
        WHEN 'low' THEN 0
        WHEN 'normal' THEN 1
        WHEN 'high' THEN 2
        WHEN 'critical' THEN 3
        ELSE priority::text::integer
    END
);
ALTER TABLE jobs ALTER COLUMN priority SET DEFAULT 1;
ALTER TABLE jobs ADD CONSTRAINT chk_jobs_priority CHECK (priority BETWEEN 0 AND 3);
ALTER TABLE jobs ALTER COLUMN attempts SET DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts_in_cycle INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status_created ON jobs(user_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
