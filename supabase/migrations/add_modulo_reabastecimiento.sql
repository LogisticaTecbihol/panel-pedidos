-- Fase 3: modulo Reabastecimiento con permiso asignable por usuario.
-- Agrega 'reabastecimiento' al CHECK constraint de usuario_modulos.
-- No se siembra a usuarios existentes: el acceso se asigna manualmente desde Usuarios.
-- Copia de referencia en supabase/add_modulo_reabastecimiento.sql; CHECK canonico
-- en supabase/usuario_modulos.sql.

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

NOTIFY pgrst, 'reload schema';
