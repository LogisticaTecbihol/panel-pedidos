-- Vincular usuario de la app con "código de comercial" del negocio.
--
-- Contexto: Pedidos."Comercial" almacena un CÓDIGO (formato tipo "PDC-C08",
-- "GAC-C01") no el nombre. Por eso el match por usuarios.nombre no funciona.
-- Ahora cada usuario puede tener un comercial_codigo asociado; la RLS y el
-- resolver del cliente usan ese código como fuente de verdad del vínculo.

-- 1. Nueva columna en usuarios.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS comercial_codigo text;

-- 2. Unique parcial: dos usuarios no pueden compartir el mismo código.
--    Filas con NULL no colisionan (índice parcial).
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_comercial_codigo
  ON usuarios (comercial_codigo)
  WHERE comercial_codigo IS NOT NULL;

-- 3. Extender el directorio (SECURITY DEFINER) para exponer el nuevo campo.
DROP FUNCTION IF EXISTS list_usuarios_directorio();

CREATE OR REPLACE FUNCTION list_usuarios_directorio()
RETURNS TABLE (
  id                uuid,
  nombre            text,
  email             text,
  rol               text,
  activo            boolean,
  comercial_codigo  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.comercial_codigo
  FROM usuarios u;
$$;

REVOKE ALL ON FUNCTION list_usuarios_directorio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_usuarios_directorio() TO authenticated;

-- 4. Backfill: repoblar Pedidos.comercial_id matcheando por código.
--    Sobrescribe también los NULL que dejó el backfill anterior por nombre.
UPDATE "Pedidos" p
   SET "comercial_id" = u.id
  FROM usuarios u
 WHERE u.activo = true
   AND u.comercial_codigo IS NOT NULL
   AND trim(u.comercial_codigo) <> ''
   AND trim(u.comercial_codigo) = trim(p."Comercial")
   AND (p."comercial_id" IS NULL OR p."comercial_id" <> u.id);
