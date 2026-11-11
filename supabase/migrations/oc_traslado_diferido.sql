-- ════════════════════════════════════════════════════════════════════════════
-- OC de traslado «DIFERIDAS» (parte 1 de 3): estructura y candados.
-- ════════════════════════════════════════════════════════════════════════════
-- Hoy, legalizar una OC de traslado ligada a un pedido (Remision de destino llena) mueve la
-- existencia en el acto (Entrada en destino, Salida en origen) aunque el pedido aún no se haya
-- remisionado. Con las OC «diferidas» (Traslado_Diferido = true) la existencia solo se mueve
-- cuando el pedido se remisiona: un RPC (parte 2, tramitar_traslado_oc) reparte lo despachado
-- entre las OC aprobadas de la línea, genera las remisiones RE/RS y divide la fila de la OC
-- (la parte despachada pasa a una fila Cerrada con sus remisiones; el remanente sigue Abierto
-- y sigue apartando stock en el origen). Kardex, Existencias y _kx_movs NO cambian: cada pieza
-- es una fila de OC legalizada normal.
--
-- Esta parte 1 es INERTE hasta la parte 3 (oc_traslado_diferido_activar.sql): ninguna fila
-- tiene todavía Traslado_Diferido = true, así que los candados nuevos no se aplican a nadie.
-- Se puede aplicar antes de publicar el código.
--
-- Qué hace:
--   1. Columnas "Traslado_Diferido" (bool) y "Traslado_Padre_Id" (bigint, la fila de la que se
--      desprendió una pieza: permite reconstruir 60 = 20 + 40).
--   2. Candado trg_oc_diferida_guard (BEFORE UPDATE/DELETE): una OC diferida pendiente NO se
--      legaliza a mano (ni Remision/Remision_Origen ni Estado='Cerrada'); una pieza ya
--      tramitada es inmutable (cantidad, producto, empresas, estado y remisiones; DELETE);
--      una diferida RECHAZADA pasa sola a Estado='Anulada' (si no, seguiría «viva» apartando).
--      Solo el RPC (app.oc_tramite='on'), el SQL directo (postgres/service_role) y, para las
--      piezas ya tramitadas, un admin, se saltan el candado. Un admin o el SQL directo pueden
--      además quitar la marca (true→false) a una diferida pendiente: es la salida de emergencia
--      para legalizarla a mano.
--   3. reservar_stock_oc_traslado / fn_oc_traslado_reserva_pedido: se saltan las diferidas (el
--      stock no llega al destino hasta remisionar, así que no hay nada que apartar allá).
--   4. fn_apartados_cascade_pedido: al CERRAR o BORRAR la línea del pedido se anulan sus OC
--      diferidas pendientes (antes solo al anular el pedido: quedarían apartando para siempre),
--      y bajar la Cantidad de la línea cuenta también las diferidas pendientes.
--   5. fn_oc_avisar_contabilidad: se calla mientras corre el RPC de trámite (el RPC avisa por su
--      cuenta, con el RE de cada pasada; el trigger daría un «aprobada» espurio en el INSERT de la
--      pieza y deduplicaría por título la segunda pasada).
--
-- Las funciones 3, 4 y 5 se reescribieron sobre el cuerpo VIGENTE en producción (pg_get_functiondef
-- del 2026-11-11), no sobre los archivos viejos; cambia solo lo indicado con «DIFERIDAS».
--
-- Idempotente. Rollback: oc_traslado_diferido_rollback.sql.
-- Aplicar con apply_migration del MCP de Supabase ANTES de publicar el código.
-- Fecha: 2026-11-11
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public."OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Traslado_Diferido" boolean NOT NULL DEFAULT false;
ALTER TABLE public."OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Traslado_Padre_Id" bigint;

COMMENT ON COLUMN public."OrdenesCompra"."Traslado_Diferido" IS
  'true = OC de traslado de un pedido cuya existencia se mueve SOLO al remisionar el pedido (RPC tramitar_traslado_oc). No se legaliza a mano.';
COMMENT ON COLUMN public."OrdenesCompra"."Traslado_Padre_Id" IS
  'Fila de OrdenesCompra de la que se desprendió esta pieza al tramitar una remisión parcial del pedido.';

-- ── 2. Candado ─────────────────────────────────────────────────────────────
-- SECURITY INVOKER a propósito: necesita ver current_user (authenticated/anon en una petición
-- del navegador; postgres/service_role en SQL directo). Un trigger DEFINER vería siempre al dueño.
CREATE OR REPLACE FUNCTION public.fn_oc_diferida_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tramite boolean := COALESCE(current_setting('app.oc_tramite', true), '') = 'on';
  v_sql     boolean := current_user NOT IN ('authenticated', 'anon');
  v_admin   boolean;
  v_rem_old boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."Traslado_Diferido" AND NOT v_tramite AND NOT v_sql
       AND ( COALESCE(btrim(OLD."Remision"), '') <> ''
          OR COALESCE(btrim(OLD."Remision_Origen"), '') <> ''
          OR COALESCE(OLD."Estado", '') = 'Cerrada' ) THEN
      v_admin := COALESCE(public.get_user_role(), '') = 'admin';
      IF NOT v_admin THEN
        RAISE EXCEPTION 'No se puede eliminar la OC % (línea %): ya se tramitó al remisionar el pedido (remisión %). Si fue un error, anúlala con «Remisión anulada».',
          COALESCE(OLD."Consecutivo", '?'), OLD."id", COALESCE(NULLIF(btrim(OLD."Remision"), ''), '?');
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NOT OLD."Traslado_Diferido" THEN
    RETURN NEW;
  END IF;
  IF v_tramite THEN
    RETURN NEW;
  END IF;

  v_admin   := COALESCE(public.get_user_role(), '') = 'admin';
  v_rem_old := COALESCE(btrim(OLD."Remision"), '') <> ''
            OR COALESCE(btrim(OLD."Remision_Origen"), '') <> ''
            OR COALESCE(OLD."Estado", '') = 'Cerrada';

  IF v_rem_old THEN
    -- Pieza ya tramitada: inmutable (el Kardex ignora Estado, así que anular o editar una pieza
    -- con remisión desfasaría el inventario).
    IF NOT (v_sql OR v_admin) AND (
         NEW."Cantidad"          IS DISTINCT FROM OLD."Cantidad"
      OR NEW."Producto"          IS DISTINCT FROM OLD."Producto"
      OR NEW."Presentacion"      IS DISTINCT FROM OLD."Presentacion"
      OR NEW."Empresa_Origen"    IS DISTINCT FROM OLD."Empresa_Origen"
      OR NEW."Empresa_Destino"   IS DISTINCT FROM OLD."Empresa_Destino"
      OR NEW."Estado"            IS DISTINCT FROM OLD."Estado"
      OR NEW."Remision"          IS DISTINCT FROM OLD."Remision"
      OR NEW."Remision_Origen"   IS DISTINCT FROM OLD."Remision_Origen"
      OR NEW."pedido_id"         IS DISTINCT FROM OLD."pedido_id"
      OR NEW."Traslado_Diferido" IS DISTINCT FROM OLD."Traslado_Diferido"
    ) THEN
      RAISE EXCEPTION 'La OC % (línea %) ya se tramitó al remisionar el pedido: no se puede cambiar su cantidad, producto, empresas, estado ni remisiones.',
        COALESCE(OLD."Consecutivo", '?'), OLD."id";
    END IF;
    RETURN NEW;
  END IF;

  -- Diferida pendiente (sin remisiones).
  -- Salida de emergencia: admin o SQL directo pueden cambiarle la marca (normalmente true→false) y
  -- entonces se legaliza a mano como una OC común. Es un acto consciente: no se valida más.
  IF NEW."Traslado_Diferido" IS DISTINCT FROM OLD."Traslado_Diferido" THEN
    IF NOT (v_sql OR v_admin) THEN
      RAISE EXCEPTION 'No se puede cambiar la marca de traslado diferido de la OC % (línea %).',
        COALESCE(OLD."Consecutivo", '?'), OLD."id";
    END IF;
    RETURN NEW;
  END IF;

  -- No se legaliza a mano: solo el RPC (al remisionar el pedido) o SQL directo.
  IF NOT v_sql AND (
       COALESCE(btrim(NEW."Remision"), '')        <> ''
    OR COALESCE(btrim(NEW."Remision_Origen"), '') <> ''
    OR COALESCE(NEW."Estado", '') = 'Cerrada'
  ) THEN
    RAISE EXCEPTION 'La OC % se legaliza sola al remisionar el pedido (no se puede cerrar ni poner remisiones a mano).',
      COALESCE(OLD."Consecutivo", '?');
  END IF;

  -- DIFERIDAS: una OC rechazada deja de apartar stock (sin esto seguiría «viva»).
  IF NEW."Estado_Aprobacion" = 'Rechazada'
     AND OLD."Estado_Aprobacion" IS DISTINCT FROM 'Rechazada'
     AND COALESCE(NEW."Estado", '') = 'Abierta' THEN
    NEW."Estado" := 'Anulada';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_oc_diferida_guard ON public."OrdenesCompra";
CREATE TRIGGER trg_oc_diferida_guard
  BEFORE UPDATE OR DELETE ON public."OrdenesCompra"
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_diferida_guard();

-- ── 3. Reserva en destino: las diferidas se saltan ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_oc_traslado_reserva_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW."Tipo" = 'Traslado'
     AND NEW."pedido_id" IS NOT NULL
     AND NOT COALESCE(NEW."Traslado_Diferido", false)   -- DIFERIDAS: el stock no llega al destino hasta remisionar
     AND COALESCE(TRIM(NEW."Remision"),'') <> ''
     AND COALESCE(TRIM(OLD."Remision"),'') = '' THEN
    BEGIN
      PERFORM public.reservar_stock_oc_traslado(NEW."id");
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_oc_traslado_reserva_pedido(%): %', NEW."id", SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_stock_oc_traslado(p_oc_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_oc record;
  v_ped record;
  v_apartado numeric;
  v_hueco numeric;
  v_cant numeric;
BEGIN
  SELECT "id","Tipo","Estado","Remision","Empresa_Destino","Consecutivo","Cantidad","pedido_id","Traslado_Diferido"
    INTO v_oc
    FROM "OrdenesCompra" WHERE "id" = p_oc_id;

  IF NOT FOUND
     OR v_oc."Tipo" IS DISTINCT FROM 'Traslado'
     OR v_oc."pedido_id" IS NULL
     OR COALESCE(v_oc."Traslado_Diferido", false)       -- DIFERIDAS: no hay stock que apartar en destino
     OR COALESCE(v_oc."Estado",'') = 'Anulada'
     OR COALESCE(TRIM(v_oc."Remision"),'') = ''
     OR COALESCE(TRIM(v_oc."Empresa_Destino"),'') = ''
     OR COALESCE(v_oc."Cantidad",0) <= 0 THEN
    RETURN 0;
  END IF;

  -- Dos OC de la misma línea legalizadas a la vez no deben pasarse del hueco.
  PERFORM pg_advisory_xact_lock(hashtextextended('reservar_oc_pedido_' || v_oc."pedido_id"::text, 0));

  SELECT "id","Nombre_Empresa","Consecutivo","Cliente","Producto","Presentacion",
         "Cantidad","Cant_Entregada","Estado_2","Plazo_Pago","Precio_Facturacion",
         "Fecha_Compromiso","Bonificado"
    INTO v_ped
    FROM "Pedidos" WHERE "id" = v_oc."pedido_id";

  IF NOT FOUND OR COALESCE(v_ped."Estado_2",'') = 'Anulado' THEN
    RETURN 0;
  END IF;
  -- La entrega al cliente sale de la empresa del pedido: reservar en otra
  -- empresa dejaría unidades que la línea no puede despachar.
  IF TRIM(COALESCE(v_ped."Nombre_Empresa",'')) <> TRIM(v_oc."Empresa_Destino") THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(cantidad),0) INTO v_apartado
    FROM "apartados_pedido"
   WHERE pedido_id = v_oc."pedido_id" AND estado = 'Activo';

  v_hueco := GREATEST(0, COALESCE(v_ped."Cantidad",0) - COALESCE(v_ped."Cant_Entregada",0) - v_apartado);
  v_cant  := LEAST(v_oc."Cantidad", v_hueco);
  IF v_cant <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO "apartados_pedido" (
    pedido_id, empresa_pedido, consecutivo, cliente, producto, presentacion,
    empresa_stock, cantidad, estado, plazo_pago, precio_facturacion, fecha_compromiso,
    bonificado, orden_compra_id, notas
  ) VALUES (
    v_oc."pedido_id", v_ped."Nombre_Empresa", v_ped."Consecutivo", COALESCE(v_ped."Cliente",''),
    COALESCE(v_ped."Producto",''), COALESCE(v_ped."Presentacion",''),
    TRIM(v_oc."Empresa_Destino"), v_cant, 'Activo',
    COALESCE(v_ped."Plazo_Pago",''), COALESCE(v_ped."Precio_Facturacion",''),
    COALESCE(v_ped."Fecha_Compromiso",''), COALESCE(v_ped."Bonificado",''),
    v_oc."id",
    'Reservado por OC ' || COALESCE(v_oc."Consecutivo",'') || ' (' || v_cant || ' ud)'
  )
  ON CONFLICT (pedido_id, empresa_stock) WHERE estado = 'Activo'
  DO UPDATE SET
    cantidad        = "apartados_pedido".cantidad + EXCLUDED.cantidad,
    orden_compra_id = COALESCE("apartados_pedido".orden_compra_id, EXCLUDED.orden_compra_id),
    notas           = TRIM(BOTH ' |' FROM COALESCE("apartados_pedido".notas,'') || ' | ' || EXCLUDED.notas),
    modificado_por  = auth.uid();

  RETURN v_cant;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'reservar_stock_oc_traslado(%): % — las unidades quedan como existencia libre', p_oc_id, SQLERRM;
  RETURN 0;
END;
$function$;

-- ── 4. Cascada del pedido: cerrar / borrar / bajar cantidad con OC diferidas ─
CREATE OR REPLACE FUNCTION public.fn_apartados_cascade_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_apartado numeric;
  v_dif      numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public."apartados_pedido" WHERE pedido_id = OLD.id;
    -- DIFERIDAS: sus OC pendientes (sin remisiones) se anulan con la línea.
    UPDATE public."OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "pedido_id" = OLD.id
       AND "Tipo" = 'Traslado'
       AND COALESCE("Traslado_Diferido", false)
       AND COALESCE("Estado",'') = 'Abierta'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = '';
    RETURN OLD;
  END IF;

  IF COALESCE(NEW."Estado_2",'') = 'Anulado'
     AND COALESCE(OLD."Estado_2",'') <> 'Anulado' THEN
    UPDATE public."apartados_pedido"
       SET estado = 'Liberado',
           notas  = TRIM(BOTH ' |' FROM COALESCE(notas,'') || ' | pedido anulado'),
           modificado_por = auth.uid()
     WHERE pedido_id = NEW.id AND estado = 'Activo';

    UPDATE public."OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada')
       AND (
         "pedido_id" IN (
           SELECT p.id FROM public."Pedidos" p
            WHERE p."Nombre_Empresa" = NEW."Nombre_Empresa"
              AND p."Consecutivo"    = NEW."Consecutivo"
              AND p."Cliente" IS NOT DISTINCT FROM NEW."Cliente"
         )
         OR ("pedido_id" IS NULL
             AND "Ref_Pedido" = NEW."Nombre_Empresa" || ' #' || NEW."Consecutivo")
       );
  END IF;

  IF COALESCE(NEW."Estado_2",'') = 'Cerrado'
     AND COALESCE(OLD."Estado_2",'') <> 'Cerrado' THEN
    UPDATE public."apartados_pedido"
       SET estado = 'Liberado',
           notas  = TRIM(BOTH ' |' FROM COALESCE(notas,'') || ' | pedido cerrado'),
           modificado_por = auth.uid()
     WHERE pedido_id = NEW.id AND estado = 'Activo';

    -- DIFERIDAS: cerrar el pedido anula lo que quedó pendiente en sus OC diferidas (si no,
    -- seguirían apartando stock en el origen para siempre). Las piezas ya tramitadas se quedan.
    UPDATE public."OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "pedido_id" = NEW.id
       AND "Tipo" = 'Traslado'
       AND COALESCE("Traslado_Diferido", false)
       AND COALESCE("Estado",'') = 'Abierta'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = '';
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW."Cantidad",0) < COALESCE(OLD."Cantidad",0) THEN
    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado
      FROM public."apartados_pedido"
     WHERE pedido_id = NEW.id AND estado = 'Activo';
    -- DIFERIDAS: lo pendiente en OC diferidas vivas también cuenta como comprometido.
    SELECT COALESCE(SUM("Cantidad"),0) INTO v_dif
      FROM public."OrdenesCompra"
     WHERE "pedido_id" = NEW.id
       AND "Tipo" = 'Traslado'
       AND COALESCE("Traslado_Diferido", false)
       AND COALESCE("Estado",'') = 'Abierta'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = '';
    IF (v_apartado + v_dif) > 0
       AND v_apartado + v_dif + COALESCE(NEW."Cant_Entregada",0) > COALESCE(NEW."Cantidad",0) THEN
      RAISE EXCEPTION 'No se puede dejar la línea en % ud: ya hay % entregadas + % apartadas + % en solicitudes de compra (OC) para este pedido. Descompromete el apartado o libera la OC primero.',
        COALESCE(NEW."Cantidad",0), COALESCE(NEW."Cant_Entregada",0), v_apartado, v_dif;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 5. Aviso a contabilidad: se calla mientras corre el RPC de trámite ──────
CREATE OR REPLACE FUNCTION public.fn_oc_avisar_contabilidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- DIFERIDAS: el RPC tramitar_traslado_oc avisa por su cuenta (un aviso por pasada, con el RE).
  IF COALESCE(current_setting('app.oc_tramite', true), '') = 'on' THEN RETURN NEW; END IF;

  IF NULLIF(btrim(COALESCE(NEW."Consecutivo", '')), '') IS NULL THEN RETURN NEW; END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW."Estado_Aprobacion" = 'Aprobada' THEN
        PERFORM public._oc_avisar_contabilidad('aprobada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                               NEW."Consecutivo", v_actor, NEW."creado_por");
      END IF;
    ELSE
      IF NEW."Estado_Aprobacion" IS DISTINCT FROM OLD."Estado_Aprobacion" THEN
        IF NEW."Estado_Aprobacion" = 'Aprobada' THEN
          PERFORM public._oc_avisar_contabilidad('aprobada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                                 NEW."Consecutivo", v_actor, NEW."creado_por");
        ELSIF NEW."Estado_Aprobacion" = 'Rechazada' THEN
          PERFORM public._oc_avisar_contabilidad('rechazada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                                 NEW."Consecutivo", v_actor, NEW."creado_por");
        END IF;
      END IF;

      IF NEW."Estado_Aprobacion" = 'Aprobada'
         AND COALESCE(NEW."Estado", '') <> 'Anulada'
         AND ( (COALESCE(btrim(OLD."Remision"), '')        = '' AND COALESCE(btrim(NEW."Remision"), '')        <> '')
            OR (COALESCE(btrim(OLD."Remision_Origen"), '') = '' AND COALESCE(btrim(NEW."Remision_Origen"), '') <> '') ) THEN
        PERFORM public._oc_avisar_contabilidad('legalizada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                               NEW."Consecutivo", v_actor, NULL);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_oc_avisar_contabilidad(OC id %): %', NEW."id", SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Las funciones de trigger no son llamables por clientes (como las demás del módulo).
REVOKE ALL ON FUNCTION public.fn_oc_diferida_guard() FROM PUBLIC, anon, authenticated;
