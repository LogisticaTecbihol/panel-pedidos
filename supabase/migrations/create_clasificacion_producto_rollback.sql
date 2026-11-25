-- ============================================================
-- Reversión de create_clasificacion_producto.sql
-- Borra la tabla ClasificacionProducto (con las clasificaciones que se hayan editado; el historial
-- de cambios sigue en audit_log). La pestaña Rentabilidad vuelve a mostrar todo como «Otros».
-- ============================================================
DROP TABLE IF EXISTS public."ClasificacionProducto";
DROP FUNCTION IF EXISTS public.fn_clasificacion_producto_guard();
NOTIFY pgrst, 'reload schema';
