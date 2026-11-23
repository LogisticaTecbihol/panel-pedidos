-- ============================================================
-- REVERSIÓN de legalizacion_gastos_facturas.sql
--
-- Borra la tabla de facturas (y con ella TODAS las facturas registradas: respalda antes si ya hay
-- datos) y sus funciones. No toca nada de las legalizaciones ni conciliar_legalizacion_gastos.
-- Si ya se publicó el código nuevo, hay que volver también al código anterior (pestaña
-- «Conciliación contable» y tarjetas de Facturado / Pendiente).
-- ============================================================
DROP TABLE IF EXISTS public."LegalizacionGastosFacturas" CASCADE;
DROP FUNCTION IF EXISTS public.fn_legalizacion_facturas_guard();
DROP FUNCTION IF EXISTS public.legalizacion_factura_empresa_visible(text);
NOTIFY pgrst, 'reload schema';
