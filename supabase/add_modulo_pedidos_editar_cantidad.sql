-- Permite otorgar el permiso 'pedidos_editar_cantidad' de forma independiente al rol admin.
-- Un usuario con este módulo asignado podrá modificar la columna "Cant. Pedida"
-- en el detalle y edición de pedidos. Sin este permiso el campo queda de solo lectura.
--
-- Los admins siempre tienen acceso (AUTH.hasModule retorna true para admin).
-- No se siembra a usuarios existentes; el permiso se otorga manualmente
-- desde la pantalla Usuarios.

ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad'
  ));
