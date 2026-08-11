-- Last step of swapping `active` for `level`.
--
-- RUNS ONLY AFTER the deploy with level-based access control is live and
-- tested. The previous version of the site reads `active` on every download;
-- while it's still serving, this column needs to exist.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-drop-active.sql
--
-- Two keys for the same door is one too many. Whoever was revoked already
-- ended up at level 0 in the `access-levels` migration, which is the new way
-- of saying the same thing.

ALTER TABLE codes DROP COLUMN active;
