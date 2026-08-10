-- Enriquecer ClientesUnicos con empresa, tipo identificación, correo, cupo crédito y plazo
ALTER TABLE "ClientesUnicos"
  ADD COLUMN IF NOT EXISTS "Nombre_Empresa" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Tipo_Identificacion" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Correo_Electronico" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Cupo_Credito" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Plazo_Pago" text DEFAULT '';

-- Índice único parcial para soportar upsert por empresa+Identificacion
CREATE UNIQUE INDEX IF NOT EXISTS "ClientesUnicos_empresa_nit_uq"
  ON "ClientesUnicos" ("Nombre_Empresa", "Identificacion")
  WHERE "Identificacion" IS NOT NULL AND "Identificacion" != '';
