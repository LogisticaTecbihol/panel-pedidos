-- ROLLBACK de vehiculos_vencimientos_token_cron.sql
-- (Con esto la Edge Function ya no reconoce al cron: apagar antes el job con
--  select cron.unschedule('vencimientos-vehiculos-aviso');)
DROP FUNCTION IF EXISTS public.vv_token_cron_valido(text);
NOTIFY pgrst, 'reload schema';
