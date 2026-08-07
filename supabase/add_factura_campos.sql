-- Agrega campos de facturación a nivel de entrega (remisión).
-- Cuando todas las entregas de una línea tienen factura,
-- el estado pasa a 'Facturado'.

-- Campos en EntregasPedido (por remisión)
ALTER TABLE "EntregasPedido"
  ADD COLUMN IF NOT EXISTS "num_factura"   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fecha_factura" text DEFAULT '';

-- Limpiar columnas que se agregaron por error en Pedidos (por línea)
ALTER TABLE "Pedidos"
  DROP COLUMN IF EXISTS "Num_Factura",
  DROP COLUMN IF EXISTS "Fecha_Factura";
