-- ============================================================
-- ROLLBACK de bloqueo_cartera_cliente_editor_por_empresa
-- Restaura guard_bloqueo_cartera_cliente() tal como estaba (admin, editor y
-- cartera sin restricción por empresa) y borra el ayudante nuevo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_bloqueo_cartera_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_old_estado text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Estado" ELSE NULL END;
  v_old_obs    text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Observaciones_Cartera" ELSE NULL END;
BEGIN
  IF v_rol IS NOT NULL AND v_rol NOT IN ('admin','editor','cartera') THEN
    IF NEW."Estado" IS DISTINCT FROM v_old_estado
       AND (COALESCE(v_old_estado,'') IN ('Bloqueado por cartera','Suspendido')
            OR COALESCE(NEW."Estado",'') IN ('Bloqueado por cartera','Suspendido'))
    THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar el estado "%" en un cliente', COALESCE(NEW."Estado", v_old_estado);
    END IF;

    IF NEW."Observaciones_Cartera" IS DISTINCT FROM COALESCE(v_old_obs, '') THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden editar las observaciones de cartera de un cliente';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_bloqueo_cartera_cliente() FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public._usuario_tiene_empresa_estricto(text);

NOTIFY pgrst, 'reload schema';
