-- ============================================================
-- Migración: RPC para envío automático de PDFs a contabilidad
--
-- Devuelve (empresa_sigla, usuario_id) para todos los usuarios
-- activos con rol 'contabilidad'. Usado por el frontend para
-- auto-incluir a contabilidad como destinatario al enviar
-- remisiones PDF en pedidos, ingresos, devoluciones, cambios,
-- muestras y salidas a producción.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- Fecha: 2026-08-28
-- ============================================================

DROP FUNCTION IF EXISTS list_contabilidad_por_empresa();

CREATE OR REPLACE FUNCTION list_contabilidad_por_empresa()
RETURNS TABLE (
  empresa_sigla text,
  usuario_id    uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ue.empresa_sigla, ue.usuario_id
  FROM usuario_empresas ue
  JOIN usuarios u ON u.id = ue.usuario_id
  WHERE u.rol = 'contabilidad'
    AND u.activo = true;
$$;

REVOKE ALL ON FUNCTION list_contabilidad_por_empresa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_contabilidad_por_empresa() TO authenticated;

-- ============================================================
-- FIN migración
-- ============================================================
