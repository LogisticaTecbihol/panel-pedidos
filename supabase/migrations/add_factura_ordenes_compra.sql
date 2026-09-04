-- Agrega campos de facturación a OrdenesCompra, uno por cada remisión
-- (Destino/Entrada y Origen/Salida), porque una línea de OC puede tener
-- ambas remisiones con facturas independientes (empresa origen y destino
-- pueden facturarse por separado en un traslado entre empresas).
ALTER TABLE "OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "num_factura_destino"   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fecha_factura_destino" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "num_factura_origen"    text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fecha_factura_origen"  text DEFAULT '';
