-- ─────────────────────────────────────────────────────────────────────────────
-- CambiosMercancia: cerrar un cambio SIN haber recibido el producto
--
-- En devoluciones.html > Cambios > "Gestionar" ahora hay una opción
-- "Cerrar sin recibir producto" para cambios cuyo producto devuelto nunca llegó.
-- El cambio queda Estado = 'Cerrado' (sale de Pendientes y pasa a Tramitadas),
-- sin Remision_Ingreso, y con una justificación obligatoria.
--
--   Cierre_Sin_Recepcion  true cuando se cerró por esta vía. Además de marcar el
--                         caso en pantalla, evita que el fallback de
--                         _computeMovimientos_Inv (js/existencias.js: "cambios
--                         cerrados antiguos sin remisiones → contar ambos lados")
--                         cuente un cambio sin ninguna remisión como si hubiera
--                         movido inventario.
--   Observacion_Cierre    justificación escrita por quien cierra el cambio.
--
-- Kardex, snapshot de existencias y RPC get_saldos_holding / movs_holding_litros
-- ya exigen la remisión de cada lado, así que no cambian.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CambiosMercancia"
  ADD COLUMN IF NOT EXISTS "Cierre_Sin_Recepcion" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "Observacion_Cierre" text;

-- Refrescar el schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
