-- ============================================================
-- FIX: Políticas RLS de Pedidos - incluir todos los roles
--
-- La migración add_comercial_pedidos.sql redefinió las políticas
-- de Pedidos pero solo incluyó admin/editor/comercial, dejando
-- fuera a contabilidad, gerente_iaso y despachador.
-- Esto causa "new row violates row-level security policy" para
-- esos usuarios al intentar crear/editar pedidos.
-- ============================================================

DROP POLICY IF EXISTS "Pedidos_select" ON "Pedidos";
DROP POLICY IF EXISTS "Pedidos_insert" ON "Pedidos";
DROP POLICY IF EXISTS "Pedidos_update" ON "Pedidos";
DROP POLICY IF EXISTS "Pedidos_delete" ON "Pedidos";

CREATE POLICY "Pedidos_select" ON "Pedidos" FOR SELECT TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor','lector','contabilidad','gerente_iaso','despachador')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );

CREATE POLICY "Pedidos_insert" ON "Pedidos" FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
      OR (get_user_role() = 'comercial' AND "comercial_id" = auth.uid())
    )
  );

CREATE POLICY "Pedidos_update" ON "Pedidos" FOR UPDATE TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  )
  WITH CHECK (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );

CREATE POLICY "Pedidos_delete" ON "Pedidos" FOR DELETE TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
  );
