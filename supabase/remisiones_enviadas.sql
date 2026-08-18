-- Registro de remisiones enviadas por usuario (para bloqueo persistente del botón)
CREATE TABLE IF NOT EXISTS remisiones_enviadas (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  modulo TEXT NOT NULL,
  referencia TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, modulo, referencia)
);

ALTER TABLE remisiones_enviadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON remisiones_enviadas
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON remisiones_enviadas
  FOR INSERT WITH CHECK (auth.uid() = user_id);
