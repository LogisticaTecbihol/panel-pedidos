-- Permite controlar el acceso al módulo Productos (catálogo maestro_productos) por usuario.
-- Agrega 'productos' al CHECK constraint de usuario_modulos.
-- No se siembra a usuarios existentes: el acceso se asigna manualmente desde Usuarios.
-- Aplicado como migración remota: add_modulo_productos

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
    'productos'
  ));
