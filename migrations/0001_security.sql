-- Apenas estado técnico pseudonimizado. Sem nome, email, IP ou mensagem.
CREATE TABLE IF NOT EXISTS security_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS security_expiry ON security_state(expires);
CREATE TABLE IF NOT EXISTS submission_locks (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  reference TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'retry', 'rejected')),
  lease INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS submission_expiry ON submission_locks(expires);
