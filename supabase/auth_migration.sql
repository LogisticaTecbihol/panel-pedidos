-- ============================================================
-- FASE 1: Sistema de Autenticación, Roles y Acceso por Empresa
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- SEGURO: Solo crea tablas y funciones NUEVAS.
-- No modifica ni elimina nada existente.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. TABLA: empresas (catálogo de las 5 empresas del holding)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS empresas (
  sigla           text PRIMARY KEY,
  nombre_completo text NOT NULL UNIQUE,
  activa          boolean NOT NULL DEFAULT true
);

INSERT INTO empresas (sigla, nombre_completo) VALUES
  ('PARCELAR', 'PARCELAR DE COLOMBIA SAS'),
  ('GREEN',    'GREEN AGROSOLUCIONES DE COLOMBIA SAS'),
  ('RESO',     'SOLUCIONES INTEGRALES RESO SAS'),
  ('IASO',     'INSUMOS AGROPECUARIOS SOSTENIBLES SAS'),
  ('IAS',      'INSUMOS AGROPECUARIOS DE LA SABANA SAS')
ON CONFLICT (sigla) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- 2. TABLA: usuarios (perfil de cada usuario autenticado)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usuarios (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  nombre     text NOT NULL DEFAULT '',
  rol        text NOT NULL DEFAULT 'lector'
             CHECK (rol IN ('admin', 'editor', 'lector')),
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);


-- ══════════════════════════════════════════════════════════════
-- 3. TABLA: usuario_empresas (many-to-many usuarios ↔ empresas)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usuario_empresas (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_sigla text NOT NULL REFERENCES empresas(sigla) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, empresa_sigla)
);

CREATE INDEX IF NOT EXISTS idx_ue_usuario ON usuario_empresas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ue_empresa ON usuario_empresas(empresa_sigla);


-- ══════════════════════════════════════════════════════════════
-- 4. FUNCIONES HELPER para RLS
-- ══════════════════════════════════════════════════════════════

-- 4.1 get_user_role(): retorna el rol del usuario autenticado
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM usuarios
  WHERE id = auth.uid() AND activo = true;
$$;

-- 4.2 user_has_company(empresa): verifica si el usuario tiene acceso
--     Acepta tanto sigla ('PARCELAR') como nombre completo ('PARCELAR DE COLOMBIA SAS')
--     Admins siempre retornan true
CREATE OR REPLACE FUNCTION user_has_company(p_empresa text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol text;
  v_sigla text;
  v_found boolean;
BEGIN
  IF p_empresa IS NULL OR TRIM(p_empresa) = '' THEN
    RETURN true;
  END IF;

  SELECT rol INTO v_rol FROM usuarios
  WHERE id = auth.uid() AND activo = true;

  IF v_rol IS NULL THEN RETURN false; END IF;
  IF v_rol = 'admin' THEN RETURN true; END IF;

  -- Resolver sigla: si el input es un nombre completo, buscar su sigla
  SELECT sigla INTO v_sigla FROM empresas
  WHERE sigla = TRIM(p_empresa) OR nombre_completo = TRIM(p_empresa);

  IF v_sigla IS NULL THEN RETURN false; END IF;

  SELECT EXISTS(
    SELECT 1 FROM usuario_empresas
    WHERE usuario_id = auth.uid() AND empresa_sigla = v_sigla
  ) INTO v_found;

  RETURN v_found;
END;
$$;

-- 4.3 get_user_companies(): retorna array de nombres completos de empresas del usuario
--     Admins obtienen todas las empresas activas
CREATE OR REPLACE FUNCTION get_user_companies()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol text;
  v_companies text[];
BEGIN
  SELECT rol INTO v_rol FROM usuarios
  WHERE id = auth.uid() AND activo = true;

  IF v_rol IS NULL THEN RETURN '{}'; END IF;

  IF v_rol = 'admin' THEN
    SELECT array_agg(nombre_completo ORDER BY sigla)
    INTO v_companies
    FROM empresas WHERE activa = true;
  ELSE
    SELECT array_agg(e.nombre_completo ORDER BY e.sigla)
    INTO v_companies
    FROM usuario_empresas ue
    JOIN empresas e ON e.sigla = ue.empresa_sigla
    WHERE ue.usuario_id = auth.uid() AND e.activa = true;
  END IF;

  RETURN COALESCE(v_companies, '{}');
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 5. ROW LEVEL SECURITY en tablas nuevas
-- ══════════════════════════════════════════════════════════════

-- ── empresas: todos los autenticados pueden leer, solo admins modifican ──

ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresas_select_authenticated"
  ON empresas FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "empresas_all_admin"
  ON empresas FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Mantener acceso anon para que el login pueda resolver empresa si se necesita
CREATE POLICY "empresas_select_anon"
  ON empresas FOR SELECT
  TO anon
  USING (true);


-- ── usuarios: admins ven todo, no-admins solo su propio registro ──

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuarios_select_own"
  ON usuarios FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR get_user_role() = 'admin');

CREATE POLICY "usuarios_insert_admin"
  ON usuarios FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "usuarios_update_admin"
  ON usuarios FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "usuarios_delete_admin"
  ON usuarios FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');


-- ── usuario_empresas: admins ven todo, no-admins solo sus asignaciones ──

ALTER TABLE usuario_empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ue_select_own"
  ON usuario_empresas FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid() OR get_user_role() = 'admin');

CREATE POLICY "ue_insert_admin"
  ON usuario_empresas FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "ue_update_admin"
  ON usuario_empresas FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "ue_delete_admin"
  ON usuario_empresas FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 6. TRIGGER: actualizar updated_at en usuarios
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- ══════════════════════════════════════════════════════════════
-- 7. GRANTS: asegurar permisos para los roles de Supabase
-- ══════════════════════════════════════════════════════════════

GRANT SELECT ON empresas TO anon;
GRANT ALL ON empresas TO authenticated;
GRANT ALL ON usuarios TO authenticated;
GRANT ALL ON usuario_empresas TO authenticated;

GRANT EXECUTE ON FUNCTION get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_company(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_companies() TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- FIN FASE 1
--
-- SIGUIENTE PASO MANUAL:
-- 1. Ir a Supabase Dashboard → Authentication → Users → Add user
-- 2. Crear usuario con email y contraseña (ej: admin@tudominio.com)
-- 3. Copiar el UUID generado
-- 4. Ejecutar el SQL de abajo reemplazando los valores:
--
-- INSERT INTO usuarios (id, email, nombre, rol)
-- VALUES (
--   'UUID-DEL-USUARIO-CREADO',
--   'admin@tudominio.com',
--   'Nombre del Admin',
--   'admin'
-- );
--
-- INSERT INTO usuario_empresas (usuario_id, empresa_sigla)
-- VALUES
--   ('UUID-DEL-USUARIO-CREADO', 'PARCELAR'),
--   ('UUID-DEL-USUARIO-CREADO', 'GREEN'),
--   ('UUID-DEL-USUARIO-CREADO', 'RESO'),
--   ('UUID-DEL-USUARIO-CREADO', 'IASO'),
--   ('UUID-DEL-USUARIO-CREADO', 'IAS');
-- ══════════════════════════════════════════════════════════════
