-- Migração: `codes.active` vira `codes.level`.
--
-- RODA UMA VEZ SÓ. `ALTER TABLE ... ADD COLUMN` não é idempotente: na segunda
-- execução ele para com "duplicate column name: level", e isso é o esperado.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-access-levels.sql
--   wrangler d1 execute hybris-files --local  --file=db/migrations/2026-08-11-access-levels.sql
--
-- Os códigos já distribuídos continuam valendo: quem estava ativo sobe para o
-- nível 40 (abre os quatro arquivos), que é exatamente o que já acontecia antes
-- desta mudança. Rebaixar quem precisa ser rebaixado é um UPDATE posterior e
-- deliberado — a migração não decide isso por você.
--
-- Esta migração só ACRESCENTA. `active` continua onde estava de propósito: ela
-- roda ANTES do deploy, e a versão que está no ar naquele momento ainda lê
-- `active`. Derrubar a coluna aqui deixaria o site quebrado até o deploy
-- terminar. Quem apaga é a migração `drop-active`, depois.

ALTER TABLE codes ADD COLUMN level INTEGER NOT NULL DEFAULT 0;

UPDATE codes SET level = CASE WHEN active = 1 THEN 40 ELSE 0 END;
