-- ============================================================
-- Permitir al rol 'comercial' registrar y editar Cambios de Mercancia
--
-- Mismo bug que Devoluciones (ver add_comercial_devoluciones_rls.sql):
-- el boton "Nuevo Cambio" en devoluciones.html es visible para
-- 'comercial' (clase auth-edit-only -> canEdit()), pero
-- CambiosMercancia_insert/_update nunca incluian ese rol -> error de
-- row-level security al guardar.
--
-- El SELECT de CambiosMercancia ya es sin restriccion por rol (toda la
-- empresa ve todo) y no existe una columna de "propietario" tipo
-- comercial_id/responsable_id en esta tabla, asi que se amplia
-- insert/update con el mismo alcance que Devoluciones (toda la
-- empresa). Delete y "gestionar" (generar la remision, RPC
-- generar_remision) quedan intactos: solo personal interno.
--
-- Fecha: 2026-09-28
-- ============================================================

DROP POLICY IF EXISTS "CambiosMercancia_insert" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_insert" ON "CambiosMercancia" FOR INSERT TO authenticated
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial']))
    AND user_has_company("Empresa")
    AND (("Historico" IS NOT TRUE) OR (get_user_role() = 'admin'))
  );

DROP POLICY IF EXISTS "CambiosMercancia_update" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_update" ON "CambiosMercancia" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) AND user_has_company("Empresa"));

NOTIFY pgrst, 'reload schema';
