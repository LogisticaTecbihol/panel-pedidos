-- Dashboard → «Rentabilidad IASO»: permiso por usuario (SOLO VER).
--
-- Hasta ahora la pestaña era solo del administrador y las dos tablas que usa para costos manuales y
-- clasificaciones (CostosProducto, ClasificacionProducto) solo las leía un administrador (RLS). Esta migración:
--   1) agrega la clave 'dashboard_rentabilidad' al CHECK de usuario_modulos (se asigna desde Usuarios; el admin
--      siempre lo tiene: user_has_module() devuelve true para el rol admin);
--   2) amplía SOLO el SELECT de esas dos tablas a quien tenga el permiso. INSERT / UPDATE / DELETE siguen siendo
--      solo del administrador: quien tiene el permiso ve costos y clasificaciones pero no los edita.
-- Pedidos, OrdenesCompra, RemisionesAnuladas y ListaPrecios no cambian: la pestaña solo calcula IASO y el usuario
-- ya los lee por su empresa (RLS de siempre).
-- La lista del CHECK es la VIGENTE en producción (incluye 'crm' y los 'prod_*' de otros paneles): no quitar ninguna.
-- No se siembra a nadie: el acceso se asigna desde Usuarios (o con un INSERT en usuario_modulos).
-- Aplicar con apply_migration (MCP) ANTES de publicar el frontend. Rollback: add_modulo_dashboard_rentabilidad_rollback.sql

ALTER TABLE public.usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE public.usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'bodegas_consignacion','cartera','clientes','crm','dashboard','dashboard_rentabilidad','devoluciones',
    'ingresos','inventario','kardex','legalizacion_gastos','legalizacion_gastos_aprobar','lista_precios',
    'muestras','muestras_aprobar','notificaciones','ordenes','ordenes_aprobar','pedidos','pedidos_editar_cantidad',
    'prod_ajustes','prod_compras','prod_consumos_detalle','prod_costos','prod_custodia','prod_entregas',
    'prod_formulas','prod_indicadores','prod_inventario','prod_kardex','prod_maestros','prod_mp_nombres',
    'prod_ordenes','prod_pnc','prod_recepciones','prod_traslados','productos','reabastecimiento','reenvases',
    'reportes','solicitudes_mercadeo','solicitudes_mercadeo_aprobar'
  ));

DROP POLICY IF EXISTS "CostosProducto_select" ON public."CostosProducto";
CREATE POLICY "CostosProducto_select" ON public."CostosProducto" FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin' OR public.user_has_module('dashboard_rentabilidad'));

DROP POLICY IF EXISTS "ClasificacionProducto_select" ON public."ClasificacionProducto";
CREATE POLICY "ClasificacionProducto_select" ON public."ClasificacionProducto" FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin' OR public.user_has_module('dashboard_rentabilidad'));

NOTIFY pgrst, 'reload schema';
