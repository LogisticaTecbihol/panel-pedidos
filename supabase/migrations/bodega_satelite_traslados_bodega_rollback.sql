-- ROLLBACK de bodega_satelite_traslados_bodega.sql — borra las funciones de traslados entre bodegas.
-- No toca datos: los BodegaTraslados y sus movimientos ya registrados quedan en las tablas.
DROP FUNCTION IF EXISTS public.bodega_traslados_bodega(bigint);
DROP FUNCTION IF EXISTS public.bodega_cancelar_traslado_bodega(bigint, text);
DROP FUNCTION IF EXISTS public.bodega_recibir_traslado_bodega(bigint, jsonb, text);
DROP FUNCTION IF EXISTS public.bodega_crear_traslado_bodega(bigint, bigint, jsonb, text, date);
DROP FUNCTION IF EXISTS public.bodega_destinos(bigint);
DROP FUNCTION IF EXISTS public._bodega_traslado_json(bigint);
