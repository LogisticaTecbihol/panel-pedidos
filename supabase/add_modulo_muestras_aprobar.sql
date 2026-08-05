-- Permite otorgar el permiso 'muestras_aprobar' de forma independiente al rol admin.
-- Un usuario 'editor' con este módulo asignado podrá aprobar/rechazar solicitudes
-- de muestras (validado en cliente por AUTH.canApprove()).
--
-- NOTA: No se re-siembra a usuarios existentes; el permiso se otorga manualmente
-- desde la pantalla Usuarios (o vía INSERT directo en usuario_modulos).

ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'reportes','dashboard',
    'muestras_aprobar'
  ));
