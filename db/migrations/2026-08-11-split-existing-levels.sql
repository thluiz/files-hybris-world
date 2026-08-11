-- Distribui os 100 códigos genéricos já existentes em quatro faixas de 25,
-- uma por nível. Roda DEPOIS de 2026-08-11-access-levels.sql, que é quem cria
-- a coluna `level`.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-split-existing-levels.sql
--
--   Convidado 001–025 → 10   One-Pager
--   Convidado 026–050 → 20   + Pitch Deck
--   Convidado 051–075 → 30   + Series Bible
--   Convidado 076–100 → 40   + Season One Full Script
--
-- O corte é pelo número do rótulo, não pelo código: assim este arquivo pode
-- ser commitado num repositório público sem carregar nenhum código dentro.
-- "Convidado " tem 10 caracteres, então o número começa na posição 11.
--
-- `level > 0` protege quem foi bloqueado de propósito: um código zerado antes
-- desta migração continua zerado depois dela. Códigos com rótulo nominal (que
-- não começam com "Convidado ") também não são tocados.

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
