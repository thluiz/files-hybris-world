-- Read-only queries. Run with `npm run stats`.

-- Downloads per file
SELECT slug, COUNT(*) AS downloads, COUNT(DISTINCT code) AS pessoas
FROM access_log WHERE ok = 1
GROUP BY slug ORDER BY downloads DESC;

-- Who downloaded what, most recent first
SELECT ts, label, slug, country
FROM access_log WHERE ok = 1
ORDER BY ts DESC LIMIT 50;

-- Codes that were never used (handed out and not opened)
SELECT c.level, c.label, c.code
FROM codes c
LEFT JOIN access_log a ON a.code = c.code AND a.ok = 1
WHERE a.id IS NULL AND c.level > 0
ORDER BY c.level DESC, c.label;

-- How many codes at each level
SELECT level, COUNT(*) AS codigos
FROM codes GROUP BY level ORDER BY level;

-- Invalid attempts per day: signals a leaked code or a scan
SELECT substr(ts, 1, 10) AS dia, COUNT(*) AS tentativas,
       COUNT(DISTINCT ip_hash) AS origens
FROM access_log WHERE ok = 0
GROUP BY dia ORDER BY dia DESC LIMIT 30;

-- Who hit a file above their own level. Not a leaked code: it's
-- someone requesting material that wasn't granted to them.
SELECT ts, label, slug FROM access_log
WHERE ok = 2 ORDER BY ts DESC LIMIT 50;
