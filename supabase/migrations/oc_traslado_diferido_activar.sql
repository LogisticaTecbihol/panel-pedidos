-- ════════════════════════════════════════════════════════════════════════════
-- OC de traslado «DIFERIDAS» (parte 3 de 3): ACTIVACIÓN.
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere oc_traslado_diferido.sql y tramitar_traslado_oc.sql.
-- ESTA parte es la que cambia el comportamiento: desde que se aplica, toda OC de traslado ligada a un
-- pedido (pedido_id) que se cree nace «diferida» y ya NO se puede legalizar a mano; y las ya existentes
-- que estén aprobadas (o por aprobar) y sin legalizar pasan a ser diferidas.
-- → Aplicarla justo cuando se publique el código nuevo de Pedidos y Órdenes. Con el código viejo
--   publicado, esas OC no se podrían legalizar ni despachar (el código viejo no sabe tramitarlas).
--
-- 1. Trigger BEFORE INSERT trg_oc_diferida_alta: marca Traslado_Diferido = (Tipo='Traslado' AND
--    pedido_id IS NOT NULL) en toda fila nueva (el cliente no decide) y no deja que una diferida nazca
--    ya legalizada (remisiones o Cerrada) salvo el RPC de trámite (que inserta las piezas) o SQL directo.
-- 2. Backfill (idempotente): OC Traslado con pedido_id, Estado='Abierta', sin remisiones y con
--    Estado_Aprobacion 'Por aprobar' o 'Aprobada'. NO toca las rechazadas, las anuladas ni las ya
--    legalizadas (ya movieron inventario). Al 2026-11-11 eran 2 filas: ids 667 y 668 (GREEN → IASO,
--    150 y 60 ud, aprobadas el 09/11).
--
-- Rollback: oc_traslado_diferido_activar_rollback.sql.
-- Aplicar con apply_migration del MCP de Supabase.
-- Fecha: 2026-11-11
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_oc_diferida_alta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW."Traslado_Diferido" := (NEW."Tipo" = 'Traslado' AND NEW."pedido_id" IS NOT NULL);

  IF NEW."Traslado_Diferido"
     AND COALESCE(current_setting('app.oc_tramite', true), '') <> 'on'
     AND current_user IN ('authenticated', 'anon')
     AND ( COALESCE(btrim(NEW."Remision"), '')        <> ''
        OR COALESCE(btrim(NEW."Remision_Origen"), '') <> ''
        OR COALESCE(NEW."Estado", '') = 'Cerrada' ) THEN
    RAISE EXCEPTION 'Una OC de traslado de un pedido no puede crearse ya legalizada: se legaliza sola al remisionar el pedido.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_oc_diferida_alta ON public."OrdenesCompra";
CREATE TRIGGER trg_oc_diferida_alta
  BEFORE INSERT ON public."OrdenesCompra"
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_diferida_alta();

REVOKE ALL ON FUNCTION public.fn_oc_diferida_alta() FROM PUBLIC, anon, authenticated;

-- ── Backfill ───────────────────────────────────────────────────────────────
DO $bf$
DECLARE
  v_n integer;
BEGIN
  UPDATE public."OrdenesCompra"
     SET "Traslado_Diferido" = true
   WHERE "Tipo" = 'Traslado'
     AND "pedido_id" IS NOT NULL
     AND COALESCE("Estado", '') = 'Abierta'
     AND COALESCE(btrim("Remision"), '') = ''
     AND COALESCE(btrim("Remision_Origen"), '') = ''
     AND "Estado_Aprobacion" IN ('Por aprobar', 'Aprobada')
     AND NOT "Traslado_Diferido";
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'oc_traslado_diferido_activar: % OC marcadas como diferidas', v_n;
END
$bf$;
