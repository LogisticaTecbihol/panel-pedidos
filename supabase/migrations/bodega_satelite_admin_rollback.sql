-- ROLLBACK de bodega_satelite_admin.sql — borra las RPC de administración. No toca datos.
DROP FUNCTION IF EXISTS public.bodega_admin_buscar_usuario(text);
DROP FUNCTION IF EXISTS public.bodega_admin_guardar_usuario(uuid, text, text, boolean, bigint[]);
DROP FUNCTION IF EXISTS public.bodega_admin_guardar_bodega(bigint, text, date, boolean);
DROP FUNCTION IF EXISTS public.bodega_admin_listar();
DROP FUNCTION IF EXISTS public._bodega_exigir_admin();
