-- ============================================================
-- ROLLBACK de vehiculos_vencimientos_campana.sql
-- Quita el aviso por campanita de Vencimientos de vehículos. NO toca el aviso de WhatsApp.
-- Borra los avisos ya creados con módulo 'vehiculos' (el CHECK anterior no los admite).
-- ============================================================

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vencimientos-vehiculos-campana';
END $$;

DROP FUNCTION IF EXISTS public.vv_avisar_campana();
DROP FUNCTION IF EXISTS public.vv_pendientes_campana();

-- El reinicio por renovación vuelve a tocar solo el registro de WhatsApp.
CREATE OR REPLACE FUNCTION public.vv_reset_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW."Fecha_Vencimiento" IS DISTINCT FROM OLD."Fecha_Vencimiento" THEN
    DELETE FROM public."VehiculosVencimientosEstado" WHERE doc_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.vv_reset_estado() FROM public, anon, authenticated;

DROP TABLE IF EXISTS public."VehiculosVencimientosEstadoCampana";

DELETE FROM public.notificaciones WHERE modulo = 'vehiculos';
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'pedidos','devoluciones','cambios','muestras','ordenes','ingresos','reenvases','kardex',
    'reportes','crm','solicitudes_mercadeo','bodegas'
  ]::text[]));

NOTIFY pgrst, 'reload schema';
