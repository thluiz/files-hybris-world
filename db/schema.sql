-- Esquema do D1 `hybris-files`.
-- Idempotente: pode rodar de novo sem apagar nada.

CREATE TABLE IF NOT EXISTS codes (
  code       TEXT PRIMARY KEY,          -- 8 caracteres, sem hífen, maiúsculo
  label      TEXT NOT NULL,             -- a quem o código foi entregue
  level      INTEGER NOT NULL DEFAULT 0,-- 0,10,20,30,40 — abre todo arquivo de
                                        -- nível igual ou menor. O default é 0
                                        -- (não abre nada) de propósito: um
                                        -- INSERT que esqueça a coluna falha
                                        -- fechado, não aberto.
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT,                        -- código digitado (null se veio vazio)
  label    TEXT,                        -- copiado no momento do acesso, de
                                        -- propósito: renomear ou revogar um
                                        -- código depois não reescreve a história
  slug     TEXT NOT NULL,
  ok       INTEGER NOT NULL,            -- 0 = código inválido
                                        -- 1 = autorizado
                                        -- 2 = código válido, nível insuficiente
                                        -- 3 = tentativa de token no painel /stats
                                        --     (slug = '__stats__'), para o freio
                                        --     de força bruta do token
  ts       TEXT NOT NULL,               -- ISO 8601 UTC
  country  TEXT,
  ip_hash  TEXT,                        -- SHA-256(salt + IP): agrupa visitante
                                        -- sem guardar o IP em si
  ua       TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_log_ts   ON access_log (ts);
CREATE INDEX IF NOT EXISTS idx_access_log_slug ON access_log (slug, ok);
-- Sustenta a checagem de força bruta a cada POST.
CREATE INDEX IF NOT EXISTS idx_access_log_ip   ON access_log (ip_hash, ok, ts);
