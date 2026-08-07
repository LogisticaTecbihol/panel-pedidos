-- Agrega campos de facturación a nivel de línea de pedido.
-- Cuando ambos campos están llenos, el estado de la línea pasa a 'Facturado'.

ALTER TABLE "Pedidos"
  ADD COLUMN IF NOT EXISTS "Num_Factura"   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Fecha_Factura" text DEFAULT '';
