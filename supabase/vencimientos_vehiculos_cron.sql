-- ============================================================
-- Programa el aviso diario de vencimientos de vehículos (7:00 a. m. hora Colombia).
-- NO es una migración (crea secretos en Vault y programa un job): se ejecuta A MANO en el SQL Editor,
-- una sola vez, DESPUÉS de:
--   1. aplicar create_vehiculos_vencimientos.sql y vehiculos_vencimientos_token_cron.sql
--   2. desplegar la Edge Function  vencimientos-vehiculos-aviso  (sin verificación de JWT)
--   3. poner los secretos de la función (Dashboard > Edge Functions > Secrets):
--      WA_PROVIDER, WA_TOKEN, WA_GROUP_ID  (+ WA_URL y WA_SESSION si usa WAHA o Evolution)
--   4. probar con «Enviar aviso ahora» en la página del módulo
-- Este archivo NO lleva secretos, así que es seguro commitearlo. pg_cron ya está habilitado en el proyecto.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Secreto del cron: nace aquí dentro (64 caracteres al azar) y no se copia a ningún otro sitio ni se muestra:
-- la Edge Function lo valida contra Vault con vv_token_cron_valido(). Si ya existe, no se recrea.
-- Para rotarlo: SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'vencimientos_vehiculos_cron_secret'),
--                                          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
SELECT vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                           'vencimientos_vehiculos_cron_secret')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'vencimientos_vehiculos_cron_secret');

SELECT vault.create_secret('https://opghwfuxrvjpbuxeykxn.supabase.co/functions/v1/vencimientos-vehiculos-aviso',
                           'vencimientos_vehiculos_url')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'vencimientos_vehiculos_url');

-- 12:00 UTC = 7:00 a. m. en Colombia (UTC-5 todo el año, sin horario de verano).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vencimientos-vehiculos-aviso';
END $$;

SELECT cron.schedule(
  'vencimientos-vehiculos-aviso',
  '0 12 * * *',
  $job$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vencimientos_vehiculos_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vencimientos_vehiculos_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- Útiles:
--   SELECT * FROM cron.job WHERE jobname = 'vencimientos-vehiculos-aviso';
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;       -- respuesta de la función
--   SELECT cron.unschedule('vencimientos-vehiculos-aviso');               -- apagarlo
