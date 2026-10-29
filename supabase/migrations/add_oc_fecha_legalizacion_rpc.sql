-- ============================================================
-- Migración: RPC de solo lectura con la hora exacta en que se
-- legalizó una OC de traslado (se cargó su Remisión Destino y/o
-- Origen).
--
-- Para qué: el paquete PDF que se envía a contabilidad al despachar
-- un pedido con entregas parciales debe llevar SOLO los traslados de
-- la última entrega, no los de las entregas anteriores. Como el
-- sistema no guarda qué OC alimentó qué entrega, se asignan por
-- ventana de tiempo: pertenecen a una entrega los traslados legalizados
-- después de la entrega parcial anterior y hasta esa entrega.
--
-- Por qué una función y no una columna: OrdenesCompra no guarda la
-- hora de legalización. "modificado_en" NO sirve (se mueve con
-- cualquier edición posterior, p. ej. la factura; en OC reales
-- asignaba el traslado a una entrega equivocada). La bitácora
-- (audit_log) sí la tiene exacta: las 348 OC de traslado legalizadas
-- a 2026-10-29 tienen su evento. audit_log solo la lee el admin, por
-- eso la función es SECURITY DEFINER y devuelve ÚNICAMENTE la hora.
--
-- Qué devuelve: por cada id de OC visible para el usuario
-- (user_has_company de la empresa destino u origen, igual que
-- pedido_estado_despacho), la hora del PRIMER evento de auditoría en
-- que Remision o Remision_Origen quedó con valor (INSERT: fila
-- completa; UPDATE: la bitácora guarda solo las columnas cambiadas).
-- Si no hay evento (OC anterior a la bitácora) devuelve creado_en.
--
-- NO modifica datos ni tablas. Reversión: add_oc_fecha_legalizacion_rpc_rollback.sql
-- (DROP FUNCTION). Si la función no existe, el panel arma el paquete
-- completo como antes (no se rompe nada).
--
-- Aplicar con apply_migration del MCP de Supabase (no se aplica con el
-- push a GitHub) + NOTIFY pgrst, 'reload schema'.
-- Fecha: 2026-10-29
-- ============================================================

CREATE OR REPLACE FUNCTION oc_fecha_legalizacion(p_oc_ids bigint[])
RETURNS TABLE (
  oc_id         bigint,
  legalizada_en timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    COALESCE(
      (SELECT min(a.created_at)
         FROM public.audit_log a
        WHERE a.tabla = 'OrdenesCompra'
          AND a.registro_id = o.id::text
          AND a.accion IN ('INSERT', 'UPDATE')
          AND (   COALESCE(a.datos_despues->>'Remision', '')        <> ''
               OR COALESCE(a.datos_despues->>'Remision_Origen', '') <> '')),
      o.creado_en
    )
  FROM public."OrdenesCompra" o
  WHERE o.id = ANY(p_oc_ids)
    AND (   public.user_has_company(o."Empresa_Destino")
         OR public.user_has_company(o."Empresa_Origen"));
$$;

REVOKE ALL ON FUNCTION oc_fecha_legalizacion(bigint[]) FROM PUBLIC;
-- Supabase concede EXECUTE a anon por defecto en funciones nuevas de public.
REVOKE EXECUTE ON FUNCTION oc_fecha_legalizacion(bigint[]) FROM anon;
GRANT EXECUTE ON FUNCTION oc_fecha_legalizacion(bigint[]) TO authenticated;

-- ============================================================
-- FIN migración
-- ============================================================
