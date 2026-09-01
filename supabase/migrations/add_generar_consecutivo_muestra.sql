-- ============================================================
-- Migración: consecutivo atómico para Solicitud de Muestras
--
-- Problema: js/muestras.js calculaba el consecutivo en el navegador
-- (getNextConsecutivo = max(Consecutivo)+1 sobre las filas cargadas en
-- memoria). Si la pestaña llevaba rato abierta —o dos personas creaban
-- una solicitud a la vez para la misma empresa— el número se repetía.
-- Ej.: GREEN consecutivo 10 quedó en las solicitudes 114 y 117; como el
-- listado agrupa por Empresa+Consecutivo, la 117 (pendiente) quedó
-- escondida detrás de la 114 (despachada) y no aparecía en "Pendientes".
--
-- Esta función asigna el número dentro de la base, con lock por empresa,
-- ignorando lo que mande el cliente. La usa la acción agregarMuestra
-- (js/shared.js) al crear una solicitud nueva.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- Fecha: 2026-09-01
-- ============================================================

CREATE OR REPLACE FUNCTION public.generar_consecutivo_muestra(p_empresa_nombre text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo int;
BEGIN
  IF p_empresa_nombre IS NULL OR TRIM(p_empresa_nombre) = '' THEN
    RAISE EXCEPTION 'Empresa requerida';
  END IF;

  -- Mismo criterio que la política RLS SolicitudMuestras_insert
  IF NOT (public.user_has_company(p_empresa_nombre)
          AND public.get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Serializa las creaciones simultáneas de la misma empresa para que
  -- dos llamadas seguidas no lean el mismo máximo. Se libera al terminar
  -- la transacción del RPC.
  PERFORM pg_advisory_xact_lock(hashtext('muestra_consec:' || TRIM(p_empresa_nombre)));

  SELECT COALESCE(MAX(("Consecutivo")::int), 0) + 1
    INTO v_nuevo
    FROM "SolicitudMuestras"
   WHERE TRIM("Empresa") = TRIM(p_empresa_nombre)
     AND "Consecutivo" ~ '^[0-9]+$';

  RETURN v_nuevo::text;
END;
$$;

REVOKE ALL ON FUNCTION public.generar_consecutivo_muestra(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generar_consecutivo_muestra(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.generar_consecutivo_muestra(text) TO authenticated;

-- ============================================================
-- FIN migración
-- ============================================================
