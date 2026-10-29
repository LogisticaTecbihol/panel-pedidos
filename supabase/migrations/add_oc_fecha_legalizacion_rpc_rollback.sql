-- ============================================================
-- Reversión de add_oc_fecha_legalizacion_rpc.sql
-- Quita la función. No hay datos que deshacer (la función solo lee).
-- Sin ella el panel arma el paquete completo, como antes del cambio.
-- ============================================================

DROP FUNCTION IF EXISTS oc_fecha_legalizacion(bigint[]);

NOTIFY pgrst, 'reload schema';
