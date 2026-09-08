-- Permite controlar el acceso al modulo Reabastecimiento (Fase 3) por usuario.
-- Agrega 'reabastecimiento' al CHECK constraint de usuario_modulos.
-- No se siembra a usuarios existentes: el acceso se asigna manualmente desde Usuarios.
-- Aplicado como migracion remota: add_modulo_reabastecimiento

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
    'productos','reabastecimiento'
  ));
