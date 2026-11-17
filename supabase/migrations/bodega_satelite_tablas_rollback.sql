-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de bodega_satelite_tablas.sql
-- ⚠️ BORRA todas las tablas Bodega* y sus datos (movimientos, conteos, traslados,
-- usuarios de bodega). Úsalo solo si NO hay datos reales que conservar; si ya se aplicaron
-- las partes siguientes (avisos / nucleo / traslados_bodega / admin), revierte ESAS primero
-- (en orden inverso) porque sus funciones dependen de estas tablas.
-- No toca ninguna tabla de la principal.
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public."BodegaMovimientos"      CASCADE;
DROP TABLE IF EXISTS public."BodegaConteoLineas"     CASCADE;
DROP TABLE IF EXISTS public."BodegaConteos"          CASCADE;
DROP TABLE IF EXISTS public."BodegaTraslados"        CASCADE;
DROP TABLE IF EXISTS public."BodegaConsecutivos"     CASCADE;
DROP TABLE IF EXISTS public."BodegaUsuarioBodegas"   CASCADE;
DROP TABLE IF EXISTS public."BodegaUsuarios"         CASCADE;
DROP TABLE IF EXISTS public."BodegaConfig"           CASCADE;

DROP FUNCTION IF EXISTS public.fn_bodega_mov_guard();
DROP FUNCTION IF EXISTS public.fn_bodega_traslado_misma_empresa();
