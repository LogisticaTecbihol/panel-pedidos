-- ============================================================
-- Migración: apartados_pedido — columna `bonificado` + ajuste de
--            la cascada de integridad.
--
-- Contexto: al replicar el "apartado" en el módulo de muestras se
-- fijó la regla de prioridad de liberación: las MUESTRAS y las
-- LÍNEAS DE PEDIDO BONIFICADAS son el grupo más protegido (lo
-- último que se libera). Para que el ranking del panel "quién tiene
-- este producto apartado" sepa si una línea de pedido es bonificada
-- sin depender de un JOIN vivo, se denormaliza `Pedidos.Bonificado`
-- en la fila de apartado al crearla.
--
-- Además: la cascada `fn_apartados_cascade_pedido` bloqueaba
-- cualquier UPDATE de `Pedidos` que cambiara `Cant_Entregada` cuando
-- había apartado activo — lo que rompía el flujo normal de
-- "Emitir entrega desde apartado" (la entrega sube Cant_Entregada
-- ANTES de que consumir_apartados_pedido baje el apartado). Se
-- restringe el chequeo a cuando `Cantidad` REALMENTE baja (que es el
-- caso que la guardia quería cubrir: "no dejar la línea con menos
-- cantidad de la ya comprometida").
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase.
-- Fecha: 2026-09-09
-- ============================================================


-- ── 1. Columna nueva ──
ALTER TABLE public."apartados_pedido"
  ADD COLUMN IF NOT EXISTS "bonificado" text NOT NULL DEFAULT '';

COMMENT ON COLUMN public."apartados_pedido"."bonificado" IS
  'Copia de Pedidos.Bonificado al apartar (''Sí'' / ''''). Grupo protegido en el ranking de liberación junto con las muestras.';


-- ── 2. RPC crear_apartados_pedido: además guarda `bonificado` ──
CREATE OR REPLACE FUNCTION public.crear_apartados_pedido(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_item jsonb;
  v_pedido_id bigint;
  v_empresa_stock text;
  v_cantidad numeric;
  v_ped record;
  v_apartado_linea numeric;
  v_existe boolean;
  v_creados int := 0;
  v_actualizados int := 0;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'No autorizado: solo administración o edición pueden apartar stock';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items debe ser un arreglo JSON';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pedido_id     := NULLIF(v_item->>'pedido_id','')::bigint;
    v_empresa_stock := TRIM(COALESCE(v_item->>'empresa_stock',''));
    v_cantidad      := COALESCE(NULLIF(v_item->>'cantidad','')::numeric, 0);

    IF v_pedido_id IS NULL OR v_empresa_stock = '' OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Item inválido (pedido_id=%, empresa_stock=%, cantidad=%)',
        v_pedido_id, v_empresa_stock, v_cantidad;
    END IF;

    SELECT "id","Nombre_Empresa","Consecutivo","Cliente","Producto","Presentacion",
           "Cantidad","Cant_Entregada","Estado_2","Plazo_Pago","Precio_Facturacion",
           "Fecha_Compromiso","Bonificado"
      INTO v_ped
      FROM "Pedidos" WHERE "id" = v_pedido_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La línea de pedido % no existe', v_pedido_id;
    END IF;
    IF COALESCE(v_ped."Estado_2",'') = 'Anulado' THEN
      RAISE EXCEPTION 'La línea de pedido % está anulada', v_pedido_id;
    END IF;

    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado_linea
      FROM "apartados_pedido"
     WHERE pedido_id = v_pedido_id AND estado = 'Activo';

    IF v_apartado_linea + COALESCE(v_ped."Cant_Entregada",0) + v_cantidad > COALESCE(v_ped."Cantidad",0) THEN
      RAISE EXCEPTION 'Apartado excede lo pedido en la línea % (pedida %, entregada %, ya apartada %, intento %)',
        v_pedido_id, COALESCE(v_ped."Cantidad",0), COALESCE(v_ped."Cant_Entregada",0),
        v_apartado_linea, v_cantidad;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM "apartados_pedido"
       WHERE pedido_id = v_pedido_id AND empresa_stock = v_empresa_stock AND estado = 'Activo'
    ) INTO v_existe;

    INSERT INTO "apartados_pedido" (
      pedido_id, empresa_pedido, consecutivo, cliente, producto, presentacion,
      empresa_stock, cantidad, estado, plazo_pago, precio_facturacion, fecha_compromiso, bonificado
    ) VALUES (
      v_pedido_id, v_ped."Nombre_Empresa", v_ped."Consecutivo", COALESCE(v_ped."Cliente",''),
      COALESCE(v_ped."Producto",''), COALESCE(v_ped."Presentacion",''),
      v_empresa_stock, v_cantidad, 'Activo',
      COALESCE(v_ped."Plazo_Pago",''), COALESCE(v_ped."Precio_Facturacion",''),
      COALESCE(v_ped."Fecha_Compromiso",''), COALESCE(v_ped."Bonificado",'')
    )
    ON CONFLICT (pedido_id, empresa_stock) WHERE estado = 'Activo'
    DO UPDATE SET
      cantidad           = "apartados_pedido".cantidad + EXCLUDED.cantidad,
      plazo_pago         = EXCLUDED.plazo_pago,
      precio_facturacion = EXCLUDED.precio_facturacion,
      fecha_compromiso   = EXCLUDED.fecha_compromiso,
      bonificado         = EXCLUDED.bonificado,
      modificado_por     = auth.uid();

    IF v_existe THEN v_actualizados := v_actualizados + 1;
    ELSE v_creados := v_creados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creados', v_creados, 'actualizados', v_actualizados);
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_apartados_pedido(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_apartados_pedido(jsonb) TO authenticated;


-- ── 3. Cascada: solo evaluar el tope cuando Cantidad BAJA ──
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

  -- Anulación del pedido: soltar apartados activos + OC de traslado abiertas
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
       AND "Ref_Pedido" = NEW."Nombre_Empresa" || ' #' || NEW."Consecutivo"
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada');
  END IF;

  -- No permitir dejar la línea con menos cantidad de la ya comprometida
  -- (entregada + apartado activo). Solo cuando Cantidad REALMENTE baja
  -- (el aumento de Cant_Entregada del despacho lo concilia consumir_*).
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

REVOKE ALL ON FUNCTION public.fn_apartados_cascade_pedido() FROM public, anon, authenticated;


-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_bonificado_apartados_pedido
-- ============================================================
