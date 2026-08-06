-- Mover el código de comercial de usuarios (1 código global) a
-- usuario_empresas (1 código por empresa asignada).
--
-- Contexto: un mismo usuario puede tener códigos de comercial distintos
-- según la empresa (e.g. "PDC-C08" para PARCELAR, "GAC-C03" para GREEN).
-- La columna usuarios.comercial_codigo se mantiene por retrocompatibilidad
-- pero el frontend dejará de escribirla.

-- ══════════════════════════════════════════════════════════════
-- 1. Nueva columna en usuario_empresas
-- ══════════════════════════════════════════════════════════════

ALTER TABLE usuario_empresas
  ADD COLUMN IF NOT EXISTS codigo_comercial text;

-- Unique parcial: ningún código puede repetirse entre filas (global).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ue_codigo_comercial
  ON usuario_empresas (codigo_comercial)
  WHERE codigo_comercial IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 2. Migrar datos existentes desde usuarios.comercial_codigo
-- ══════════════════════════════════════════════════════════════

-- Si el usuario tiene exactamente UNA empresa asignada, el código va ahí.
UPDATE usuario_empresas ue
   SET codigo_comercial = trim(u.comercial_codigo)
  FROM usuarios u
 WHERE u.id = ue.usuario_id
   AND u.comercial_codigo IS NOT NULL
   AND trim(u.comercial_codigo) <> ''
   AND (SELECT count(*) FROM usuario_empresas ue2 WHERE ue2.usuario_id = u.id) = 1;

-- Si tiene varias empresas, colocar el código en la primera (alfabéticamente).
-- El admin podrá redistribuir luego desde la UI.
UPDATE usuario_empresas ue
   SET codigo_comercial = trim(u.comercial_codigo)
  FROM usuarios u
 WHERE u.id = ue.usuario_id
   AND u.comercial_codigo IS NOT NULL
   AND trim(u.comercial_codigo) <> ''
   AND ue.codigo_comercial IS NULL                        -- no fue migrado arriba
   AND (SELECT count(*) FROM usuario_empresas ue2 WHERE ue2.usuario_id = u.id) > 1
   AND ue.empresa_sigla = (
     SELECT min(ue3.empresa_sigla)
       FROM usuario_empresas ue3
      WHERE ue3.usuario_id = u.id
   );

-- ══════════════════════════════════════════════════════════════
-- 3. Actualizar list_usuarios_directorio() — agrega codigos_comercial
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS list_usuarios_directorio();

CREATE OR REPLACE FUNCTION list_usuarios_directorio()
RETURNS TABLE (
  id                 uuid,
  nombre             text,
  email              text,
  rol                text,
  activo             boolean,
  comercial_codigo   text,
  codigos_comercial  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.email, u.rol, u.activo,
         u.comercial_codigo,
         COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                     'empresa', ue.empresa_sigla,
                     'codigo',  ue.codigo_comercial))
              FROM usuario_empresas ue
             WHERE ue.usuario_id = u.id
               AND ue.codigo_comercial IS NOT NULL
               AND trim(ue.codigo_comercial) <> ''),
           '[]'::jsonb
         ) AS codigos_comercial
    FROM usuarios u;
$$;

REVOKE ALL ON FUNCTION list_usuarios_directorio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_usuarios_directorio() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 4. Trigger en usuario_empresas para backfill automático
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_ue_codigo_comercial_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.codigo_comercial IS NOT NULL
     AND trim(NEW.codigo_comercial) <> ''
  THEN
    IF EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.usuario_id AND activo = true) THEN
      -- Backfill Pedidos
      UPDATE "Pedidos"
         SET "comercial_id" = NEW.usuario_id
       WHERE trim("Comercial") = trim(NEW.codigo_comercial)
         AND ("comercial_id" IS NULL OR "comercial_id" <> NEW.usuario_id);

      -- Backfill SolicitudMuestras
      UPDATE "SolicitudMuestras"
         SET "responsable_id" = NEW.usuario_id
       WHERE lower(trim("Responsable")) = lower(trim(NEW.codigo_comercial))
         AND ("responsable_id" IS NULL OR "responsable_id" <> NEW.usuario_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ue_codigo_comercial_backfill ON usuario_empresas;

CREATE TRIGGER ue_codigo_comercial_backfill
  AFTER INSERT OR UPDATE OF codigo_comercial
  ON usuario_empresas
  FOR EACH ROW
  EXECUTE FUNCTION trg_ue_codigo_comercial_backfill();
