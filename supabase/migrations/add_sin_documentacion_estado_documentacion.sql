-- ============================================================
-- Nuevo valor 'Sin documentación' en ClientesUnicos.Estado_Documentacion.
--
-- Distinto de 'Sin revisar' (nunca calificado): 'Sin documentación' = ya se
-- revisó y el cliente no ha entregado ningún documento de cartera. En el
-- módulo Cartera cuenta como pendiente y es el estado más grave.
--
-- Solo se amplía el CHECK; los triggers guard/sync_documentacion_cliente
-- no dependen de la lista de valores.
--
-- Fecha: 2026-10-08
-- ============================================================

ALTER TABLE public."ClientesUnicos"
  DROP CONSTRAINT IF EXISTS "ClientesUnicos_estado_documentacion_chk";
ALTER TABLE public."ClientesUnicos"
  ADD CONSTRAINT "ClientesUnicos_estado_documentacion_chk"
  CHECK ("Estado_Documentacion" IN ('Sin revisar','Sin documentación','Completa y vigente','Incompleta','Desactualizada','Incompleta y desactualizada'));

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_sin_documentacion_estado_documentacion
-- ============================================================
