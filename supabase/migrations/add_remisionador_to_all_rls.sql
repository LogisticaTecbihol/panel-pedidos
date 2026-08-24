-- ============================================================
-- Add 'remisionador' role to ALL RLS policies where 'editor' exists
-- remisionador = editor + auto-consecutivos
-- ============================================================

-- 1. Reenvases (the reported error)
DROP POLICY IF EXISTS "Reenvases_insert" ON "Reenvases";
CREATE POLICY "Reenvases_insert" ON "Reenvases" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "Reenvases_update" ON "Reenvases";
CREATE POLICY "Reenvases_update" ON "Reenvases" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "Reenvases_delete" ON "Reenvases";
CREATE POLICY "Reenvases_delete" ON "Reenvases" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 2. Devoluciones
DROP POLICY IF EXISTS "Devoluciones_insert" ON "Devoluciones";
CREATE POLICY "Devoluciones_insert" ON "Devoluciones" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "Devoluciones_update" ON "Devoluciones";
CREATE POLICY "Devoluciones_update" ON "Devoluciones" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "Devoluciones_delete" ON "Devoluciones";
CREATE POLICY "Devoluciones_delete" ON "Devoluciones" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 3. Ingresos
DROP POLICY IF EXISTS "Ingresos_insert" ON "Ingresos";
CREATE POLICY "Ingresos_insert" ON "Ingresos" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

DROP POLICY IF EXISTS "Ingresos_update" ON "Ingresos";
CREATE POLICY "Ingresos_update" ON "Ingresos" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

DROP POLICY IF EXISTS "Ingresos_delete" ON "Ingresos";
CREATE POLICY "Ingresos_delete" ON "Ingresos" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

-- 4. Inventario
DROP POLICY IF EXISTS "Inventario_insert" ON "Inventario";
CREATE POLICY "Inventario_insert" ON "Inventario" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "Inventario_update" ON "Inventario";
CREATE POLICY "Inventario_update" ON "Inventario" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "Inventario_delete" ON "Inventario";
CREATE POLICY "Inventario_delete" ON "Inventario" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 5. KardexAjustes
DROP POLICY IF EXISTS "KardexAjustes_insert" ON "KardexAjustes";
CREATE POLICY "KardexAjustes_insert" ON "KardexAjustes" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "KardexAjustes_update" ON "KardexAjustes";
CREATE POLICY "KardexAjustes_update" ON "KardexAjustes" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "KardexAjustes_delete" ON "KardexAjustes";
CREATE POLICY "KardexAjustes_delete" ON "KardexAjustes" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 6. KardexNC
DROP POLICY IF EXISTS "KardexNC_insert" ON "KardexNC";
CREATE POLICY "KardexNC_insert" ON "KardexNC" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "KardexNC_update" ON "KardexNC";
CREATE POLICY "KardexNC_update" ON "KardexNC" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "KardexNC_delete" ON "KardexNC";
CREATE POLICY "KardexNC_delete" ON "KardexNC" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 7. CambiosMercancia
DROP POLICY IF EXISTS "CambiosMercancia_insert" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_insert" ON "CambiosMercancia" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "CambiosMercancia_update" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_update" ON "CambiosMercancia" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "CambiosMercancia_delete" ON "CambiosMercancia";
CREATE POLICY "CambiosMercancia_delete" ON "CambiosMercancia" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 8. OrdenesCompra
DROP POLICY IF EXISTS "OrdenesCompra_insert" ON "OrdenesCompra";
CREATE POLICY "OrdenesCompra_insert" ON "OrdenesCompra" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

DROP POLICY IF EXISTS "OrdenesCompra_update" ON "OrdenesCompra";
CREATE POLICY "OrdenesCompra_update" ON "OrdenesCompra" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

DROP POLICY IF EXISTS "OrdenesCompra_delete" ON "OrdenesCompra";
CREATE POLICY "OrdenesCompra_delete" ON "OrdenesCompra" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

-- 9. Productos
DROP POLICY IF EXISTS "Productos_insert" ON "Productos";
CREATE POLICY "Productos_insert" ON "Productos" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Nombre_Empresa"));

DROP POLICY IF EXISTS "Productos_update" ON "Productos";
CREATE POLICY "Productos_update" ON "Productos" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Nombre_Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Nombre_Empresa"));

DROP POLICY IF EXISTS "Productos_delete" ON "Productos";
CREATE POLICY "Productos_delete" ON "Productos" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Nombre_Empresa"));

-- 10. RemisionesAnuladas
DROP POLICY IF EXISTS "RemisionesAnuladas_insert" ON "RemisionesAnuladas";
CREATE POLICY "RemisionesAnuladas_insert" ON "RemisionesAnuladas" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "RemisionesAnuladas_update" ON "RemisionesAnuladas";
CREATE POLICY "RemisionesAnuladas_update" ON "RemisionesAnuladas" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "RemisionesAnuladas_delete" ON "RemisionesAnuladas";
CREATE POLICY "RemisionesAnuladas_delete" ON "RemisionesAnuladas" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 11. SolicitudMuestras
DROP POLICY IF EXISTS "SolicitudMuestras_insert" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_insert" ON "SolicitudMuestras" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "SolicitudMuestras_update" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_update" ON "SolicitudMuestras" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

DROP POLICY IF EXISTS "SolicitudMuestras_delete" ON "SolicitudMuestras";
CREATE POLICY "SolicitudMuestras_delete" ON "SolicitudMuestras" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) AND user_has_company("Empresa"));

-- 12. Consecutivos
DROP POLICY IF EXISTS "Consecutivos_insert" ON "Consecutivos";
CREATE POLICY "Consecutivos_insert" ON "Consecutivos" FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

DROP POLICY IF EXISTS "Consecutivos_update" ON "Consecutivos";
CREATE POLICY "Consecutivos_update" ON "Consecutivos" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

DROP POLICY IF EXISTS "Consecutivos_delete" ON "Consecutivos";
CREATE POLICY "Consecutivos_delete" ON "Consecutivos" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

-- 13. ClientesUnicos
DROP POLICY IF EXISTS "ClientesUnicos_insert" ON "ClientesUnicos";
CREATE POLICY "ClientesUnicos_insert" ON "ClientesUnicos" FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

DROP POLICY IF EXISTS "ClientesUnicos_update" ON "ClientesUnicos";
CREATE POLICY "ClientesUnicos_update" ON "ClientesUnicos" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

DROP POLICY IF EXISTS "ClientesUnicos_delete" ON "ClientesUnicos";
CREATE POLICY "ClientesUnicos_delete" ON "ClientesUnicos" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

-- 14. maestro_productos
DROP POLICY IF EXISTS "maestro_productos_insert" ON "maestro_productos";
CREATE POLICY "maestro_productos_insert" ON "maestro_productos" FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

DROP POLICY IF EXISTS "maestro_productos_update" ON "maestro_productos";
CREATE POLICY "maestro_productos_update" ON "maestro_productos" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

DROP POLICY IF EXISTS "maestro_productos_delete" ON "maestro_productos";
CREATE POLICY "maestro_productos_delete" ON "maestro_productos" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

-- 15. consecutivos_remisiones (critical for remisionador auto-consecutivos)
DROP POLICY IF EXISTS "consecutivos_rem_update" ON "consecutivos_remisiones";
CREATE POLICY "consecutivos_rem_update" ON "consecutivos_remisiones" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','despachador','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','despachador','remisionador']));

-- 16. Pedidos
DROP POLICY IF EXISTS "Pedidos_select" ON "Pedidos";
CREATE POLICY "Pedidos_select" ON "Pedidos" FOR SELECT TO authenticated
  USING (user_has_company("Nombre_Empresa") AND (
    (get_user_role() = ANY (ARRAY['admin','editor','lector','contabilidad','gerente_iaso','despachador','remisionador']))
    OR ((get_user_role() = 'comercial') AND (comercial_id = auth.uid() OR creado_por = auth.uid()))
  ));

DROP POLICY IF EXISTS "Pedidos_insert" ON "Pedidos";
CREATE POLICY "Pedidos_insert" ON "Pedidos" FOR INSERT TO authenticated
  WITH CHECK (user_has_company("Nombre_Empresa") AND (
    (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
    OR ((get_user_role() = 'comercial') AND (comercial_id = auth.uid()))
  ));

DROP POLICY IF EXISTS "Pedidos_update" ON "Pedidos";
CREATE POLICY "Pedidos_update" ON "Pedidos" FOR UPDATE TO authenticated
  USING (user_has_company("Nombre_Empresa") AND (
    (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
    OR ((get_user_role() = 'comercial') AND (comercial_id = auth.uid() OR creado_por = auth.uid()))
  ))
  WITH CHECK (user_has_company("Nombre_Empresa") AND (
    (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
    OR ((get_user_role() = 'comercial') AND (comercial_id = auth.uid() OR creado_por = auth.uid()))
  ));

DROP POLICY IF EXISTS "Pedidos_delete" ON "Pedidos";
CREATE POLICY "Pedidos_delete" ON "Pedidos" FOR DELETE TO authenticated
  USING (user_has_company("Nombre_Empresa") AND (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])));

-- 17. EntregasPedido
DROP POLICY IF EXISTS "EntregasPedido_select" ON "EntregasPedido";
CREATE POLICY "EntregasPedido_select" ON "EntregasPedido" FOR SELECT TO authenticated
  USING ((user_has_company(empresa_pedido) OR user_has_company(empresa_stock)) AND (
    (get_user_role() = ANY (ARRAY['admin','editor','lector','remisionador']))
    OR ((get_user_role() = 'comercial') AND EXISTS (
      SELECT 1 FROM "Pedidos" p WHERE p.id = "EntregasPedido".pedido_id AND (p.comercial_id = auth.uid() OR p.creado_por = auth.uid())
    ))
  ));

DROP POLICY IF EXISTS "EntregasPedido_insert" ON "EntregasPedido";
CREATE POLICY "EntregasPedido_insert" ON "EntregasPedido" FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','remisionador'])) AND (user_has_company(empresa_pedido) OR user_has_company(empresa_stock)));

DROP POLICY IF EXISTS "EntregasPedido_update" ON "EntregasPedido";
CREATE POLICY "EntregasPedido_update" ON "EntregasPedido" FOR UPDATE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','remisionador'])) AND (user_has_company(empresa_pedido) OR user_has_company(empresa_stock)))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin','editor','remisionador'])) AND (user_has_company(empresa_pedido) OR user_has_company(empresa_stock)));

DROP POLICY IF EXISTS "EntregasPedido_delete" ON "EntregasPedido";
CREATE POLICY "EntregasPedido_delete" ON "EntregasPedido" FOR DELETE TO authenticated
  USING ((get_user_role() = ANY (ARRAY['admin','editor','remisionador'])) AND (user_has_company(empresa_pedido) OR user_has_company(empresa_stock)));
