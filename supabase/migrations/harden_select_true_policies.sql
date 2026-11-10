-- ============================================================
-- Endurecer políticas SELECT abiertas (USING true)
-- Paso 1 del plan "Panel Chía Abago" — redactada y APLICADA 2026-10-27 (apply_migration del MCP)
--
-- Problema: 14 tablas de public tienen una política SELECT para el rol
-- `authenticated` con USING (true). Cualquier usuario con sesión válida de este
-- proyecto Supabase (aunque NO exista en public.usuarios) puede leerlas por la
-- API REST. Hoy eso es solo un riesgo teórico; deja de serlo cuando el proyecto
-- tenga usuarios de otro panel (Chía Abago, schema `abago`).
-- Comprobado en la base viva: un JWT válido sin fila en `usuarios` lee
-- 1.703 ClientesUnicos, 1.098 ListaPrecios, 555 maestro_productos, etc.
--
-- Cambio: USING (true) -> USING ((SELECT get_user_role()) IS NOT NULL).
-- get_user_role() devuelve NULL si el usuario no está en `usuarios` o está
-- inactivo (activo = false). Todos los usuarios activos del holding tienen
-- fila, así que su acceso no cambia. Se usa (SELECT ...) para que Postgres lo
-- evalúe una vez por consulta (initplan) y no una vez por fila.
--
-- NO se modifica `empresas` (también tiene SELECT true, incluso para anon):
-- solo expone siglas y razones sociales y la pantalla de login la puede usar.
--
-- ALTER POLICY cambia la política en el sitio (sin ventana sin política).
-- Reversión: harden_select_true_policies_rollback.sql
-- Aplicar con apply_migration del MCP (el push a GitHub NO la aplica).
-- ============================================================

ALTER POLICY "ActividadesMercadeo_select"        ON public."ActividadesMercadeo"        USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "BitacoraContactoClientes_select"   ON public."BitacoraContactoClientes"   USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "BodegasConsignacion_select"        ON public."BodegasConsignacion"        USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "Clientes_select"                   ON public."Clientes"                   USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "ClientesUnicos_select"             ON public."ClientesUnicos"             USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "Comerciales_select"                ON public."Comerciales"                USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "Consecutivos_select"               ON public."Consecutivos"               USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "ListaPrecios_select"               ON public."ListaPrecios"               USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "apartados_muestra_select"          ON public.apartados_muestra            USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "apartados_pedido_select"           ON public.apartados_pedido             USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "consecutivos_rem_select"           ON public.consecutivos_remisiones      USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "maestro_productos_select"          ON public.maestro_productos            USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "parametros_inventario_select"      ON public.parametros_inventario        USING ((SELECT public.get_user_role()) IS NOT NULL);
ALTER POLICY "solicitudes_reab_select"           ON public.solicitudes_reabastecimiento USING ((SELECT public.get_user_role()) IS NOT NULL);

-- Salvaguarda: si queda alguna política SELECT con USING (true) fuera de
-- `empresas`, la migración entera se revierte (transacción).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'SELECT'
    AND coalesce(qual, '') = 'true'
    AND tablename <> 'empresas';
  IF n > 0 THEN
    RAISE EXCEPTION 'Quedan % políticas SELECT abiertas fuera de empresas', n;
  END IF;
END $$;
