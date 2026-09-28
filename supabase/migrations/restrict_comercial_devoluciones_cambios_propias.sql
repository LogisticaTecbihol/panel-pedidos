-- ============================================================
-- Restringir el alcance de 'comercial' en Devoluciones y CambiosMercancia
-- a SOLO sus propios registros, igual que Pedidos (comercial_id) y
-- SolicitudMuestras (responsable_id/creado_por).
--
-- Las migraciones add_comercial_devoluciones_rls.sql y
-- add_comercial_cambios_rls.sql (2026-09-28) habilitaron a 'comercial'
-- con alcance de TODA la empresa (igualando el SELECT, que no tenia
-- restriccion por rol). Se corrige a "solo propias": comercial
-- ve/crea/edita unicamente lo que el mismo registro (creado_por =
-- auth.uid()), igual criterio que SolicitudMuestras_select/_insert/
-- _update. El resto de roles (admin/editor/contabilidad/gerente_iaso/
-- remisionador) no cambia: siguen viendo/editando toda la empresa.
--
-- Fecha: 2026-09-28
-- ============================================================

-- 1. Devoluciones -------------------------------------------------

DROP POLICY IF EXISTS "Devoluciones_select" ON "Devoluciones";
CREATE POLICY "Devoluciones_select" ON "Devoluciones"
  FOR SELECT TO authenticated
  USING (
    (user_has_company("Empresa") OR get_user_role() = 'gerente_iaso')
    AND (get_user_role() <> 'comercial' OR creado_por = auth.uid())
  );

DROP POLICY IF EXISTS "Devoluciones_insert" ON "Devoluciones";
CREATE POLICY "Devoluciones_insert" ON "Devoluciones" FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Empresa")
    AND (("Historico" IS NOT TRUE) OR (get_user_role() = 'admin'))
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND creado_por = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Devoluciones_update" ON "Devoluciones";
CREATE POLICY "Devoluciones_update" ON "Devoluciones" FOR UPDATE TO authenticated
  USING (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND creado_por = auth.uid())
    )
  )
  WITH CHECK (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND creado_por = auth.uid())
    )
  );

-- 2. CambiosMercancia ----------------------------------------------

DROP POLICY IF EXISTS "CambiosMercancia_select" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_select" ON "CambiosMercancia"
  FOR SELECT TO authenticated
  USING (
    (user_has_company("Empresa") OR get_user_role() = 'gerente_iaso')
    AND (get_user_role() <> 'comercial' OR creado_por = auth.uid())
  );

DROP POLICY IF EXISTS "CambiosMercancia_insert" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_insert" ON "CambiosMercancia" FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Empresa")
    AND (("Historico" IS NOT TRUE) OR (get_user_role() = 'admin'))
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND creado_por = auth.uid())
    )
  );

DROP POLICY IF EXISTS "CambiosMercancia_update" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_update" ON "CambiosMercancia" FOR UPDATE TO authenticated
  USING (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND creado_por = auth.uid())
    )
  )
  WITH CHECK (
    user_has_company("Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND creado_por = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
