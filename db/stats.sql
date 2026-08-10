-- Consultas de leitura. Rode com `npm run stats`.

-- Downloads por arquivo
SELECT slug, COUNT(*) AS downloads, COUNT(DISTINCT code) AS pessoas
FROM access_log WHERE ok = 1
GROUP BY slug ORDER BY downloads DESC;

-- Quem baixou o quê, mais recente primeiro
SELECT ts, label, slug, country
FROM access_log WHERE ok = 1
ORDER BY ts DESC LIMIT 50;

-- Códigos que nunca foram usados (entregues e não abertos)
SELECT c.label, c.code
FROM codes c
LEFT JOIN access_log a ON a.code = c.code AND a.ok = 1
WHERE a.id IS NULL AND c.active = 1
ORDER BY c.label;

-- Tentativas inválidas por dia: sinal de código vazado ou varredura
SELECT substr(ts, 1, 10) AS dia, COUNT(*) AS tentativas,
       COUNT(DISTINCT ip_hash) AS origens
FROM access_log WHERE ok = 0
GROUP BY dia ORDER BY dia DESC LIMIT 30;
