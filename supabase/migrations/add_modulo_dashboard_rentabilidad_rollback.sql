-- Rollback de add_modulo_dashboard_rentabilidad.sql: vuelve a dejar costos y clasificaciones solo para el
-- administrador y quita la clave 'dashboard_rentabilidad' (borra primero las filas que la usan: si no, el CHECK
-- anterior fallaría). Deja el CHECK con la lista que había antes de la migración.

DROP POLICY IF EXISTS "CostosProducto_select" ON public."CostosProducto";
CREATE POLICY "CostosProducto_select" ON public."CostosProducto" FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "ClasificacionProducto_select" ON public."ClasificacionProducto";
CREATE POLICY "ClasificacionProducto_select" ON public."ClasificacionProducto" FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

DELETE FROM public.usuario_modulos WHERE modulo = 'dashboard_rentabilidad';

ALTER TABLE public.usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE public.usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'bodegas_consignacion','cartera','clientes','crm','dashboard','devoluciones',
    'ingresos','inventario','kardex','legalizacion_gastos','legalizacion_gastos_aprobar','lista_precios',
    'muestras','muestras_aprobar','notificaciones','ordenes','ordenes_aprobar','pedidos','pedidos_editar_cantidad',
    'prod_ajustes','prod_compras','prod_consumos_detalle','prod_costos','prod_custodia','prod_entregas',
    'prod_formulas','prod_indicadores','prod_inventario','prod_kardex','prod_maestros','prod_mp_nombres',
    'prod_ordenes','prod_pnc','prod_recepciones','prod_traslados','productos','reabastecimiento','reenvases',
    'reportes','solicitudes_mercadeo','solicitudes_mercadeo_aprobar'
  ));

NOTIFY pgrst, 'reload schema';
