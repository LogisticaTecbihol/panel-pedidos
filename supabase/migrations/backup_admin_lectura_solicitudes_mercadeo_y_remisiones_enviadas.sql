-- Backup (backup.html): que el administrador pueda leer TODAS las filas de dos
-- tablas que el módulo de Backup ahora incluye (2026-10-17).
--
-- 1) remisiones_enviadas: la única política de SELECT era select_own
--    (user_id = auth.uid()), así que el admin descargaba solo sus propias filas
--    (40 filas de 5 usuarios) sin ningún aviso. Se agrega una política
--    adicional (permissive) solo para admin; select_own no se toca.
--
-- 2) solicitudes_mercadeo: tenía RLS activo SIN políticas y SIN GRANT a
--    anon/authenticated (solo la Edge Function solicitud-mercadeo, con
--    service_role, la leía y escribía). El backup devolvía 0 filas sin error.
--    Se da GRANT SELECT a authenticated y una política SELECT solo para admin:
--    cualquier otro usuario autenticado sigue sin ver filas (RLS) y anon sigue
--    sin acceso. INSERT/UPDATE/DELETE no se tocan: la escritura sigue siendo
--    exclusiva de la Edge Function.
--
-- Ejecutado en producción el 2026-10-17. Idempotente (DROP IF EXISTS + CREATE).

-- ── 1. remisiones_enviadas ──
DROP POLICY IF EXISTS remisiones_enviadas_select_admin ON public.remisiones_enviadas;
CREATE POLICY remisiones_enviadas_select_admin
  ON public.remisiones_enviadas
  FOR SELECT
  TO authenticated
  USING ((SELECT get_user_role()) = 'admin');

-- ── 2. solicitudes_mercadeo ──
GRANT SELECT ON public.solicitudes_mercadeo TO authenticated;

DROP POLICY IF EXISTS solicitudes_mercadeo_select_admin ON public.solicitudes_mercadeo;
CREATE POLICY solicitudes_mercadeo_select_admin
  ON public.solicitudes_mercadeo
  FOR SELECT
  TO authenticated
  USING ((SELECT get_user_role()) = 'admin');

NOTIFY pgrst, 'reload schema';
