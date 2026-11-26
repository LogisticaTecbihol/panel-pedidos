-- ============================================================
-- pg_net al esquema `extensions` (aplicada en producción el 2026-11-26 como migración remota
-- `pg_net_en_esquema_extensions`).
--
-- pg_net se había creado el 2026-11-25 sin indicar esquema y quedó en `public`; el asesor de seguridad de
-- Supabase lo marca (extension_in_public). No es reubicable (ALTER EXTENSION … SET SCHEMA no aplica), así que
-- se reinstala en `extensions`, como recomienda Supabase. Sus funciones siguen en el esquema `net`
-- (net.http_post), así que el cron 'vencimientos-vehiculos-aviso' no cambia. Nada más dependía de pg_net.
-- Efecto colateral: se pierde el historial de respuestas (net._http_response), que solo sirve para depurar.
-- ============================================================

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;
