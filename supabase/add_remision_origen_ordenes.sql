-- Añade la columna Remision_Origen a OrdenesCompra.
-- La columna existente "Remision" queda como Remisión Destino en la UI.
ALTER TABLE "OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Remision_Origen" text default '';
