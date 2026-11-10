-- ============================================================
-- Rollback de remision_unica_por_orden_pedidos_variantes.sql
-- Vuelve la comparación al texto exacto (mayúsculas/espacios ignorados), tal como
-- la dejó remision_unica_por_orden_pedidos. No toca datos. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_pedidos_remision_unica_por_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cod   text;
  v_otro  record;
BEGIN
  -- Solo los números que esta línea AGREGA (los que ya tenía no se revalidan).
  FOR v_cod IN
    SELECT c FROM unnest(public.fn_pedidos_codigos_remision(NEW."Remisiones")) AS c
    EXCEPT
    SELECT c FROM unnest(public.fn_pedidos_codigos_remision(OLD."Remisiones")) AS c
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('pedidos_remision:' || COALESCE(NEW."Nombre_Empresa", '') || ':' || v_cod)
    );

    SELECT o."Consecutivo", o."Cliente" INTO v_otro
    FROM public."Pedidos" o
    WHERE o.id <> NEW.id
      AND o."Nombre_Empresa" IS NOT DISTINCT FROM NEW."Nombre_Empresa"
      AND strpos(upper(COALESCE(o."Remisiones", '')), v_cod) > 0
      AND v_cod = ANY (public.fn_pedidos_codigos_remision(o."Remisiones"))
      AND NOT (
        o."Consecutivo" IS NOT DISTINCT FROM NEW."Consecutivo"
        AND lower(btrim(COALESCE(o."Cliente", ''))) IN (
          lower(btrim(COALESCE(NEW."Cliente", ''))),
          lower(btrim(COALESCE(OLD."Cliente", '')))
        )
      )
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'La remisión % ya pertenece a la orden % (cliente %) de esta empresa. Una remisión corresponde a una sola orden: deje «Auto» para generar un número nuevo o escriba otro.',
        v_cod, COALESCE(v_otro."Consecutivo", '?'), COALESCE(NULLIF(btrim(v_otro."Cliente"), ''), '?')
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_pedidos_remision_unica_por_orden() FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_pedidos_claves_remision(text);
DROP FUNCTION IF EXISTS public.fn_remision_clave(text);

NOTIFY pgrst, 'reload schema';
