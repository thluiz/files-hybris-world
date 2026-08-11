-- Migration: `codes.active` becomes `codes.level`.
--
-- RUNS ONCE ONLY. `ALTER TABLE ... ADD COLUMN` is not idempotent: on the
-- second run it stops with "duplicate column name: level", and that is expected.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-access-levels.sql
--   wrangler d1 execute hybris-files --local  --file=db/migrations/2026-08-11-access-levels.sql
--
-- Codes already distributed keep working: whoever was active moves up to
-- level 40 (unlocks all four files), which is exactly what already happened
-- before this change. Downgrading whoever needs to be downgraded is a later,
-- deliberate UPDATE — the migration doesn't decide that for you.
--
-- This migration only ADDS. `active` stays where it was on purpose: it
-- runs BEFORE deploy, and the version live at that moment still reads
-- `active`. Dropping the column here would leave the site broken until the
-- deploy finishes. The `drop-active` migration removes it, afterward.

ALTER TABLE codes ADD COLUMN level INTEGER NOT NULL DEFAULT 0;

UPDATE codes SET level = CASE WHEN active = 1 THEN 40 ELSE 0 END;
