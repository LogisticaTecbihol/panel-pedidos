-- ============================================================
-- REVERSIÓN de create_costos_producto.sql
-- Borra la tabla CostosProducto (con los costos manuales que tenga) y su función de apoyo.
-- Los cambios ya registrados en audit_log se conservan.
-- ============================================================
DROP TABLE IF EXISTS public."CostosProducto";
DROP FUNCTION IF EXISTS public.fn_costos_producto_guard();
NOTIFY pgrst, 'reload schema';
