-- Agregar columnas faltantes a ClientesUnicos (la tabla live solo tenía id, Cliente, Identificacion)
ALTER TABLE "ClientesUnicos"
  ADD COLUMN IF NOT EXISTS "Telefono" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Direccion" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Municipio" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Departamento" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Nombre_Empresa" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Tipo_Identificacion" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Correo_Electronico" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Cupo_Credito" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Plazo_Pago" text DEFAULT '';

-- Índice único parcial para soportar upsert por empresa+Identificacion
CREATE UNIQUE INDEX IF NOT EXISTS "ClientesUnicos_empresa_nit_uq"
  ON "ClientesUnicos" ("Nombre_Empresa", "Identificacion")
  WHERE "Identificacion" IS NOT NULL AND "Identificacion" != '';
