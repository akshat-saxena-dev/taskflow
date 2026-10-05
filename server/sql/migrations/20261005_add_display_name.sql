-- Add persistent display names without changing existing authentication records.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);

-- Give existing users a stable display name derived from their email prefix.
UPDATE users
SET display_name = COALESCE(NULLIF(BTRIM(display_name), ''), NULLIF(LEFT(SPLIT_PART(email, '@', 1), 50), ''), 'User')
WHERE display_name IS NULL OR BTRIM(display_name) = '';
