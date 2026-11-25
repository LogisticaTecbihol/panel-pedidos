-- ============================================================
-- Vencimientos de vehículos: valida el secreto del cron contra Vault
--
-- El cron llama a la Edge Function con `Authorization: Bearer <secreto>`. El secreto vive SOLO en Vault
-- (nombre 'vencimientos_vehiculos_cron_secret', lo crea supabase/vencimientos_vehiculos_cron.sql con un valor
-- al azar generado en la base) y la función lo valida con esta RPC: no hay que copiarlo a los secretos de
-- la función ni verlo en pantalla. Solo la ejecuta service_role (la Edge Function).
--
-- Idempotente. Aplicar con apply_migration. Fecha: 2026-11-25
-- ============================================================

CREATE OR REPLACE FUNCTION public.vv_token_cron_valido(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
  SELECT coalesce(p_token, '') <> ''
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'vencimientos_vehiculos_cron_secret'
          AND decrypted_secret = p_token
     );
$$;

REVOKE ALL ON FUNCTION public.vv_token_cron_valido(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vv_token_cron_valido(text) TO service_role;

NOTIFY pgrst, 'reload schema';
