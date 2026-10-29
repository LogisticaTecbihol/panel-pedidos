-- ============================================================
-- Migración: reservar_stock_oc_traslado — al legalizarse una OC de
--            traslado ligada a una línea de pedido, las unidades que
--            trajo quedan APARTADAS para ESA línea en la empresa destino.
--
-- Problema: la solicitud de compra de un pedido (OrdenesCompra Tipo='Traslado',
-- Estado='Abierta', con pedido_id) aparta el stock contra la empresa ORIGEN
-- mientras no tiene Remision_Origen. Al legalizarse (Remision / Remision_Origen)
-- esa reserva desaparece y las unidades entran a la empresa destino como
-- existencia común: nada decía que eran del pedido que las pidió, y cualquier
-- otro pedido de esa empresa podía tomarlas en «+ Añadir» (EntregasPedido
-- .orden_compra_id estaba vacío en las 1.046 filas).
--
-- Solución (capa derivada, igual que apartados_pedido): al recibir la OC su
-- Remision de destino se crea/amplía un apartado Activo de la misma línea en
-- Empresa_Destino, con orden_compra_id = esa OC y una nota «Reservado por OC …».
-- A partir de ahí el apartado reduce el disponible neto de los demás pedidos y
-- la línea lo despacha con «Emitir entrega» (consumir_apartados_pedido).
--
-- Reglas:
--   • Se aparta MIN(Cantidad de la OC, hueco de la línea), con
--     hueco = Cantidad − Cant_Entregada − apartados activos de la línea.
--     Si la OC trajo de más (o la línea ya se surtió de otro stock), el
--     sobrante queda como existencia libre.
--   • Línea anulada, OC anulada, OC sin pedido_id o empresa destino distinta
--     de la del pedido: no se aparta nada.
--   • NUNCA bloquea la legalización: cualquier fallo (p. ej. pedido «Pendiente
--     de aprobación», que el trigger de apartados rechaza) queda como WARNING
--     y la OC se legaliza igual; las unidades quedan libres.
--   • Anulación del pedido / bajar su cantidad: ya lo cubre
--     fn_apartados_cascade_pedido (libera / exige descomprometer).
--   • Solo aplica hacia adelante, más la regularización de abajo: las OC
--     legalizadas antes del cambio no se tocan, salvo las de líneas que
--     siguen abiertas con unidades traídas y sin despachar.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase (no se aplica
-- con el push) ANTES de publicar el código de pedidos.js.
-- Fecha: 2026-10-29
-- ============================================================


-- ── 1. Reserva de UNA fila de OC (uso interno: trigger y regularización) ──
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

REVOKE ALL ON FUNCTION public.reservar_stock_oc_traslado(bigint) FROM public, anon, authenticated;


-- ── 2. Trigger: la OC recibe su Remision de destino (se legaliza) ──
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

REVOKE ALL ON FUNCTION public.fn_oc_traslado_reserva_pedido() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_oc_traslado_reserva_pedido ON public."OrdenesCompra";
CREATE TRIGGER trg_oc_traslado_reserva_pedido
  AFTER UPDATE ON public."OrdenesCompra"
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_traslado_reserva_pedido();


-- ── 3. Regularización de las OC ya legalizadas ──
-- Solo líneas que SIGUEN ABIERTAS y a las que la OC trajo más unidades de las
-- que han salido por entrega desde esa empresa. El tope «hueco» de la función
-- evita pasarse de lo pedido, y volver a correr esto no reserva dos veces.
DO $$
DECLARE
  r record;
  v numeric;
  v_filas int := 0;
  v_uds numeric := 0;
BEGIN
  FOR r IN
    SELECT oc."id"
      FROM "OrdenesCompra" oc
      JOIN "Pedidos" p ON p."id" = oc."pedido_id"
     WHERE oc."Tipo" = 'Traslado'
       AND oc."Estado" = 'Cerrada'
       AND COALESCE(TRIM(oc."Remision"),'') <> ''
       AND COALESCE(p."Estado_2",'') <> 'Anulado'
       AND COALESCE(p."Cant_Entregada",0) < COALESCE(p."Cantidad",0)
       AND (SELECT COALESCE(SUM(o2."Cantidad"),0) FROM "OrdenesCompra" o2
             WHERE o2."pedido_id" = oc."pedido_id" AND o2."Tipo" = 'Traslado'
               AND o2."Estado" = 'Cerrada' AND o2."Empresa_Destino" = oc."Empresa_Destino")
           > (SELECT COALESCE(SUM(e.cantidad),0) FROM "EntregasPedido" e
               WHERE e.pedido_id = oc."pedido_id" AND e.empresa_stock = oc."Empresa_Destino")
     ORDER BY oc."id"
  LOOP
    v := public.reservar_stock_oc_traslado(r."id");
    IF v > 0 THEN v_filas := v_filas + 1; v_uds := v_uds + v; END IF;
  END LOOP;
  RAISE NOTICE 'reservar_stock_oc_traslado: % apartado(s) regularizado(s), % ud', v_filas, v_uds;
END $$;


-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración reservar_stock_oc_traslado
-- ============================================================
