-- ROLLBACK de oc_traslado_diferido.sql
-- Quita el candado y restituye las cuatro funciones a su cuerpo anterior (el vigente en producción el
-- 2026-11-11). Las columnas "Traslado_Diferido" y "Traslado_Padre_Id" se DEJAN (inofensivas, y
-- conservan el rastro de qué OC se tramitaron); para quitarlas, descomenta el final.
-- Revertir primero oc_traslado_diferido_activar_rollback.sql y tramitar_traslado_oc_rollback.sql.
-- Fecha: 2026-11-11

DROP TRIGGER IF EXISTS trg_oc_diferida_guard ON public."OrdenesCompra";
DROP FUNCTION IF EXISTS public.fn_oc_diferida_guard();

CREATE OR REPLACE FUNCTION public.fn_oc_traslado_reserva_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW."Tipo" = 'Traslado'
     AND NEW."pedido_id" IS NOT NULL
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
  SELECT "id","Tipo","Estado","Remision","Empresa_Destino","Consecutivo","Cantidad","pedido_id"
    INTO v_oc
    FROM "OrdenesCompra" WHERE "id" = p_oc_id;

  IF NOT FOUND
     OR v_oc."Tipo" IS DISTINCT FROM 'Traslado'
     OR v_oc."pedido_id" IS NULL
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

CREATE OR REPLACE FUNCTION public.fn_apartados_cascade_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_apartado numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public."apartados_pedido" WHERE pedido_id = OLD.id;
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
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW."Cantidad",0) < COALESCE(OLD."Cantidad",0) THEN
    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado
      FROM public."apartados_pedido"
     WHERE pedido_id = NEW.id AND estado = 'Activo';
    IF v_apartado > 0
       AND v_apartado + COALESCE(NEW."Cant_Entregada",0) > COALESCE(NEW."Cantidad",0) THEN
      RAISE EXCEPTION 'No se puede dejar la línea en % ud: ya hay % entregadas + % apartadas para este pedido. Descompromete el apartado primero.',
        COALESCE(NEW."Cantidad",0), COALESCE(NEW."Cant_Entregada",0), v_apartado;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_oc_avisar_contabilidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
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

-- Para quitar también las columnas (pierde el rastro de las piezas tramitadas):
-- ALTER TABLE public."OrdenesCompra" DROP COLUMN IF EXISTS "Traslado_Padre_Id";
-- ALTER TABLE public."OrdenesCompra" DROP COLUMN IF EXISTS "Traslado_Diferido";
