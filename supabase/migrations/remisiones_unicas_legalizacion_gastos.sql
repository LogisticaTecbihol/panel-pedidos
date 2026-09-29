-- ============================================================
-- Una remisión solo puede estar relacionada en UNA legalización o envío.
--
-- LegalizacionGastos.Remisiones_Relacionadas es un CSV de códigos. Este trigger
-- impide guardar (INSERT o UPDATE de esa columna) un código que ya esté en otra
-- legalización/envío, para que un mismo despacho no se reparta ni se cobre dos
-- veces. Reglas:
--   * Se compara sin distinguir mayúsculas/espacios ("iaso-rs-0089 " = "IASO-RS-0089").
--   * Se ignoran los registros 'Rechazada' (quedaron sin efecto y no se pueden
--     editar), así sus remisiones se pueden volver a relacionar.
--   * En UPDATE solo se validan los códigos NUEVOS (los que ya tenía el registro
--     no se revalidan), para no bloquear la edición ni la conciliación.
--   * SECURITY DEFINER: valida contra TODOS los registros aunque el usuario solo
--     vea los de sus empresas (RLS). Un lock de transacción serializa los
--     guardados concurrentes para que dos usuarios no cuelen la misma remisión.
--
-- Aplicar con apply_migration (MCP). Al momento de aplicarla no había
-- duplicados en los datos existentes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validar_remisiones_unicas_legalizacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_dup  text;
  v_old  text[] := ARRAY[]::text[];
BEGIN
  IF btrim(COALESCE(NEW."Remisiones_Relacionadas", '')) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."Remisiones_Relacionadas" IS NOT DISTINCT FROM OLD."Remisiones_Relacionadas" THEN
      RETURN NEW;
    END IF;
    SELECT COALESCE(array_agg(upper(btrim(c))), ARRAY[]::text[]) INTO v_old
      FROM unnest(string_to_array(COALESCE(OLD."Remisiones_Relacionadas", ''), ',')) c;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('legalizacion_gastos_remisiones'));

  FOR v_code IN
    SELECT DISTINCT upper(btrim(c))
      FROM unnest(string_to_array(NEW."Remisiones_Relacionadas", ',')) c
     WHERE btrim(c) <> ''
  LOOP
    IF v_code = ANY (v_old) THEN CONTINUE; END IF;

    SELECT o."Consecutivo" INTO v_dup
      FROM public."LegalizacionGastos" o
     WHERE o.id IS DISTINCT FROM NEW.id
       AND o."Estado_Conciliacion" <> 'Rechazada'
       AND v_code = ANY (ARRAY(SELECT upper(btrim(x))
                                 FROM unnest(string_to_array(o."Remisiones_Relacionadas", ',')) x))
     LIMIT 1;

    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'La remisión % ya está registrada en %', v_code, v_dup
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_remisiones_unicas_legalizacion() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_01_remisiones_unicas ON public."LegalizacionGastos";
CREATE TRIGGER trg_01_remisiones_unicas
  BEFORE INSERT OR UPDATE OF "Remisiones_Relacionadas" ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION public.validar_remisiones_unicas_legalizacion();

NOTIFY pgrst, 'reload schema';
