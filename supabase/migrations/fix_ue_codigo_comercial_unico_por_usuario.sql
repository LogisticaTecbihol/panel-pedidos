-- Permitir que un mismo comercial reutilice el mismo código en varias empresas.
--
-- YA APLICADO EN PRODUCCIÓN (2026-09) — fuera del historial de migraciones de
-- Supabase. Script idempotente (IF EXISTS / CREATE OR REPLACE); se versiona como
-- documentación del estado real de la BD, no re-ejecutar a ciegas.
--
-- Antes: el índice único global ux_ue_codigo_comercial exigía que cada
-- codigo_comercial apareciera en una sola fila de usuario_empresas. Eso impedía
-- asignar, por ejemplo, "ISO-C15" al mismo usuario en IASO y en IAS a la vez
-- (error: duplicate key value violates unique constraint "ux_ue_codigo_comercial").
--
-- Ahora: el código puede repetirse en varias filas SIEMPRE que sean del mismo
-- usuario. Dos usuarios distintos siguen sin poder compartir un código, porque
-- la resolución de comercial_id en pedidos (_resolveComercialId) y el backfill
-- de Pedidos/SolicitudMuestras dependen de que cada código identifique a un
-- único comercial.

-- ══════════════════════════════════════════════════════════════
-- 1. Quitar el índice único global
-- ══════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS ux_ue_codigo_comercial;

-- ══════════════════════════════════════════════════════════════
-- 2. Índice de apoyo (no único) para las búsquedas por código
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ue_codigo_comercial_norm
  ON usuario_empresas (lower(btrim(codigo_comercial)))
  WHERE codigo_comercial IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 3. Validación: un código no puede pertenecer a dos usuarios
-- ══════════════════════════════════════════════════════════════
-- Solo los admins escriben en usuario_empresas (RLS ue_insert_admin /
-- ue_update_admin) y pueden leer toda la tabla, así que SECURITY INVOKER basta.
-- La comparación es sobre el valor recortado y en minúsculas para que
-- "ISO-C15" y " iso-c15 " cuenten como el mismo código.

CREATE OR REPLACE FUNCTION trg_ue_codigo_comercial_unico_por_usuario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  otro_nombre text;
BEGIN
  IF NEW.codigo_comercial IS NULL OR btrim(NEW.codigo_comercial) = '' THEN
    RETURN NEW;
  END IF;

  SELECT u.nombre
    INTO otro_nombre
    FROM usuario_empresas ue
    JOIN usuarios u ON u.id = ue.usuario_id
   WHERE lower(btrim(ue.codigo_comercial)) = lower(btrim(NEW.codigo_comercial))
     AND ue.usuario_id <> NEW.usuario_id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'El código comercial "%" ya está asignado a otro usuario (%). Cada código identifica a un solo comercial.',
      btrim(NEW.codigo_comercial), COALESCE(otro_nombre, 'desconocido')
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ue_codigo_comercial_unico_por_usuario ON usuario_empresas;

CREATE TRIGGER ue_codigo_comercial_unico_por_usuario
  BEFORE INSERT OR UPDATE OF codigo_comercial, usuario_id
  ON usuario_empresas
  FOR EACH ROW
  EXECUTE FUNCTION trg_ue_codigo_comercial_unico_por_usuario();
