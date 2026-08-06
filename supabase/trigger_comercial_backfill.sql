-- Trigger: vincular Pedidos automáticamente cuando se crea o actualiza
-- un usuario con comercial_codigo.
--
-- Sin este trigger, los pedidos existentes quedan con comercial_id = NULL
-- hasta que alguien ejecute el backfill manualmente, y el usuario
-- comercial no ve nada por la RLS.

-- 1. Función del trigger
CREATE OR REPLACE FUNCTION trg_usuarios_comercial_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.comercial_codigo IS NOT NULL
     AND trim(NEW.comercial_codigo) <> ''
     AND NEW.activo = true
  THEN
    UPDATE "Pedidos"
       SET "comercial_id" = NEW.id
     WHERE trim("Comercial") = trim(NEW.comercial_codigo)
       AND ("comercial_id" IS NULL OR "comercial_id" <> NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Trigger en INSERT y UPDATE de usuarios
DROP TRIGGER IF EXISTS usuarios_comercial_backfill ON usuarios;

CREATE TRIGGER usuarios_comercial_backfill
  AFTER INSERT OR UPDATE OF comercial_codigo, activo
  ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION trg_usuarios_comercial_backfill();
