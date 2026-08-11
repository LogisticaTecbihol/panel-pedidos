-- Agrega columna Empresa_Destino a Reenvases para traslados entre empresas
ALTER TABLE "Reenvases"
  ADD COLUMN IF NOT EXISTS "Empresa_Destino" text DEFAULT '';
