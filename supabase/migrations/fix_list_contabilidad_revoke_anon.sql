-- Corregir hallazgo medio: list_contabilidad_por_empresa() ejecutable por anon
-- Sin autenticación, cualquier persona podía obtener UUIDs de usuarios
-- de contabilidad y las empresas donde trabajan (reconocimiento).
-- Ejecutado en producción el 2026-08-29. Se versiona como documentación del
-- estado real de la BD (fuera del historial de migraciones de Supabase); no
-- re-ejecutar a ciegas.

REVOKE EXECUTE ON FUNCTION public.list_contabilidad_por_empresa() FROM anon;
