-- ============================================================
-- ROLLBACK de create_vehiculos_vencimientos.sql
-- Borra el módulo «Vencimientos de Vehículos» completo (tablas, funciones, permisos).
-- ¡Destruye los datos cargados! Antes: select cron.unschedule('vencimientos-vehiculos-aviso');
-- ============================================================

DROP FUNCTION IF EXISTS public.guardar_vehiculo_vencimiento(bigint, text, text, text, boolean, date, date);
DROP FUNCTION IF EXISTS public.vv_marcar(bigint[]);
DROP FUNCTION IF EXISTS public.vv_pendientes(text);
DROP FUNCTION IF EXISTS public.vv_umbral(int);

DROP TABLE IF EXISTS public."VehiculosVencimientosAvisos";
DROP TABLE IF EXISTS public."VehiculosVencimientosEstado";
DROP TABLE IF EXISTS public."VehiculosVencimientosDocs";
DROP TABLE IF EXISTS public."VehiculosVencimientos";

DROP FUNCTION IF EXISTS public.vv_reset_estado();
DROP FUNCTION IF EXISTS public.vv_normalizar();

-- Permisos: se quitan las asignaciones y las dos claves del CHECK (lista anterior, sin ellas).
DELETE FROM public.usuario_modulos WHERE modulo IN ('vehiculos_vencimientos', 'vehiculos_vencimientos_editar');
ALTER TABLE public.usuario_modulos DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;
ALTER TABLE public.usuario_modulos ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'bodegas_consignacion','cartera','clientes','crm','dashboard','dashboard_rentabilidad',
    'devoluciones','ingresos','inventario','kardex','legalizacion_gastos',
    'legalizacion_gastos_aprobar','lista_precios','muestras','muestras_aprobar','notificaciones',
    'ordenes','ordenes_aprobar','pedidos','pedidos_editar_cantidad','prod_ajustes','prod_compras',
    'prod_consumos_detalle','prod_costos','prod_custodia','prod_entregas','prod_formulas',
    'prod_indicadores','prod_inventario','prod_kardex','prod_maestros','prod_mp_nombres',
    'prod_ordenes','prod_pnc','prod_recepciones','prod_traslados','productos','reabastecimiento',
    'reenvases','reportes','solicitudes_mercadeo','solicitudes_mercadeo_aprobar'
  ]::text[]));

NOTIFY pgrst, 'reload schema';
