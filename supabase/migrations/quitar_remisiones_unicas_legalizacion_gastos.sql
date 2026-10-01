-- ============================================================
-- Se quita la restricción "una remisión solo puede estar en UNA legalización
-- o envío" (migración remisiones_unicas_legalizacion_gastos.sql).
--
-- Una misma remisión puede aparecer legítimamente en más de un registro (p. ej.
-- la legalización del viaje que la llevó y el envío/flete que la cobra), así que
-- se elimina el trigger y su función. El formulario sigue evitando repetirla
-- DENTRO del mismo registro (validación en js/legalizacion-gastos.js).
--
-- Aplicar con apply_migration (MCP).
-- ============================================================

DROP TRIGGER IF EXISTS trg_01_remisiones_unicas ON public."LegalizacionGastos";
DROP FUNCTION IF EXISTS public.validar_remisiones_unicas_legalizacion();

NOTIFY pgrst, 'reload schema';
