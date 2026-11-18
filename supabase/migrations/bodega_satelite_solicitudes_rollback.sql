-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de bodega_satelite_solicitudes.sql (fase 2 de las bodegas satélite)
-- ════════════════════════════════════════════════════════════════════════════
-- DEJA el módulo como estaba tras bodega_satelite_admin / usuarios_panel (fases 0, 1 y 1b).
-- BORRA los datos de la fase 2: solicitudes, los movimientos SALIDA_MUESTRA / SALIDA_DEVOLUCION_PRINCIPAL
-- (la existencia de las bodegas vuelve a subir por esas salidas), las series SM/SC y los avisos de solicitudes.
-- Si hay devoluciones o muestras reales, hágase un respaldo (Backup) antes.
-- No toca nada de la principal.
-- Fecha: 2026-11-18
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Funciones nuevas
DROP FUNCTION IF EXISTS public.bodega_crear_solicitud(bigint, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.bodega_registrar_devolucion(bigint, jsonb, text, text, date);
DROP FUNCTION IF EXISTS public.bodega_cancelar_solicitud(bigint, text);
DROP FUNCTION IF EXISTS public.bodega_solicitudes(bigint);
DROP FUNCTION IF EXISTS public.bodega_principal_permisos();
DROP FUNCTION IF EXISTS public.bodega_solicitudes_principal(text);
DROP FUNCTION IF EXISTS public.bodega_solicitud_atender(bigint, text, text, text);
DROP FUNCTION IF EXISTS public.bodega_supervision_resumen();
DROP FUNCTION IF EXISTS public._bodega_principal_ver(bigint);
DROP FUNCTION IF EXISTS public._bodega_principal_atiende(bigint, text);
DROP FUNCTION IF EXISTS public._bodega_atendedores(bigint, text);
DROP FUNCTION IF EXISTS public._bodega_avisar_solicitud(bigint, text, text, text, text);
DROP FUNCTION IF EXISTS public._bodega_lineas_cambio(jsonb);
DROP FUNCTION IF EXISTS public._bodega_solicitud_json(bigint);
DROP FUNCTION IF EXISTS public._bodega_anular_mov_solicitud(bigint, text, text);

-- 2. Datos de la fase 2
DELETE FROM public.notificaciones WHERE modulo = 'bodegas' AND referencia ~ '^BOD-.+-(SM|SC|DV)-[0-9]+$';
ALTER TABLE public."BodegaMovimientos" DISABLE TRIGGER trg_bodega_mov_guard;
DELETE FROM public."BodegaMovimientos" WHERE tipo IN ('SALIDA_MUESTRA', 'SALIDA_DEVOLUCION_PRINCIPAL');
ALTER TABLE public."BodegaMovimientos" ENABLE TRIGGER trg_bodega_mov_guard;
DELETE FROM public."BodegaConsecutivos" WHERE tipo IN ('SM', 'SC', 'DV');

-- 3. Libro: vuelve a los tipos anteriores y sin solicitud_id
ALTER TABLE public."BodegaMovimientos" DROP CONSTRAINT IF EXISTS chk_bodega_mov_solicitud;
DROP INDEX IF EXISTS public.ix_bodega_mov_solicitud;
ALTER TABLE public."BodegaMovimientos" DROP COLUMN IF EXISTS solicitud_id;
ALTER TABLE public."BodegaMovimientos" DROP CONSTRAINT IF EXISTS chk_bodega_mov_tipo;
ALTER TABLE public."BodegaMovimientos" ADD CONSTRAINT chk_bodega_mov_tipo CHECK (tipo IN (
  'SALDO_INICIAL', 'ENTRADA_TRASLADO', 'ENTRADA_TRASLADO_BODEGA', 'AJUSTE_SOBRANTE',
  'SALIDA_DESPACHO', 'SALIDA_DEVOLUCION_PRINCIPAL', 'SALIDA_TRASLADO_BODEGA', 'AJUSTE_FALTANTE'));
COMMENT ON TABLE public."BodegaMovimientos" IS
  'Libro de inventario de las bodegas satélite (solo producto terminado bueno). Suma: SALDO_INICIAL, ENTRADA_TRASLADO, ENTRADA_TRASLADO_BODEGA, AJUSTE_SOBRANTE. Resta: SALIDA_DESPACHO, SALIDA_DEVOLUCION_PRINCIPAL, SALIDA_TRASLADO_BODEGA, AJUSTE_FALTANTE. Nada se borra: se anula.';

ALTER TABLE public."BodegaConsecutivos" DROP CONSTRAINT IF EXISTS chk_bodega_consec_tipo;
ALTER TABLE public."BodegaConsecutivos" ADD CONSTRAINT chk_bodega_consec_tipo CHECK (tipo IN ('RS', 'DV', 'TR'));
COMMENT ON TABLE public."BodegaConsecutivos" IS
  'RS = salida/despacho, DV = devolución a la principal (fase 2), TR = traslado entre bodegas. Serie: BOD-<codigo>-<tipo>-0001.';

-- 4. Tabla de solicitudes
DROP TABLE IF EXISTS public."BodegaSolicitudes" CASCADE;

-- 5. Funciones del propio módulo restauradas a su cuerpo anterior
CREATE OR REPLACE FUNCTION public.fn_bodega_mov_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un movimiento de bodega no se borra: se anula con motivo.';
  END IF;
  IF (NEW.bodega_id, NEW.fecha, NEW.tipo, NEW.producto, NEW.presentacion, NEW.cantidad, NEW.documento,
      NEW.origen_remision, NEW.cant_despachada, NEW.contraparte, NEW.observaciones, NEW.conteo_id, NEW.traslado_id)
     IS DISTINCT FROM
     (OLD.bodega_id, OLD.fecha, OLD.tipo, OLD.producto, OLD.presentacion, OLD.cantidad, OLD.documento,
      OLD.origen_remision, OLD.cant_despachada, OLD.contraparte, OLD.observaciones, OLD.conteo_id, OLD.traslado_id) THEN
    RAISE EXCEPTION 'Un movimiento de bodega no se edita: se anula y se registra otro.';
  END IF;
  IF OLD.estado = 'Anulado' AND NEW.estado <> 'Anulado' THEN
    RAISE EXCEPTION 'Un movimiento anulado no se reactiva.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bodega_existencias(p_bodega bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('producto', s.producto, 'presentacion', s.presentacion, 'existencia', s.existencia)
                       ORDER BY s.producto)
        FROM public._bodega_saldos(p_bodega) s WHERE s.existencia <> 0), '[]'::jsonb),
    'en_transito_salida', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'traslado_id', t.id, 'consecutivo', t.consecutivo,
               'destino', bd."Nombre" || COALESCE(' · ' || NULLIF(bd."Municipio", ''), ''),
               'producto', m.producto, 'presentacion', m.presentacion, 'cantidad', m.cantidad)
             ORDER BY t.id, m.producto)
        FROM "BodegaTraslados" t
        JOIN "BodegaMovimientos" m ON m.traslado_id = t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
        JOIN "BodegasConsignacion" bd ON bd.id = t.bodega_destino
       WHERE t.bodega_origen = p_bodega AND t.estado = 'En tránsito'), '[]'::jsonb),
    'por_recibir_bodega', (SELECT count(*) FROM "BodegaTraslados" t WHERE t.bodega_destino = p_bodega AND t.estado = 'En tránsito'),
    'inicial_aplicado', public._bodega_tiene_inicial(p_bodega));
END;
$function$;

NOTIFY pgrst, 'reload schema';
