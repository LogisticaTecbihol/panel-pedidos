-- ============================================================
-- FASE 3: Acceso por módulo a nivel de usuario
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- SEGURO: Solo crea la tabla usuario_modulos y sus políticas.
-- Al final SEMBRA todos los módulos actuales a los usuarios existentes
-- (editor/lector) para no romper accesos ya otorgados.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. TABLA: usuario_modulos (many-to-many usuarios ↔ módulos)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usuario_modulos (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo     text NOT NULL
             CHECK (modulo IN (
               'pedidos','ingresos','ordenes','devoluciones',
               'inventario','kardex','muestras','reenvases',
               'lista_precios','reportes','dashboard',
               'muestras_aprobar','ordenes_aprobar',
               'pedidos_editar_cantidad','notificaciones','clientes'
             )),
  PRIMARY KEY (usuario_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_um_usuario ON usuario_modulos(usuario_id);


-- ══════════════════════════════════════════════════════════════
-- 2. FUNCIÓN HELPER: user_has_module(modulo)
--    Admins siempre retornan true.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION user_has_module(p_modulo text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol text;
BEGIN
  IF p_modulo IS NULL OR TRIM(p_modulo) = '' THEN
    RETURN true;
  END IF;

  SELECT rol INTO v_rol FROM usuarios
  WHERE id = auth.uid() AND activo = true;

  IF v_rol IS NULL THEN RETURN false; END IF;
  IF v_rol = 'admin' THEN RETURN true; END IF;

  RETURN EXISTS(
    SELECT 1 FROM usuario_modulos
    WHERE usuario_id = auth.uid() AND modulo = TRIM(p_modulo)
  );
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 3. ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

ALTER TABLE usuario_modulos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "um_select_own"    ON usuario_modulos;
DROP POLICY IF EXISTS "um_insert_admin"  ON usuario_modulos;
DROP POLICY IF EXISTS "um_update_admin"  ON usuario_modulos;
DROP POLICY IF EXISTS "um_delete_admin"  ON usuario_modulos;

CREATE POLICY "um_select_own"
  ON usuario_modulos FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid() OR get_user_role() = 'admin');

CREATE POLICY "um_insert_admin"
  ON usuario_modulos FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "um_update_admin"
  ON usuario_modulos FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "um_delete_admin"
  ON usuario_modulos FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 4. GRANTS
-- ══════════════════════════════════════════════════════════════

GRANT ALL ON usuario_modulos TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_module(text) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 5. SEED: dar acceso a TODOS los módulos actuales a los usuarios
--    existentes (editor/lector). Los admins no necesitan filas.
--    Idempotente gracias a ON CONFLICT.
-- ══════════════════════════════════════════════════════════════

INSERT INTO usuario_modulos (usuario_id, modulo)
SELECT u.id, m.modulo
FROM usuarios u
CROSS JOIN (VALUES
  ('pedidos'),('ingresos'),('ordenes'),('devoluciones'),
  ('inventario'),('kardex'),('muestras'),('reenvases'),
  ('lista_precios'),('reportes'),('dashboard'),
  ('muestras_aprobar'),('ordenes_aprobar'),
  ('pedidos_editar_cantidad'),('notificaciones'),('clientes')
) AS m(modulo)
WHERE u.rol IN ('editor','lector')
ON CONFLICT (usuario_id, modulo) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- FIN FASE 3
-- ══════════════════════════════════════════════════════════════
