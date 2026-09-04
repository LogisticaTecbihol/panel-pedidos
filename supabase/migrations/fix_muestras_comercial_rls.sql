-- ============================================================
-- Fix: el rol 'comercial' no podía registrar Solicitudes de Muestras
--
-- Síntoma: un usuario 'comercial' que intenta registrar una solicitud
-- recibe "Error: No se pudo asignar el consecutivo: No autorizado"
-- (la excepción del RPC generar_consecutivo_muestra). Aunque se saltara
-- el RPC, el INSERT también fallaría por la política RLS.
--
-- Historia:
--   * add_comercial_muestras.sql (commit f93d166, 2026-08-05) habilitó a
--     'comercial' a crear/ver/editar SUS PROPIAS solicitudes, con el
--     vínculo responsable_id = auth.uid().
--   * add_gerente_iaso_role.sql       (2026-08-20) y
--     add_remisionador_to_all_rls.sql (2026-08-24)
--     reconstruyeron TODAS las políticas RLS de SolicitudMuestras sin
--     conservar la rama de 'comercial'.
--   * add_generar_consecutivo_muestra.sql (2026-09-01) copió al RPC la
--     guardia ya rota (sin 'comercial').
--
-- Este parche restaura el acceso de 'comercial' conservando lo que las
-- migraciones intermedias añadieron (roles contabilidad / gerente_iaso /
-- remisionador y la lectura global de gerente_iaso):
--   * generar_consecutivo_muestra  -> permite 'comercial'
--   * SolicitudMuestras_select      -> 'comercial' ve SOLO las suyas
--   * SolicitudMuestras_insert      -> 'comercial' crea con responsable_id = auth.uid()
--   * SolicitudMuestras_update      -> 'comercial' edita SOLO las suyas
--   * SolicitudMuestras_delete      -> 'comercial' borra SOLO las suyas
--
-- "Suyas" = responsable_id = auth.uid() OR creado_por = auth.uid().
-- El resto de roles queda EXACTAMENTE igual que antes de este parche.
--
-- Fecha: 2026-09-04
-- ============================================================

-- 1. RPC del consecutivo atómico --------------------------------------

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
          AND public.get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) THEN
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

-- 2. Políticas RLS de SolicitudMuestras -------------------------------

-- SELECT: se conserva la visibilidad actual para todos los roles
-- (cualquiera de la empresa + lectura global de gerente_iaso) y solo se
-- restringe a 'comercial' a las solicitudes propias.
DROP POLICY IF EXISTS "SolicitudMuestras_select" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_select" ON "SolicitudMuestras"
  FOR SELECT TO authenticated
  USING (
    (user_has_company("Empresa") OR get_user_role() = 'gerente_iaso')
    AND (
      get_user_role() <> 'comercial'
      OR responsable_id = auth.uid()
      OR creado_por = auth.uid()
    )
  );

DROP POLICY IF EXISTS "SolicitudMuestras_insert" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_insert" ON "SolicitudMuestras"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND responsable_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "SolicitudMuestras_update" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_update" ON "SolicitudMuestras"
  FOR UPDATE TO authenticated
  USING (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND (responsable_id = auth.uid() OR creado_por = auth.uid()))
    )
  )
  WITH CHECK (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND (responsable_id = auth.uid() OR creado_por = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "SolicitudMuestras_delete" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_delete" ON "SolicitudMuestras"
  FOR DELETE TO authenticated
  USING (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND (responsable_id = auth.uid() OR creado_por = auth.uid()))
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
