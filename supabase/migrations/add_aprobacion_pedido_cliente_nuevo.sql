-- ============================================================
-- Migración: aprobación previa de Cartera/administración para el pedido
-- que da de alta a un cliente nuevo.
--
-- Regla: el pedido MANUAL cuyo NIT aún no está en el maestro ClientesUnicos
-- (es decir, el que crea al cliente vía registrar_cliente_nuevo_desde_pedido)
-- nace con Estado_2 = 'Pendiente de aprobación'. Mientras esté así no se le
-- puede dar trámite: ni entregas/remisiones, ni apartar stock, ni solicitudes
-- de compra (traslados). Solo Cartera o admin lo aprueban (→ 'Abierto') o lo
-- rechazan (→ 'Anulado', con motivo). Los pedidos siguientes del mismo cliente
-- (que ya existe en el maestro) fluyen normal, aunque el primero siga pendiente.
--
-- No aplica a: carga por Excel/PDF (Archivo_Fuente <> 'Ingreso manual'),
-- traslados a bodega en consignación (Bodega_Consignacion_Id) ni pedidos sin NIT
-- válido (misma regla de registrar_cliente_nuevo_desde_pedido: >= 5 dígitos).
--
-- Se aplica en el servidor (trigger) para que no se pueda saltar desde el
-- navegador. El orden real es: 1) INSERT del pedido → el trigger ve que el NIT
-- no está en el maestro y lo deja Pendiente; 2) recién después el panel crea el
-- cliente en ClientesUnicos.
-- ============================================================

-- 1) Trazabilidad de la decisión (quién, cuándo, nota / motivo de rechazo)
ALTER TABLE public."Pedidos"
  ADD COLUMN IF NOT EXISTS "Aprobacion_Por_Nombre" text,
  ADD COLUMN IF NOT EXISTS "Aprobacion_En"         timestamptz,
  ADD COLUMN IF NOT EXISTS "Aprobacion_Nota"       text;

-- 2) Al insertar: marcar como pendiente
CREATE OR REPLACE FUNCTION public.fn_pedido_pendiente_aprobacion_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nit text;
BEGIN
  IF COALESCE(NEW."Estado_2", 'Abierto') <> 'Abierto' THEN
    RETURN NEW;
  END IF;

  -- (1) Línea nueva de un pedido que ya está pendiente: se une a él.
  IF EXISTS (
    SELECT 1 FROM "Pedidos" p
     WHERE p."Nombre_Empresa" = NEW."Nombre_Empresa"
       AND p."Consecutivo"    = NEW."Consecutivo"
       AND p."Cliente" IS NOT DISTINCT FROM NEW."Cliente"
       AND p."Estado_2" = 'Pendiente de aprobación'
  ) THEN
    NEW."Estado_2" := 'Pendiente de aprobación';
    RETURN NEW;
  END IF;

  -- (2) Primer registro de un pedido manual cuyo cliente no está en el maestro.
  IF NEW."Archivo_Fuente" = 'Ingreso manual'
     AND NEW."Bodega_Consignacion_Id" IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM "Pedidos" p
        WHERE p."Nombre_Empresa" = NEW."Nombre_Empresa"
          AND p."Consecutivo"    = NEW."Consecutivo"
          AND p."Cliente" IS NOT DISTINCT FROM NEW."Cliente"
     )
  THEN
    v_nit := public.nit_normalizado(NEW."NIT");
    IF length(COALESCE(v_nit, '')) >= 5
       AND NOT EXISTS (
         SELECT 1 FROM "ClientesUnicos" cu
          WHERE public.nit_normalizado(cu."Identificacion") = v_nit
       )
    THEN
      NEW."Estado_2" := 'Pendiente de aprobación';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_pendiente_aprobacion_ins ON public."Pedidos";
CREATE TRIGGER trg_pedido_pendiente_aprobacion_ins
  BEFORE INSERT ON public."Pedidos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_pendiente_aprobacion_insert();

-- 3) Al actualizar: solo Cartera/admin sacan (o ponen) el estado; y mientras
--    esté pendiente no se registran entregas ni remisiones.
CREATE OR REPLACE FUNCTION public.guard_aprobacion_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol text := public.get_user_role();
BEGIN
  IF NEW."Estado_2" IS DISTINCT FROM OLD."Estado_2"
     AND 'Pendiente de aprobación' IN (COALESCE(OLD."Estado_2", ''), COALESCE(NEW."Estado_2", ''))
     AND auth.uid() IS NOT NULL
     AND COALESCE(v_rol, '') NOT IN ('admin', 'cartera')
  THEN
    RAISE EXCEPTION 'Solo Cartera o administración pueden aprobar o rechazar un pedido pendiente de aprobación';
  END IF;

  IF OLD."Estado_2" = 'Pendiente de aprobación'
     AND NEW."Estado_2" = 'Pendiente de aprobación'
     AND (NEW."Cant_Entregada" IS DISTINCT FROM OLD."Cant_Entregada"
          OR NEW."Remisiones"   IS DISTINCT FROM OLD."Remisiones")
  THEN
    RAISE EXCEPTION 'Pedido pendiente de aprobación de Cartera: no se puede registrar entrega ni remisión';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_aprobacion_pedido ON public."Pedidos";
CREATE TRIGGER trg_guard_aprobacion_pedido
  BEFORE UPDATE ON public."Pedidos"
  FOR EACH ROW EXECUTE FUNCTION public.guard_aprobacion_pedido();

-- 4) No apartar stock ni crear solicitudes de compra (traslados) de un pedido
--    pendiente de aprobación.
CREATE OR REPLACE FUNCTION public.fn_apartado_no_pendiente_aprobacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Pedidos" p
              WHERE p.id = NEW.pedido_id AND p."Estado_2" = 'Pendiente de aprobación') THEN
    RAISE EXCEPTION 'Pedido pendiente de aprobación de Cartera: no se puede apartar stock';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apartado_no_pendiente_aprobacion ON public.apartados_pedido;
CREATE TRIGGER trg_apartado_no_pendiente_aprobacion
  BEFORE INSERT ON public.apartados_pedido
  FOR EACH ROW EXECUTE FUNCTION public.fn_apartado_no_pendiente_aprobacion();

CREATE OR REPLACE FUNCTION public.fn_oc_traslado_no_pendiente_aprobacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW."Tipo" = 'Traslado' AND NEW.pedido_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "Pedidos" p
                  WHERE p.id = NEW.pedido_id AND p."Estado_2" = 'Pendiente de aprobación') THEN
    RAISE EXCEPTION 'Pedido pendiente de aprobación de Cartera: no se pueden crear solicitudes de compra';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oc_traslado_no_pendiente_aprobacion ON public."OrdenesCompra";
CREATE TRIGGER trg_oc_traslado_no_pendiente_aprobacion
  BEFORE INSERT ON public."OrdenesCompra"
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_traslado_no_pendiente_aprobacion();

-- 5) Aprobar / rechazar (Cartera y admin). Cartera es solo lectura sobre
--    Pedidos, por eso va por RPC SECURITY DEFINER. Recibe los ids de línea del
--    pedido (empresa + consecutivo no bastan: otro cliente puede compartir el N°)
--    y resuelve TODAS las líneas pendientes de ese mismo pedido.
CREATE OR REPLACE FUNCTION public.resolver_aprobacion_pedido(
  p_pedido_ids bigint[],
  p_aprobar    boolean,
  p_nota       text DEFAULT ''
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
BEGIN
  IF COALESCE(v_rol, '') NOT IN ('admin', 'cartera') THEN
    RAISE EXCEPTION 'No autorizado: solo Cartera o administración pueden aprobar o rechazar pedidos';
  END IF;
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Faltan las líneas del pedido';
  END IF;
  IF NOT p_aprobar AND btrim(COALESCE(p_nota, '')) = '' THEN
    RAISE EXCEPTION 'Indica el motivo del rechazo';
  END IF;

  SELECT count(DISTINCT ("Nombre_Empresa" || '||' || "Consecutivo" || '||' || COALESCE("Cliente", ''))),
         min("Nombre_Empresa"), min("Consecutivo"), min("Cliente")
    INTO v_pedidos, v_empresa, v_consec, v_cliente
    FROM "Pedidos"
   WHERE id = ANY(p_pedido_ids);

  IF v_pedidos <> 1 THEN
    RAISE EXCEPTION 'Las líneas no corresponden a un único pedido';
  END IF;

  UPDATE "Pedidos"
     SET "Estado_2"              = CASE WHEN p_aprobar THEN 'Abierto' ELSE 'Anulado' END,
         "Aprobacion_Por_Nombre" = public._usuario_nombre(auth.uid()),
         "Aprobacion_En"         = now(),
         "Aprobacion_Nota"       = NULLIF(btrim(COALESCE(p_nota, '')), ''),
         modificado_por          = auth.uid()
   WHERE "Nombre_Empresa" = v_empresa
     AND "Consecutivo"    = v_consec
     AND "Cliente" IS NOT DISTINCT FROM v_cliente
     AND "Estado_2" = 'Pendiente de aprobación';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'El pedido ya no está pendiente de aprobación';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated', v_n, 'aprobado', p_aprobar);
END;
$$;

REVOKE ALL ON FUNCTION public.resolver_aprobacion_pedido(bigint[], boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_aprobacion_pedido(bigint[], boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolver_aprobacion_pedido(bigint[], boolean, text) TO authenticated;

-- 6) El bloqueo/liberación por cartera no debe tocar un pedido pendiente
--    (liberar lo pasaría a 'Abierto' saltándose la aprobación).
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

  UPDATE "Pedidos"
     SET "Estado_2" = CASE WHEN p_bloquear THEN 'Bloqueado por cartera' ELSE 'Abierto' END,
         modificado_por = auth.uid()
   WHERE "Nombre_Empresa" = p_empresa
     AND "Consecutivo" = p_consecutivo
     AND COALESCE("Estado_2",'') NOT IN ('Anulado', 'Pendiente de aprobación');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
