-- ============================================================
-- Migración: apartados_muestra — reserva de stock para una
--            solicitud de muestras sin descontar existencias.
--
-- Espejo de apartados_pedido (ver create_apartados_pedido.sql):
-- un "apartado" es una capa DERIVADA sobre el saldo del Kardex,
-- nunca un movimiento de inventario. Reserva N unidades de un
-- producto en una empresa (empresa_stock) para una LÍNEA de
-- SolicitudMuestras, de modo que el "disponible neto" (= existencia
-- − apartado) que se ofrece a otros pedidos/muestras baja, pero la
-- existencia física no cambia.
--
--   estado:  Activo    → reserva vigente (resta del disponible neto)
--            Liberado  → se descomprometió (vuelve al disponible)
--            Consumido → se convirtió en despacho real (remisión)
--
-- Solo se puede apartar una solicitud con Estado_Aprobacion='Aprobada'.
-- El caso "stock de otra empresa" NO crea fila aquí: lo cubre la OC
-- Tipo='Traslado' Estado='Abierta' sin remisión que el flujo de
-- muestras ya genera (asignacion-inventario.js:persistirOCSolicitudes,
-- con Ref_Pedido = "<Empresa> Muestra #<Consecutivo>").
--
-- RLS + auditoría siguen el patrón de apartados_pedido.
-- Idempotente. Aplicar con apply_migration del MCP de Supabase
-- (no se aplica con el push).
-- Fecha: 2026-09-09
-- ============================================================


-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."apartados_muestra" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "muestra_id"         bigint  NOT NULL,            -- SolicitudMuestras.id de LA LÍNEA
  "empresa_muestra"    text    NOT NULL DEFAULT '',
  "consecutivo"        text    NOT NULL DEFAULT '',
  "responsable"        text    NOT NULL DEFAULT '',
  "solicitante"        text    NOT NULL DEFAULT '',
  "producto"           text    NOT NULL DEFAULT '', -- nombre crudo (= SolicitudMuestras.Producto)
  "presentacion"       text    NOT NULL DEFAULT '',
  "empresa_stock"      text    NOT NULL DEFAULT '', -- de qué empresa sale la reserva
  "cantidad"           numeric NOT NULL DEFAULT 0,  -- cantidad ACTIVA reservada
  "estado"             text    NOT NULL DEFAULT 'Activo',  -- Activo | Liberado | Consumido
  "fecha_despacho"     text    NOT NULL DEFAULT '', -- copia de SolicitudMuestras al apartar
  "fecha_aplicacion"   text    NOT NULL DEFAULT '',
  "remision"           text    NOT NULL DEFAULT '', -- se llena al consumir
  "orden_compra_id"    bigint,
  "notas"              text    NOT NULL DEFAULT '',
  "creado_por" uuid,
  "creado_por_nombre" text,
  "creado_en" timestamptz,
  "modificado_por" uuid,
  "modificado_por_nombre" text,
  "modificado_en" timestamptz
);

-- Una sola fila ACTIVA por (línea, empresa origen).
CREATE UNIQUE INDEX IF NOT EXISTS apartados_muestra_activo_uq
  ON public."apartados_muestra" ("muestra_id","empresa_stock")
  WHERE "estado" = 'Activo';
CREATE INDEX IF NOT EXISTS apartados_muestra_estado
  ON public."apartados_muestra" ("estado");
CREATE INDEX IF NOT EXISTS apartados_muestra_prod_emp
  ON public."apartados_muestra" ("producto","empresa_stock");
CREATE INDEX IF NOT EXISTS apartados_muestra_muestra
  ON public."apartados_muestra" ("muestra_id");
CREATE INDEX IF NOT EXISTS apartados_muestra_emp_consec
  ON public."apartados_muestra" ("empresa_muestra","consecutivo");

COMMENT ON TABLE public."apartados_muestra" IS
  'Reserva de stock para una solicitud de muestras sin descontar existencias físicas. estado Activo|Liberado|Consumido. Capa derivada: nunca es movimiento de Kardex. Espejo de apartados_pedido.';


-- ── 2. RLS (patrón apartados_pedido) ──
ALTER TABLE public."apartados_muestra" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "apartados_muestra_select" ON public."apartados_muestra";
DROP POLICY IF EXISTS "apartados_muestra_insert" ON public."apartados_muestra";
DROP POLICY IF EXISTS "apartados_muestra_update" ON public."apartados_muestra";
DROP POLICY IF EXISTS "apartados_muestra_delete" ON public."apartados_muestra";

-- Lectura amplia: la capa de existencias la consume desde Kardex/Dashboard/Reab/Pedidos/Muestras.
CREATE POLICY "apartados_muestra_select" ON public."apartados_muestra"
  FOR SELECT TO authenticated USING (true);

-- Escritura: defensa en profundidad. El flujo real pasa por las RPC SECURITY DEFINER.
CREATE POLICY "apartados_muestra_insert" ON public."apartados_muestra"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor']));

CREATE POLICY "apartados_muestra_update" ON public."apartados_muestra"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor']));

CREATE POLICY "apartados_muestra_delete" ON public."apartados_muestra"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']));

GRANT ALL ON public."apartados_muestra" TO anon, authenticated, service_role;


-- ── 3. Auditoría ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."apartados_muestra";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."apartados_muestra"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."apartados_muestra";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."apartados_muestra"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ── 4. Cascada de integridad desde SolicitudMuestras ──
--   • solicitud rechazada  → apartados activos de esa línea a 'Liberado'
--                            + OC de traslado abiertas de la muestra a 'Anulada'
--   • línea borrada        → se borran sus apartados
--   • bajar Cantidad por debajo de lo ya apartado → EXCEPTION
--     (solo cuando Cantidad realmente baja; el aumento de Cant_Entregada
--      del despacho no dispara nada — consumir_apartados_muestra lo concilia)
CREATE OR REPLACE FUNCTION public.fn_apartados_cascade_muestra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_apartado numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public."apartados_muestra" WHERE muestra_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Rechazo de la solicitud: soltar apartados activos + OC de traslado abiertas
  IF COALESCE(NEW."Estado_Aprobacion",'') = 'Rechazada'
     AND COALESCE(OLD."Estado_Aprobacion",'') <> 'Rechazada' THEN
    UPDATE public."apartados_muestra"
       SET estado = 'Liberado',
           notas  = TRIM(BOTH ' |' FROM COALESCE(notas,'') || ' | solicitud rechazada'),
           modificado_por = auth.uid()
     WHERE muestra_id = NEW.id AND estado = 'Activo';

    UPDATE public."OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND "Ref_Pedido" = NEW."Empresa" || ' Muestra #' || NEW."Consecutivo"
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada');
  END IF;

  -- No permitir dejar la línea con menos cantidad de la ya comprometida
  -- (entregada + apartado activo). Solo se evalúa cuando Cantidad BAJA.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW."Cantidad",0) < COALESCE(OLD."Cantidad",0) THEN
    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado
      FROM public."apartados_muestra"
     WHERE muestra_id = NEW.id AND estado = 'Activo';
    IF v_apartado > 0
       AND v_apartado + COALESCE(NEW."Cant_Entregada",0) > COALESCE(NEW."Cantidad",0) THEN
      RAISE EXCEPTION 'No se puede dejar la línea en % ud: ya hay % entregadas + % apartadas para esta muestra. Descompromete el apartado primero.',
        COALESCE(NEW."Cantidad",0), COALESCE(NEW."Cant_Entregada",0), v_apartado;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_apartados_cascade_muestra ON "SolicitudMuestras";
CREATE TRIGGER trg_apartados_cascade_muestra
  BEFORE UPDATE OR DELETE ON "SolicitudMuestras"
  FOR EACH ROW EXECUTE FUNCTION public.fn_apartados_cascade_muestra();

REVOKE ALL ON FUNCTION public.fn_apartados_cascade_muestra() FROM public, anon, authenticated;


-- ── 5. RPC: crear / ampliar apartados de muestra ──
--   p_items = [{muestra_id, empresa_stock, cantidad}, ...]
--   (producto/presentación/responsable/fechas se leen de SolicitudMuestras)
CREATE OR REPLACE FUNCTION public.crear_apartados_muestra(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_item jsonb;
  v_muestra_id bigint;
  v_empresa_stock text;
  v_cantidad numeric;
  v_mu record;
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
    v_muestra_id    := NULLIF(v_item->>'muestra_id','')::bigint;
    v_empresa_stock := TRIM(COALESCE(v_item->>'empresa_stock',''));
    v_cantidad      := COALESCE(NULLIF(v_item->>'cantidad','')::numeric, 0);

    IF v_muestra_id IS NULL OR v_empresa_stock = '' OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Item inválido (muestra_id=%, empresa_stock=%, cantidad=%)',
        v_muestra_id, v_empresa_stock, v_cantidad;
    END IF;

    SELECT "id","Empresa","Consecutivo","Responsable","Solicitante","Producto","Presentacion",
           "Cantidad","Cant_Entregada","Estado_Aprobacion","Fecha_Despacho","Fecha_Aplicacion"
      INTO v_mu
      FROM "SolicitudMuestras" WHERE "id" = v_muestra_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La línea de muestra % no existe', v_muestra_id;
    END IF;
    IF COALESCE(v_mu."Estado_Aprobacion",'') <> 'Aprobada' THEN
      RAISE EXCEPTION 'Solo se puede apartar stock de una solicitud APROBADA (línea %)', v_muestra_id;
    END IF;

    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado_linea
      FROM "apartados_muestra"
     WHERE muestra_id = v_muestra_id AND estado = 'Activo';

    IF v_apartado_linea + COALESCE(v_mu."Cant_Entregada",0) + v_cantidad > COALESCE(v_mu."Cantidad",0) THEN
      RAISE EXCEPTION 'Apartado excede lo solicitado en la línea % (pedida %, entregada %, ya apartada %, intento %)',
        v_muestra_id, COALESCE(v_mu."Cantidad",0), COALESCE(v_mu."Cant_Entregada",0),
        v_apartado_linea, v_cantidad;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM "apartados_muestra"
       WHERE muestra_id = v_muestra_id AND empresa_stock = v_empresa_stock AND estado = 'Activo'
    ) INTO v_existe;

    INSERT INTO "apartados_muestra" (
      muestra_id, empresa_muestra, consecutivo, responsable, solicitante, producto, presentacion,
      empresa_stock, cantidad, estado, fecha_despacho, fecha_aplicacion
    ) VALUES (
      v_muestra_id, COALESCE(v_mu."Empresa",''), COALESCE(v_mu."Consecutivo",''),
      COALESCE(v_mu."Responsable",''), COALESCE(v_mu."Solicitante",''),
      COALESCE(v_mu."Producto",''), COALESCE(v_mu."Presentacion",''),
      v_empresa_stock, v_cantidad, 'Activo',
      COALESCE(v_mu."Fecha_Despacho",''), COALESCE(v_mu."Fecha_Aplicacion",'')
    )
    ON CONFLICT (muestra_id, empresa_stock) WHERE estado = 'Activo'
    DO UPDATE SET
      cantidad        = "apartados_muestra".cantidad + EXCLUDED.cantidad,
      fecha_despacho  = EXCLUDED.fecha_despacho,
      fecha_aplicacion = EXCLUDED.fecha_aplicacion,
      modificado_por  = auth.uid();

    IF v_existe THEN v_actualizados := v_actualizados + 1;
    ELSE v_creados := v_creados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creados', v_creados, 'actualizados', v_actualizados);
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_apartados_muestra(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_apartados_muestra(jsonb) TO authenticated;


-- ── 6. RPC: liberar ("Descomprometer") ──
CREATE OR REPLACE FUNCTION public.liberar_apartados_muestra(
  p_empresa text,
  p_consecutivo text,
  p_muestra_id bigint DEFAULT NULL,
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

  UPDATE "apartados_muestra"
     SET estado = 'Liberado',
         notas  = COALESCE(NULLIF(TRIM(p_motivo),''), 'liberado manualmente'),
         modificado_por = auth.uid()
   WHERE empresa_muestra = p_empresa
     AND consecutivo = p_consecutivo
     AND estado = 'Activo'
     AND (p_muestra_id IS NULL OR muestra_id = p_muestra_id)
     AND (p_empresa_stock IS NULL OR empresa_stock = p_empresa_stock);
  GET DIAGNOSTICS v_liberados = ROW_COUNT;

  IF p_muestra_id IS NULL THEN
    UPDATE "OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND "Ref_Pedido" = p_empresa || ' Muestra #' || p_consecutivo
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada')
       AND (p_empresa_stock IS NULL OR "Empresa_Origen" = p_empresa_stock);
    GET DIAGNOSTICS v_ocs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'liberados', v_liberados, 'ocs_anuladas', v_ocs);
END;
$function$;

REVOKE ALL ON FUNCTION public.liberar_apartados_muestra(text,text,bigint,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_apartados_muestra(text,text,bigint,text,text) TO authenticated;


-- ── 7. RPC: consumir (al emitir la remisión de despacho) ──
CREATE OR REPLACE FUNCTION public.consumir_apartados_muestra(
  p_muestra_id bigint,
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
  v_row "apartados_muestra"%ROWTYPE;
  v_consumido numeric := 0;
  v_restante numeric := 0;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor','remisionador','despachador','comercial') THEN
    RAISE EXCEPTION 'No autorizado para consumir apartados';
  END IF;

  SELECT * INTO v_row FROM "apartados_muestra"
   WHERE muestra_id = p_muestra_id AND empresa_stock = p_empresa_stock AND estado = 'Activo'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'consumido', 0, 'restante', 0, 'sin_apartado', true);
  END IF;

  IF COALESCE(p_cantidad,0) >= v_row.cantidad THEN
    UPDATE "apartados_muestra"
       SET estado = 'Consumido', remision = COALESCE(p_remision,''), modificado_por = auth.uid()
     WHERE id = v_row.id;
    v_consumido := v_row.cantidad;
    v_restante := 0;
  ELSE
    UPDATE "apartados_muestra"
       SET cantidad = cantidad - p_cantidad, modificado_por = auth.uid()
     WHERE id = v_row.id;
    v_consumido := p_cantidad;
    v_restante := v_row.cantidad - p_cantidad;
  END IF;

  RETURN jsonb_build_object('ok', true, 'consumido', v_consumido, 'restante', v_restante);
END;
$function$;

REVOKE ALL ON FUNCTION public.consumir_apartados_muestra(bigint,text,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consumir_apartados_muestra(bigint,text,numeric,text) TO authenticated;


-- ── 8. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_apartados_muestra
-- ============================================================
