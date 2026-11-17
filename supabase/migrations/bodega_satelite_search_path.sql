-- Bodegas satélite — ajuste menor (PARTE 6): fija el search_path de 3 helpers puros (el análisis de
-- seguridad de Supabase marcaba function_search_path_mutable). Solo ALTER FUNCTION: no cambia su lógica.
-- Aplicar DESPUÉS de bodega_satelite_nucleo.sql. Rollback: bodega_satelite_search_path_rollback.sql.
-- Fecha: 2026-11-17
ALTER FUNCTION public._bodega_signo(text)         SET search_path TO 'public';
ALTER FUNCTION public._bodega_presentacion(text)  SET search_path TO 'public';
ALTER FUNCTION public._bodega_fecha_segura(text)  SET search_path TO 'public';
