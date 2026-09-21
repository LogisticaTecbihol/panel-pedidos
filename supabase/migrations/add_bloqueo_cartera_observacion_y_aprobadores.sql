-- ============================================================
-- Migración (2026-09-21):
--  1) Observación OBLIGATORIA al bloquear un pedido por cartera, con historial
--     (quién bloqueó, cuándo, por qué; y quién/cuándo lo liberó).
--  2) find_aprobadores_cliente_nuevo(): destinatarios del aviso de "pedido
--     pendiente de aprobación" (usuarios activos con rol cartera o admin).
--
-- Bloqueo:
--  - Nueva RPC bloquear_pedido_cartera(p_pedido_ids, p_bloquear, p_observacion):
--    actúa SOLO sobre el pedido de esas líneas (empresa+consecutivo no bastan:
--    varios clientes pueden compartir el N°; la RPC anterior
--    set_bloqueo_cartera_pedido bloqueaba a todos por igual).
--  - El trigger guard_bloqueo_cartera_pedido exige, para pasar un pedido a
--    'Bloqueado por cartera', que ese mismo UPDATE traiga una observación
--    nueva (Bloqueo_En cambia y Bloqueo_Observacion no vacía). Así la
--    observación no se puede saltar desde otro camino (ni desde un panel
--    desactualizado).
--  - El historial completo de cada bloqueo/liberación queda además en audit_log
--    (registra cada columna que cambia en Pedidos).
-- ============================================================

ALTER TABLE public."Pedidos"
  ADD COLUMN IF NOT EXISTS "Bloqueo_Observacion"   text,
  ADD COLUMN IF NOT EXISTS "Bloqueo_Por_Nombre"    text,
  ADD COLUMN IF NOT EXISTS "Bloqueo_En"            timestamptz,
  ADD COLUMN IF NOT EXISTS "Desbloqueo_Por_Nombre" text,
  ADD COLUMN IF NOT EXISTS "Desbloqueo_En"         timestamptz;

-- Bloquear / liberar UN pedido por cartera (admin, editor, cartera).
CREATE OR REPLACE FUNCTION public.bloquear_pedido_cartera(
  p_pedido_ids  bigint[],
  p_bloquear    boolean,
  p_observacion text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol      text := public.get_user_role();
  v_empresa  text;
  v_consec   text;
  v_cliente  text;
  v_pedidos  int;
  v_n        int;
  v_obs      text := btrim(COALESCE(p_observacion, ''));
BEGIN
  IF COALESCE(v_rol, '') NOT IN ('admin', 'editor', 'cartera') THEN
    RAISE EXCEPTION 'No autorizado: solo Cartera, edición o administración pueden bloquear/liberar pedidos por cartera';
  END IF;
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Faltan las líneas del pedido';
  END IF;
  IF p_bloquear AND v_obs = '' THEN
    RAISE EXCEPTION 'Indica la observación del bloqueo';
  END IF;

  SELECT count(DISTINCT ("Nombre_Empresa" || '||' || "Consecutivo" || '||' || COALESCE("Cliente", ''))),
         min("Nombre_Empresa"), min("Consecutivo"), min("Cliente")
    INTO v_pedidos, v_empresa, v_consec, v_cliente
    FROM "Pedidos"
   WHERE id = ANY(p_pedido_ids);

  IF v_pedidos <> 1 THEN
    RAISE EXCEPTION 'Las líneas no corresponden a un único pedido';
  END IF;

  IF p_bloquear THEN
    UPDATE "Pedidos"
       SET "Estado_2"              = 'Bloqueado por cartera',
           "Bloqueo_Observacion"   = v_obs,
           "Bloqueo_Por_Nombre"    = public._usuario_nombre(auth.uid()),
           "Bloqueo_En"            = clock_timestamp(),
           "Desbloqueo_Por_Nombre" = NULL,
           "Desbloqueo_En"         = NULL,
           modificado_por          = auth.uid()
     WHERE "Nombre_Empresa" = v_empresa
       AND "Consecutivo"    = v_consec
       AND "Cliente" IS NOT DISTINCT FROM v_cliente
       AND COALESCE("Estado_2", '') NOT IN ('Anulado', 'Pendiente de aprobación');
  ELSE
    UPDATE "Pedidos"
       SET "Estado_2"              = 'Abierto',
           "Desbloqueo_Por_Nombre" = public._usuario_nombre(auth.uid()),
           "Desbloqueo_En"         = clock_timestamp(),
           modificado_por          = auth.uid()
     WHERE "Nombre_Empresa" = v_empresa
       AND "Consecutivo"    = v_consec
       AND "Cliente" IS NOT DISTINCT FROM v_cliente
       AND "Estado_2" = 'Bloqueado por cartera';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_pedido_cartera(bigint[], boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bloquear_pedido_cartera(bigint[], boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.bloquear_pedido_cartera(bigint[], boolean, text) TO authenticated;

-- Candado del servidor: sin observación nueva no se bloquea, venga de donde venga.
CREATE OR REPLACE FUNCTION public.guard_bloqueo_cartera_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
BEGIN
  IF NEW."Estado_2" IS DISTINCT FROM OLD."Estado_2"
     AND 'Bloqueado por cartera' IN (COALESCE(OLD."Estado_2",''), COALESCE(NEW."Estado_2",''))
     AND v_rol IS NOT NULL
     AND v_rol NOT IN ('admin','editor','cartera')
  THEN
    RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar "Bloqueado por cartera" en un pedido';
  END IF;

  IF NEW."Estado_2" = 'Bloqueado por cartera'
     AND COALESCE(OLD."Estado_2", '') <> 'Bloqueado por cartera'
     AND auth.uid() IS NOT NULL
     AND (NEW."Bloqueo_En" IS NOT DISTINCT FROM OLD."Bloqueo_En"
          OR btrim(COALESCE(NEW."Bloqueo_Observacion", '')) = '')
  THEN
    RAISE EXCEPTION 'Para bloquear un pedido por cartera indica la observación del bloqueo (si ves este mensaje, recarga la página con Ctrl+F5)';
  END IF;

  RETURN NEW;
END;
$function$;

-- RPC anterior (paneles desactualizados): bloquear ya no es posible sin
-- observación; liberar sigue funcionando, ahora solo sobre líneas bloqueadas
-- y dejando el sello de quién/cuándo liberó.
CREATE OR REPLACE FUNCTION public.set_bloqueo_cartera_pedido(p_empresa text, p_consecutivo text, p_bloquear boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_n int;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor','cartera') THEN
    RAISE EXCEPTION 'No autorizado: solo Cartera, edición o administración pueden bloquear/liberar pedidos por cartera';
  END IF;
  IF p_bloquear THEN
    RAISE EXCEPTION 'Para bloquear un pedido por cartera ahora debes indicar la observación: recarga la página con Ctrl+F5';
  END IF;

  UPDATE "Pedidos"
     SET "Estado_2" = 'Abierto',
         "Desbloqueo_Por_Nombre" = public._usuario_nombre(auth.uid()),
         "Desbloqueo_En" = clock_timestamp(),
         modificado_por = auth.uid()
   WHERE "Nombre_Empresa" = p_empresa
     AND "Consecutivo" = p_consecutivo
     AND "Estado_2" = 'Bloqueado por cartera';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$function$;

-- Destinatarios del aviso "pedido pendiente de aprobación": cartera + admin activos.
CREATE OR REPLACE FUNCTION public.find_aprobadores_cliente_nuevo()
RETURNS TABLE(usuario_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
    FROM usuarios u
   WHERE u.activo = true
     AND u.rol IN ('cartera', 'admin');
$$;

REVOKE ALL ON FUNCTION public.find_aprobadores_cliente_nuevo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_aprobadores_cliente_nuevo() FROM anon;
GRANT EXECUTE ON FUNCTION public.find_aprobadores_cliente_nuevo() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
