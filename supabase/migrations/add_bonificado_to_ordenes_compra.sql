-- ─────────────────────────────────────────────────────────────────────────────
-- OrdenesCompra: agregar columna Bonificado
--
-- El formulario "Nueva Orden de Compra" (ordenes.html / js/ordenes.js) ahora
-- incluye una columna con checkbox "Bonif." por línea de producto, igual que el
-- formulario de Nuevo Pedido (Pedidos ya tiene la columna "Bonificado" desde el
-- commit eef8a35, 2026-08-16). Al marcarlo se fuerza Valor Unitario = 1.
--
-- shared.js -> action 'agregarOrdenCompra' / 'editarOrdenCompra' escribe este
-- campo. Sin la columna, PostgREST responde:
--   "Could not find the 'Bonificado' column of 'OrdenesCompra' in the schema cache"
--
-- Mismo patrón que Pedidos/Devoluciones/SolicitudMuestras: text, default '', nullable.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Bonificado" text DEFAULT '';

-- Refrescar el schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
