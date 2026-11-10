-- ============================================================
-- Rollback de avisar_contabilidad_oc.sql
-- Quita el trigger y las funciones. Los avisos ya enviados a la tabla
-- `notificaciones` NO se borran (son historial de cada usuario).
-- ============================================================

DROP TRIGGER IF EXISTS trg_oc_avisar_contabilidad ON "OrdenesCompra";
DROP FUNCTION IF EXISTS public.fn_oc_avisar_contabilidad();
DROP FUNCTION IF EXISTS public._oc_avisar_contabilidad(text, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public._oc_contabilidad_destinatarios(text, text);
