-- Removes the DEFAULT 'hybris' from `codes.property`.
--
-- RUNS ONCE ONLY, and only after the multi-property deploy is live and
-- verified — and only after a backup:
--
--   wrangler d1 export  hybris-files --remote --output=db/backups/pre-property-rebuild.sql
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-30-codes-property-not-null.sql
--   wrangler d1 execute hybris-files --local  --file=db/migrations/2026-08-30-codes-property-not-null.sql
--
-- Why rebuild a whole table over one word: SQLite cannot alter a column
-- default, and with the DEFAULT in place an INSERT that omits `property`
-- produces a working Hybris code instead of an error. Without it, the same
-- INSERT raises "NOT NULL constraint failed" and the seed aborts loudly.
-- On the tenancy boundary, failing loudly is the whole point.
--
-- No BEGIN/COMMIT and no PRAGMA here: D1 manages the transaction itself.

CREATE TABLE codes_new (
  code       TEXT PRIMARY KEY,          -- 8 characters, no hyphen, uppercase
  label      TEXT NOT NULL,             -- who the code was handed to
  level      INTEGER NOT NULL DEFAULT 0,-- see db/schema.sql
  property   TEXT NOT NULL,             -- no DEFAULT, on purpose (see above)
  created_at TEXT NOT NULL
);

INSERT INTO codes_new (code, label, level, property, created_at)
  SELECT code, label, level, property, created_at FROM codes;

DROP TABLE codes;
ALTER TABLE codes_new RENAME TO codes;

-- Superseded by idx_access_log_prop, created in the previous migration.
DROP INDEX IF EXISTS idx_access_log_slug;
