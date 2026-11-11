-- ============================================================
-- Reversión de legalizacion_gastos_cierre_mes.sql
--
-- Quita los triggers, las funciones y la tabla de cierres: Legalización de Gastos queda
-- como antes (cualquier usuario con el módulo escribe en cualquier mes). Los datos de
-- LegalizacionGastos / Items / Empresas no se tocan. Se pierde el registro de los cierres
-- (queda solo lo que ya anotó audit_log).
-- ============================================================

DROP TRIGGER IF EXISTS trg_legalizacion_gastos_cierre_mes ON public."LegalizacionGastos";
DROP TRIGGER IF EXISTS trg_legalizacion_gastos_cierre_mes ON public."LegalizacionGastosItems";
DROP TRIGGER IF EXISTS trg_legalizacion_gastos_cierre_mes ON public."LegalizacionGastosEmpresas";

DROP FUNCTION IF EXISTS public.fn_legalizacion_gastos_cierre_mes();
DROP FUNCTION IF EXISTS public.fn_legalizacion_gastos_hijos_cierre_mes();
DROP FUNCTION IF EXISTS public.legalizacion_gastos_asegurar_fecha_abierta(date);
DROP FUNCTION IF EXISTS public.legalizacion_gastos_fecha_cerrada(date);
DROP FUNCTION IF EXISTS public.legalizacion_gastos_cerrado_hasta();

DROP TABLE IF EXISTS public."LegalizacionGastosCierres";

NOTIFY pgrst, 'reload schema';
