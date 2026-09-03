-- ============================================================
-- RPC: bloquear_cliente_por_nit
--
-- Al bloquear un pedido por cartera (botón 🔒 en Pedidos), el panel OFRECE
-- bloquear también al cliente en el maestro ClientesUnicos. No es automático:
-- lo confirma el usuario en un aviso.
--
-- Empareja igual que cliente_estado_pedido(): NIT base (sin puntos/espacios/DV)
-- o nombre exacto. Guardia de rol admin/editor/cartera (el trigger
-- trg_guard_bloqueo_cartera_cliente también lo hace cumplir).
--
-- Fecha: 2026-09-03
-- ============================================================

CREATE OR REPLACE FUNCTION public.bloquear_cliente_por_nit(p_nit text, p_cliente text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol   text := get_user_role();
  v_clean text;
  v_found int;
  v_upd   int;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor','cartera') THEN
    RAISE EXCEPTION 'No autorizado: solo Cartera, edición o administración pueden bloquear clientes por cartera';
  END IF;

  v_clean := split_part(regexp_replace(btrim(coalesce(p_nit, '')), '[\.\s]', '', 'g'), '-', 1);

  SELECT count(*) INTO v_found
  FROM public."ClientesUnicos" cu
  WHERE (
      v_clean <> ''
      AND split_part(regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'), '-', 1) = v_clean
    )
    OR (
      coalesce(p_cliente, '') <> ''
      AND lower(btrim(cu."Cliente")) = lower(btrim(p_cliente))
    );

  UPDATE public."ClientesUnicos" cu
     SET "Estado" = 'Bloqueado por cartera'
  WHERE (
      (
        v_clean <> ''
        AND split_part(regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'), '-', 1) = v_clean
      )
      OR (
        coalesce(p_cliente, '') <> ''
        AND lower(btrim(cu."Cliente")) = lower(btrim(p_cliente))
      )
    )
    AND coalesce(cu."Estado", '') <> 'Bloqueado por cartera';

  GET DIAGNOSTICS v_upd = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'found', v_found, 'updated', v_upd);
END;
$function$;

REVOKE ALL ON FUNCTION public.bloquear_cliente_por_nit(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bloquear_cliente_por_nit(text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
