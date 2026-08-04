-- ══════════════════════════════════════════════════════════════
-- Tracking de modificaciones de cantidad / líneas nuevas
-- Añade 2 columnas a "Pedidos" para resaltar en la vista principal
-- (todos los usuarios) los pedidos que fueron modificados vía UI.
-- La marca "vista" es local por usuario (localStorage en el cliente).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "Pedidos"
  ADD COLUMN IF NOT EXISTS "Fecha_Modificacion_Cant" timestamptz,
  ADD COLUMN IF NOT EXISTS "Tipo_Modificacion_Cant" text;

COMMENT ON COLUMN "Pedidos"."Fecha_Modificacion_Cant" IS
  'Timestamp de la última modificación relevante (cantidad pedida cambiada o línea nueva agregada) via editar_pedido_completo. Se usa para resaltar el pedido en la vista principal.';
COMMENT ON COLUMN "Pedidos"."Tipo_Modificacion_Cant" IS
  'Tipo de la última modificación relevante: cantidad | linea_nueva | ambos.';
