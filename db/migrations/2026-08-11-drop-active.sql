-- Última etapa da troca de `active` por `level`.
--
-- RODA SÓ DEPOIS que o deploy com controle de nível estiver no ar e testado.
-- A versão anterior do site lê `active` a cada download; enquanto ela estiver
-- servindo, esta coluna precisa existir.
--
--   wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-drop-active.sql
--
-- Duas chaves para a mesma porta é uma a mais. Quem estava revogado já ficou
-- com nível 0 na migração de `access-levels`, que é a nova forma de dizer a
-- mesma coisa.

ALTER TABLE codes DROP COLUMN active;
