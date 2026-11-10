-- ============================================================
-- REVERSIÓN de harden_select_true_policies.sql
-- Devuelve las 14 políticas SELECT a su estado anterior: USING (true).
-- Aplicar con apply_migration del MCP si el endurecimiento rompe algo.
-- ============================================================

ALTER POLICY "ActividadesMercadeo_select"        ON public."ActividadesMercadeo"        USING (true);
ALTER POLICY "BitacoraContactoClientes_select"   ON public."BitacoraContactoClientes"   USING (true);
ALTER POLICY "BodegasConsignacion_select"        ON public."BodegasConsignacion"        USING (true);
ALTER POLICY "Clientes_select"                   ON public."Clientes"                   USING (true);
ALTER POLICY "ClientesUnicos_select"             ON public."ClientesUnicos"             USING (true);
ALTER POLICY "Comerciales_select"                ON public."Comerciales"                USING (true);
ALTER POLICY "Consecutivos_select"               ON public."Consecutivos"               USING (true);
ALTER POLICY "ListaPrecios_select"               ON public."ListaPrecios"               USING (true);
ALTER POLICY "apartados_muestra_select"          ON public.apartados_muestra            USING (true);
ALTER POLICY "apartados_pedido_select"           ON public.apartados_pedido             USING (true);
ALTER POLICY "consecutivos_rem_select"           ON public.consecutivos_remisiones      USING (true);
ALTER POLICY "maestro_productos_select"          ON public.maestro_productos            USING (true);
ALTER POLICY "parametros_inventario_select"      ON public.parametros_inventario        USING (true);
ALTER POLICY "solicitudes_reab_select"           ON public.solicitudes_reabastecimiento USING (true);
