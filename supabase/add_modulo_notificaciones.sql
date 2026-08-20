-- Permite controlar el acceso al módulo Notificaciones por usuario.
-- Agrega 'notificaciones' al CHECK constraint de usuario_modulos
-- y 'lista_precios' que faltaba en migraciones previas.

ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad',
    'notificaciones'
  ));
