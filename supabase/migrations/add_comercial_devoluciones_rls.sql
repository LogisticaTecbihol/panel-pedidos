-- ============================================================
-- Permitir al rol 'comercial' registrar y editar Devoluciones
--
-- Sintoma: un usuario 'comercial' que intenta registrar una devolucion
-- recibe "Error: new row violates row-level security policy for table
-- Devoluciones". La interfaz (canEdit() en js/auth.js) ya le muestra el
-- boton "Nueva Devolucion" y las acciones de edicion, pero las politicas
-- RLS de insert/update nunca incluyeron a 'comercial' entre los roles
-- permitidos.
--
-- El SELECT de Devoluciones ya es sin restriccion por rol (toda la
-- empresa ve todo), asi que se amplia insert/update con el mismo
-- alcance (toda la empresa, no solo "propias"). Delete y el paso de
-- "tramitar" (RPC generar_remision) quedan intactos: solo personal
-- interno puede borrar o generar la remision fisica.
--
-- Fecha: 2026-09-28
-- ============================================================

DROP POLICY IF EXISTS "Devoluciones_insert" ON "Devoluciones";
CREATE POLICY "Devoluciones_insert" ON "Devoluciones" FOR INSERT TO authenticated
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial']))
    AND user_has_company("Empresa")
    AND (("Historico" IS NOT TRUE) OR (get_user_role() = 'admin'))
  );

DROP POLICY IF EXISTS "Devoluciones_update" ON "Devoluciones";
CREATE POLICY "Devoluciones_update" ON "Devoluciones" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) AND user_has_company("Empresa"));

NOTIFY pgrst, 'reload schema';
