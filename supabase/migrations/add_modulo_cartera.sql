-- Permite controlar el acceso al módulo "Cartera" (bandeja de aprobaciones y
-- bloqueos por cartera) por usuario. Agrega 'cartera' al CHECK constraint de
-- usuario_modulos. La bandeja lee Pedidos y ClientesUnicos, sobre los que el rol
-- 'cartera' ya tiene SELECT por RLS; las escrituras usan las RPC existentes
-- (bloquear_pedido_cartera, resolver_aprobacion_pedido, bloquear_cliente_por_nit).
-- No se siembra a usuarios existentes: el acceso se asigna desde Usuarios.
-- Aplicar con apply_migration (MCP) ANTES de publicar el frontend.

ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad','notificaciones','clientes',
    'productos','reabastecimiento','bodegas_consignacion',
    'cartera'
  ));

NOTIFY pgrst, 'reload schema';
