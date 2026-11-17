-- ROLLBACK de bodega_satelite_avisos.sql
-- Borra los avisos del módulo 'bodegas' (el CHECK anterior no los admite) y restaura el CHECK original.
DROP FUNCTION IF EXISTS public._bodega_avisar(bigint, text, text, text);

DELETE FROM public.notificaciones WHERE modulo = 'bodegas';

ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_modulo_check CHECK (
  modulo = ANY (ARRAY['pedidos', 'devoluciones', 'cambios', 'muestras', 'ordenes', 'ingresos',
                      'reenvases', 'kardex', 'reportes', 'crm', 'solicitudes_mercadeo']::text[])
);
