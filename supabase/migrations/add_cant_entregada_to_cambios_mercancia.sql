-- ─────────────────────────────────────────────────────────────────────────────
-- CambiosMercancia: agregar columna Cant_Entregada
--
-- El flujo "Gestionar Cambio" (js/shared.js -> action 'gestionarCambio') escribe
-- Cant_Entregada al asignar inventario a las líneas ENTREGAR de un cambio. La
-- columna existe en Pedidos, Devoluciones y SolicitudMuestras desde el commit
-- eef8a35 (2026-08-16) pero nunca se creó en CambiosMercancia, por lo que
-- PostgREST devolvía:
--   "Could not find the 'Cant_Entregada' column of 'CambiosMercancia' in the
--    schema cache"
--
-- Mismo patrón que las demás tablas: numeric, default 0, nullable.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CambiosMercancia"
  ADD COLUMN IF NOT EXISTS "Cant_Entregada" numeric DEFAULT 0;

-- Refrescar el schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
