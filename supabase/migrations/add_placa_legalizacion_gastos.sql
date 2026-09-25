-- ============================================================
-- Agrega el campo "Placa" (vehículo usado en la ruta) a la cabecera de
-- Legalización de Gastos.
-- ============================================================

ALTER TABLE public."LegalizacionGastos"
  ADD COLUMN IF NOT EXISTS "Placa" text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
