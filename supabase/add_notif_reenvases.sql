-- Permitir 'reenvases' como módulo en notificaciones
ALTER TABLE notificaciones
  DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;

ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo IN (
    'pedidos','devoluciones','cambios','muestras','ordenes','ingresos','reenvases'
  ));
