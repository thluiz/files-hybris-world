-- Distributes the 100 existing generic codes into four bands of 25,
-- one per level. Runs AFTER 2026-08-11-access-levels.sql, which is what
-- creates the `level` column.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-split-existing-levels.sql
--
--   Convidado 001–025 → 10   One-Pager
--   Convidado 026–050 → 20   + Pitch Deck
--   Convidado 051–075 → 30   + Series Bible
--   Convidado 076–100 → 40   + Season One Full Script
--
-- The cut is by the label's number, not the code: that way this file can
-- be committed to a public repository without carrying any code inside it.
-- "Convidado " is 10 characters, so the number starts at position 11.
--
-- `level > 0` protects whoever was deliberately blocked: a code zeroed out
-- before this migration stays zeroed out after it. Codes with a personal
-- label (that don't start with "Convidado ") are also left untouched.

UPDATE codes SET level = 10
WHERE label LIKE 'Convidado %' AND level > 0
  AND CAST(substr(label, 11) AS INTEGER) BETWEEN 1 AND 25;

UPDATE codes SET level = 20
WHERE label LIKE 'Convidado %' AND level > 0
  AND CAST(substr(label, 11) AS INTEGER) BETWEEN 26 AND 50;

UPDATE codes SET level = 30
WHERE label LIKE 'Convidado %' AND level > 0
  AND CAST(substr(label, 11) AS INTEGER) BETWEEN 51 AND 75;

UPDATE codes SET level = 40
WHERE label LIKE 'Convidado %' AND level > 0
  AND CAST(substr(label, 11) AS INTEGER) BETWEEN 76 AND 100;
