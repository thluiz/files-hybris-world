-- Schema for D1 `hybris-files`.
-- Idempotent: can be run again without deleting anything.

CREATE TABLE IF NOT EXISTS codes (
  code       TEXT PRIMARY KEY,          -- 8 characters, no hyphen, uppercase
  label      TEXT NOT NULL,             -- who the code was handed to
  level      INTEGER NOT NULL DEFAULT 0,-- 0,10,20,30,40 — unlocks every file at
                                        -- that level or below. The default is 0
                                        -- (unlocks nothing) on purpose: an
                                        -- INSERT that forgets the column fails
                                        -- closed, not open.
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT,                        -- code as typed (null if submitted empty)
  label    TEXT,                        -- copied at the moment of access, on
                                        -- purpose: renaming or revoking a code
                                        -- later doesn't rewrite history
  slug     TEXT NOT NULL,
  ok       INTEGER NOT NULL,            -- 0 = invalid code
                                        -- 1 = authorized
                                        -- 2 = valid code, insufficient level
                                        -- 3 = token attempt on the /stats panel
                                        --     (slug = '__stats__'), for the
                                        --     token's brute-force brake
  ts       TEXT NOT NULL,               -- ISO 8601 UTC
  country  TEXT,
  ip_hash  TEXT,                        -- SHA-256(salt + IP): groups a visitor
                                        -- without storing the IP itself
  ua       TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_log_ts   ON access_log (ts);
CREATE INDEX IF NOT EXISTS idx_access_log_slug ON access_log (slug, ok);
-- Backs the brute-force check on every POST.
CREATE INDEX IF NOT EXISTS idx_access_log_ip   ON access_log (ip_hash, ok, ts);
