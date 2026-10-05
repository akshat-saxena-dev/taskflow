-- Track attempts within the current retry cycle separately from cumulative attempts.
-- Run after jobs-schema.sql. Safe to run more than once.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS attempts_in_cycle INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_jobs_attempts_in_cycle'
          AND conrelid = 'jobs'::regclass
    ) THEN
        ALTER TABLE jobs
            ADD CONSTRAINT chk_jobs_attempts_in_cycle CHECK (attempts_in_cycle >= 0);
    END IF;
END
$$;
