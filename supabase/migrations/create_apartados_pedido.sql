-- ============================================================
-- Migración: apartados_pedido — reserva de stock para un pedido
--            sin descontar existencias físicas.
--
-- Un "apartado" es una capa DERIVADA sobre el saldo del Kardex:
-- nunca es un movimiento de inventario. Reserva N unidades de un
-- producto en una empresa (empresa_stock) para una línea de pedido,
-- de modo que el "disponible neto" (= existencia − apartado) que se
-- ofrece a otros pedidos baja, pero la existencia física no cambia.
--
--   estado:  Activo    → reserva vigente (resta del disponible neto)
--            Liberado  → se descomprometió (vuelve al disponible)
--            Consumido → se convirtió en entrega real (remisión)
--
-- El caso "stock de otra empresa" NO crea fila aquí: lo cubre la OC
-- Tipo='Traslado' Estado='Abierta' sin remisión que el flujo de
-- pedidos ya genera (js/pedidos.js:persistirEntregasYTraslados).
--
-- RLS + auditoría siguen el patrón de solicitudes_reabastecimiento.
-- Idempotente. Aplicar con apply_migration del MCP de Supabase
-- (no se aplica con el push).
-- Fecha: 2026-09-08
-- ============================================================


-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."apartados_pedido" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "pedido_id"          bigint  NOT NULL,            -- Pedidos.id de LA LÍNEA
  "empresa_pedido"     text    NOT NULL DEFAULT '',
  "consecutivo"        text    NOT NULL DEFAULT '',
  "cliente"            text    NOT NULL DEFAULT '',
  "producto"           text    NOT NULL DEFAULT '', -- nombre crudo (= Pedidos.Producto)
  "presentacion"       text    NOT NULL DEFAULT '',
  "empresa_stock"      text    NOT NULL DEFAULT '', -- de qué empresa sale la reserva
  "cantidad"           numeric NOT NULL DEFAULT 0,  -- cantidad ACTIVA reservada
  "estado"             text    NOT NULL DEFAULT 'Activo',  -- Activo | Liberado | Consumido
  "plazo_pago"         text    NOT NULL DEFAULT '', -- copia de Pedidos al crear (ranking prioridad)
  "precio_facturacion" text    NOT NULL DEFAULT '',
  "fecha_compromiso"   text    NOT NULL DEFAULT '', -- Pedidos.Fecha_Compromiso es text
  "remision"           text    NOT NULL DEFAULT '', -- se llena al consumir
  "orden_compra_id"    bigint,                      -- reservado Fase E (cross-empresa con fila propia)
  "notas"              text    NOT NULL DEFAULT '',
  "creado_por" uuid,
  "creado_por_nombre" text,
  "creado_en" timestamptz,
  "modificado_por" uuid,
  "modificado_por_nombre" text,
  "modificado_en" timestamptz
);

-- Una sola fila ACTIVA por (línea, empresa origen). El histórico
-- Liberado/Consumido queda como tombstone (lo captura fn_audit_log).
CREATE UNIQUE INDEX IF NOT EXISTS apartados_pedido_activo_uq
  ON public."apartados_pedido" ("pedido_id","empresa_stock")
  WHERE "estado" = 'Activo';
CREATE INDEX IF NOT EXISTS apartados_pedido_estado
  ON public."apartados_pedido" ("estado");
CREATE INDEX IF NOT EXISTS apartados_pedido_prod_emp
  ON public."apartados_pedido" ("producto","empresa_stock");
CREATE INDEX IF NOT EXISTS apartados_pedido_pedido
  ON public."apartados_pedido" ("pedido_id");
CREATE INDEX IF NOT EXISTS apartados_pedido_emp_consec
  ON public."apartados_pedido" ("empresa_pedido","consecutivo");

COMMENT ON TABLE public."apartados_pedido" IS
  'Reserva de stock para un pedido sin descontar existencias físicas. estado Activo|Liberado|Consumido. Capa derivada: nunca es movimiento de Kardex.';


-- ── 2. RLS (patrón solicitudes_reabastecimiento) ──
ALTER TABLE public."apartados_pedido" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "apartados_pedido_select" ON public."apartados_pedido";
DROP POLICY IF EXISTS "apartados_pedido_insert" ON public."apartados_pedido";
DROP POLICY IF EXISTS "apartados_pedido_update" ON public."apartados_pedido";
DROP POLICY IF EXISTS "apartados_pedido_delete" ON public."apartados_pedido";

-- Lectura amplia: la capa de existencias la consume desde Kardex/Dashboard/Reab/Pedidos.
CREATE POLICY "apartados_pedido_select" ON public."apartados_pedido"
  FOR SELECT TO authenticated USING (true);

-- Escritura: defensa en profundidad. El flujo real pasa por las RPC SECURITY DEFINER.
CREATE POLICY "apartados_pedido_insert" ON public."apartados_pedido"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor']));

CREATE POLICY "apartados_pedido_update" ON public."apartados_pedido"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor']));

CREATE POLICY "apartados_pedido_delete" ON public."apartados_pedido"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']));

GRANT ALL ON public."apartados_pedido" TO anon, authenticated, service_role;


-- ── 3. Auditoría ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."apartados_pedido";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."apartados_pedido"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."apartados_pedido";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."apartados_pedido"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ── 4. Cascada de integridad desde Pedidos ──
--   • línea anulada  → apartados activos de esa línea a 'Liberado'
--                      + OC de traslado abiertas del pedido a 'Anulada'
--   • línea borrada  → se borran sus apartados
--   • bajar Cantidad por debajo de lo ya apartado → EXCEPTION
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
  -- (entregada + apartado activo)
  IF TG_OP = 'UPDATE'
     AND (NEW."Cantidad" IS DISTINCT FROM OLD."Cantidad"
          OR NEW."Cant_Entregada" IS DISTINCT FROM OLD."Cant_Entregada") THEN
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

DROP TRIGGER IF EXISTS trg_apartados_cascade_pedido ON "Pedidos";
CREATE TRIGGER trg_apartados_cascade_pedido
  BEFORE UPDATE OR DELETE ON "Pedidos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_apartados_cascade_pedido();

REVOKE ALL ON FUNCTION public.fn_apartados_cascade_pedido() FROM public, anon, authenticated;


-- ── 5. RPC: crear / ampliar apartados ──
--   p_items = [{pedido_id, empresa_stock, cantidad}, ...]
--   (producto/presentación/plazo/precio/fecha se leen de Pedidos, no del cliente)
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
           "Cantidad","Cant_Entregada","Estado_2","Plazo_Pago","Precio_Facturacion","Fecha_Compromiso"
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
      empresa_stock, cantidad, estado, plazo_pago, precio_facturacion, fecha_compromiso
    ) VALUES (
      v_pedido_id, v_ped."Nombre_Empresa", v_ped."Consecutivo", COALESCE(v_ped."Cliente",''),
      COALESCE(v_ped."Producto",''), COALESCE(v_ped."Presentacion",''),
      v_empresa_stock, v_cantidad, 'Activo',
      COALESCE(v_ped."Plazo_Pago",''), COALESCE(v_ped."Precio_Facturacion",''),
      COALESCE(v_ped."Fecha_Compromiso",'')
    )
    ON CONFLICT (pedido_id, empresa_stock) WHERE estado = 'Activo'
    DO UPDATE SET
      cantidad           = "apartados_pedido".cantidad + EXCLUDED.cantidad,
      plazo_pago         = EXCLUDED.plazo_pago,
      precio_facturacion = EXCLUDED.precio_facturacion,
      fecha_compromiso   = EXCLUDED.fecha_compromiso,
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


-- ── 6. RPC: liberar ("Descomprometer") ──
CREATE OR REPLACE FUNCTION public.liberar_apartados_pedido(
  p_empresa text,
  p_consecutivo text,
  p_pedido_id bigint DEFAULT NULL,
  p_empresa_stock text DEFAULT NULL,
  p_motivo text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_liberados int := 0;
  v_ocs int := 0;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'No autorizado: solo administración o edición pueden descomprometer stock';
  END IF;

  UPDATE "apartados_pedido"
     SET estado = 'Liberado',
         notas  = COALESCE(NULLIF(TRIM(p_motivo),''), 'liberado manualmente'),
         modificado_por = auth.uid()
   WHERE empresa_pedido = p_empresa
     AND consecutivo = p_consecutivo
     AND estado = 'Activo'
     AND (p_pedido_id IS NULL OR pedido_id = p_pedido_id)
     AND (p_empresa_stock IS NULL OR empresa_stock = p_empresa_stock);
  GET DIAGNOSTICS v_liberados = ROW_COUNT;

  -- OC de traslado abiertas del pedido: anular en liberación total
  -- (o solo las del origen concreto si se pasó p_empresa_stock)
  IF p_pedido_id IS NULL THEN
    UPDATE "OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND "Ref_Pedido" = p_empresa || ' #' || p_consecutivo
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada')
       AND (p_empresa_stock IS NULL OR "Empresa_Origen" = p_empresa_stock);
    GET DIAGNOSTICS v_ocs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'liberados', v_liberados, 'ocs_anuladas', v_ocs);
END;
$function$;

REVOKE ALL ON FUNCTION public.liberar_apartados_pedido(text,text,bigint,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_apartados_pedido(text,text,bigint,text,text) TO authenticated;


-- ── 7. RPC: consumir (al emitir la remisión definitiva) ──
CREATE OR REPLACE FUNCTION public.consumir_apartados_pedido(
  p_pedido_id bigint,
  p_empresa_stock text,
  p_cantidad numeric,
  p_remision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_row "apartados_pedido"%ROWTYPE;
  v_consumido numeric := 0;
  v_restante numeric := 0;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor','remisionador','despachador') THEN
    RAISE EXCEPTION 'No autorizado para consumir apartados';
  END IF;

  SELECT * INTO v_row FROM "apartados_pedido"
   WHERE pedido_id = p_pedido_id AND empresa_stock = p_empresa_stock AND estado = 'Activo'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'consumido', 0, 'restante', 0, 'sin_apartado', true);
  END IF;

  IF COALESCE(p_cantidad,0) >= v_row.cantidad THEN
    UPDATE "apartados_pedido"
       SET estado = 'Consumido', remision = COALESCE(p_remision,''), modificado_por = auth.uid()
     WHERE id = v_row.id;
    v_consumido := v_row.cantidad;
    v_restante := 0;
  ELSE
    UPDATE "apartados_pedido"
       SET cantidad = cantidad - p_cantidad, modificado_por = auth.uid()
     WHERE id = v_row.id;
    v_consumido := p_cantidad;
    v_restante := v_row.cantidad - p_cantidad;
  END IF;

  RETURN jsonb_build_object('ok', true, 'consumido', v_consumido, 'restante', v_restante);
END;
$function$;

REVOKE ALL ON FUNCTION public.consumir_apartados_pedido(bigint,text,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consumir_apartados_pedido(bigint,text,numeric,text) TO authenticated;


-- ── 8. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_apartados_pedido
-- ============================================================
