-- ============================================================
-- FASE 4b: Directorio de usuarios para el picker de notificaciones
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- Motivo: la RLS de `usuarios` limita SELECT a "id = auth.uid() OR admin",
-- por lo que un editor/lector no ve a nadie más al abrir el modal
-- "Enviar PDF" ni al resolver el nombre del remitente de una notificación.
--
-- Solución: función SECURITY DEFINER que expone SOLO id/nombre/email/rol
-- de todos los usuarios (activos e inactivos) sin filtrar por RLS.
-- ============================================================


DROP FUNCTION IF EXISTS list_usuarios_directorio();

CREATE OR REPLACE FUNCTION list_usuarios_directorio()
RETURNS TABLE (
  id      uuid,
  nombre  text,
  email   text,
  rol     text,
  activo  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.email, u.rol, u.activo
  FROM usuarios u;
$$;

REVOKE ALL ON FUNCTION list_usuarios_directorio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_usuarios_directorio() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- FIN FASE 4b
-- ══════════════════════════════════════════════════════════════
