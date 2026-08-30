-- Migration: `codes` and `access_log` gain a `property`.
--
-- RUNS ONCE ONLY. `ALTER TABLE ... ADD COLUMN` is not idempotent: on the
-- second run it stops with "duplicate column name: property", and that is
-- expected.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-30-multi-property.sql
--   wrangler d1 execute hybris-files --local  --file=db/migrations/2026-08-30-multi-property.sql
--
-- This migration only ADDS. It runs BEFORE the multi-property deploy, and the
-- version live at that moment still does `SELECT ... WHERE code = ?` with no
-- property and still inserts into access_log without the column. Both keep
-- working: `codes.property` is filled by the DEFAULT, `access_log.property` is
-- nullable. Nothing here breaks the running site.
--
-- SQLite requires a DEFAULT when adding a NOT NULL column to a populated
-- table, so `DEFAULT 'hybris'` exists only to backfill the rows that predate
-- the concept. It is a FAIL-OPEN TRAP for every future INSERT: a seed that
-- forgets the column mints a working Hybris code in silence. `level` fails
-- closed (DEFAULT 0 opens nothing); `property` would fail open, on the axis
-- that is now the boundary between properties. It is removed by
-- 2026-08-30-codes-property-not-null.sql, AFTER the deploy — run that one the
-- same day.

ALTER TABLE codes      ADD COLUMN property TEXT NOT NULL DEFAULT 'hybris';
ALTER TABLE access_log ADD COLUMN property TEXT;

-- History predating the concept is all Hybris; there was nothing else.
UPDATE access_log SET property = 'hybris' WHERE property IS NULL;

-- Supersedes idx_access_log_slug: every report groups by property first now.
-- The old index is dropped in the second migration, not here — the live
-- version still runs `GROUP BY slug`.
CREATE INDEX IF NOT EXISTS idx_access_log_prop ON access_log (property, slug, ok);
