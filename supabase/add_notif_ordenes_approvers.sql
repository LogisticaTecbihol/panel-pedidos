-- 1. Permitir 'ordenes' como módulo en notificaciones
ALTER TABLE notificaciones
  DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;

ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo IN (
    'pedidos','devoluciones','cambios','muestras','ordenes'
  ));

-- 2. RPC para encontrar aprobadores de OC por empresa proveedora.
--    Retorna ids de usuarios que pueden aprobar OC:
--    - Admin (puede aprobar cualquier OC de cualquier empresa), o
--    - Tiene módulo 'ordenes_aprobar' Y la empresa en usuario_empresas.
--    SECURITY DEFINER para leer usuario_modulos y usuario_empresas de otros usuarios.

CREATE OR REPLACE FUNCTION find_oc_approvers(p_empresa text)
RETURNS TABLE(usuario_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT u.id
  FROM usuarios u
  WHERE u.activo = true
    AND (
      u.rol = 'admin'
      OR (
        EXISTS (
          SELECT 1 FROM usuario_modulos um
          WHERE um.usuario_id = u.id AND um.modulo = 'ordenes_aprobar'
        )
        AND EXISTS (
          SELECT 1 FROM usuario_empresas ue
          JOIN empresas e ON e.sigla = ue.empresa_sigla
          WHERE ue.usuario_id = u.id
            AND (e.nombre_completo = p_empresa OR e.sigla = p_empresa)
        )
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION find_oc_approvers(text) TO authenticated;
