-- Corregir hallazgo medio: InventarioFisico sin control de rol ni empresa
-- Las 4 policies solo exigían authenticated — cualquier usuario (lector, comercial)
-- podía insertar, editar y borrar conteos de inventario físico de cualquier empresa.
-- Alineado con el patrón de la tabla Inventario.
-- Ejecutado en producción el 2026-08-29. Se versiona como documentación del
-- estado real de la BD (fuera del historial de migraciones de Supabase); no
-- re-ejecutar a ciegas.

DROP POLICY IF EXISTS invf_select ON "InventarioFisico";
DROP POLICY IF EXISTS invf_insert ON "InventarioFisico";
DROP POLICY IF EXISTS invf_update ON "InventarioFisico";
DROP POLICY IF EXISTS invf_delete ON "InventarioFisico";

CREATE POLICY "invf_select" ON "InventarioFisico"
  FOR SELECT TO authenticated
  USING (user_has_company("Empresa") OR get_user_role() = 'gerente_iaso');

CREATE POLICY "invf_insert" ON "InventarioFisico"
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
    AND user_has_company("Empresa")
  );

CREATE POLICY "invf_update" ON "InventarioFisico"
  FOR UPDATE TO authenticated
  USING (
    get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
    AND user_has_company("Empresa")
  )
  WITH CHECK (
    get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
    AND user_has_company("Empresa")
  );

CREATE POLICY "invf_delete" ON "InventarioFisico"
  FOR DELETE TO authenticated
  USING (
    get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
    AND user_has_company("Empresa")
  );
