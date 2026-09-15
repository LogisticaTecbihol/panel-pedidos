-- ============================================================
-- Guard: una OC de Traslado (solicitud de compra automática que
-- genera "Apartar stock de otra empresa") no puede exceder lo
-- pedido en la línea de Pedidos/SolicitudMuestras que la originó.
--
-- PROBLEMA (reportado 2026-09-15, IASO Muestra #5, BA-BOR-ZINC
-- X LITRO): apartar con stock de OTRA empresa NO pasa por
-- apartados_pedido/apartados_muestra (que sí validan el tope vía
-- crear_apartados_pedido/crear_apartados_muestra) — persistirOCSolicitudes
-- (js/asignacion-inventario.js) y persistirEntregasYTraslados
-- (js/pedidos.js) insertan la OC Tipo='Traslado' directo desde el
-- cliente, sin ninguna validación de cantidad. Repetir el botón
-- "Apartar" 3 veces sobre una solicitud de 2 ud generó 3 OC de 2 ud
-- (6 ud) sin ningún aviso, porque además _buildOCsLegalizadasMu()
-- sólo indexa OCs YA legalizadas (con Remisión) — una OC "Abierta"
-- sin legalizar es invisible en la solicitud.
--
-- SOLUCIÓN
--   1) OrdenesCompra.muestra_id (bigint) — mismo patrón que
--      pedido_id (orden_compra_pedido_id_link.sql): vínculo preciso
--      OC de traslado ↔ línea de SolicitudMuestras. Se rellena en
--      el insert (js/muestras.js vía asignacion-inventario.js) y se
--      hace backfill de las OC históricas por Ref_Pedido.
--   2) Trigger fn_oc_traslado_no_excede(): al insertar/actualizar
--      una OC Tipo='Traslado' Estado='Abierta' con pedido_id o
--      muestra_id, suma lo ya entregado + apartados_pedido/
--      apartados_muestra activos + OTRAS OC de traslado abiertas de
--      esa misma línea; si el total (+ esta OC) excede la Cantidad
--      de la línea, RAISE EXCEPTION. Sólo aplica a OC de
--      Pedidos/Muestras — Cambios y compras manuales (sin
--      pedido_id/muestra_id) no se tocan.
--   3) liberar_apartados_muestra ahora también anula la OC de
--      traslado abierta de la línea cuando se libera con
--      p_muestra_id específico (antes sólo pasaba al liberar TODA
--      la solicitud con p_muestra_id NULL).
--
-- El backfill se hace ANTES de crear el trigger para no arriesgar
-- que datos históricos ya inconsistentes bloqueen la migración.
-- Aplicar con apply_migration del MCP de Supabase (no se aplica
-- con el push). Idempotente.
-- Fecha: 2026-09-15
-- ============================================================


-- ── 1. Columna muestra_id (espejo de pedido_id) ──
ALTER TABLE "OrdenesCompra" ADD COLUMN IF NOT EXISTS muestra_id bigint;

COMMENT ON COLUMN "OrdenesCompra".muestra_id IS
  'Línea de SolicitudMuestras (id) que originó esta OC de traslado. NULL para OC no ligadas a una muestra (compras, cambios, pedidos).';

CREATE INDEX IF NOT EXISTS idx_ordenescompra_muestra_id
  ON "OrdenesCompra" (muestra_id) WHERE muestra_id IS NOT NULL;


-- ── 2. Backfill de OC de traslado históricas ligadas a una muestra ──
--    (antes de crear el trigger — ver nota arriba)
WITH parsed AS (
  SELECT o.id AS oc_id, o."Producto" AS oc_prod, o."Presentacion" AS oc_pres,
         TRIM(SUBSTRING(o."Ref_Pedido" FROM '^(.*)\s+Muestra\s+#')) AS emp,
         TRIM(SUBSTRING(o."Ref_Pedido" FROM 'Muestra\s+#(.*)$'))   AS num
  FROM "OrdenesCompra" o
  WHERE o."Tipo" ILIKE 'traslado'
    AND o.muestra_id IS NULL
    AND COALESCE(o."Ref_Pedido",'') ~* 'Muestra\s+#'
),
cand AS (
  SELECT p.oc_id, sm.id AS mu_id,
         ROW_NUMBER() OVER (
           PARTITION BY p.oc_id
           ORDER BY (UPPER(TRIM(sm."Producto")) = UPPER(TRIM(p.oc_prod))) DESC,
                    (UPPER(TRIM(COALESCE(sm."Presentacion",''))) = UPPER(TRIM(COALESCE(p.oc_pres,'')))) DESC,
                    sm.id ASC
         ) AS rn
  FROM parsed p
  JOIN "SolicitudMuestras" sm
    ON LOWER(TRIM(sm."Empresa")) = LOWER(p.emp)
   AND TRIM(sm."Consecutivo")    = p.num
)
UPDATE "OrdenesCompra" o
   SET muestra_id = c.mu_id
  FROM cand c
 WHERE c.oc_id = o.id
   AND c.rn = 1;


-- ── 3. liberar_apartados_muestra: anular también la OC de traslado
--       abierta de la línea cuando se libera un apartado puntual ──
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
    -- Liberar TODA la solicitud: anular por Ref_Pedido (cubre también
    -- OC históricas sin muestra_id resuelto).
    UPDATE "OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND "Ref_Pedido" = p_empresa || ' Muestra #' || p_consecutivo
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada')
       AND (p_empresa_stock IS NULL OR "Empresa_Origen" = p_empresa_stock);
    GET DIAGNOSTICS v_ocs = ROW_COUNT;
  ELSE
    -- Liberar UNA línea puntual: anular por muestra_id (preciso,
    -- no se cuela con otra línea de la misma solicitud).
    UPDATE "OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND muestra_id = p_muestra_id
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada')
       AND (p_empresa_stock IS NULL OR "Empresa_Origen" = p_empresa_stock);
    GET DIAGNOSTICS v_ocs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'liberados', v_liberados, 'ocs_anuladas', v_ocs);
END;
$function$;

REVOKE ALL ON FUNCTION public.liberar_apartados_muestra(text,text,bigint,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_apartados_muestra(text,text,bigint,text,text) TO authenticated;


-- ── 4. Trigger guard: OC de Traslado no puede exceder lo pedido ──
CREATE OR REPLACE FUNCTION public.fn_oc_traslado_no_excede()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cant numeric;
  v_ent numeric;
  v_apartado numeric;
  v_oc_abiertas numeric;
BEGIN
  IF NEW."Tipo" IS DISTINCT FROM 'Traslado' OR COALESCE(NEW."Estado",'') <> 'Abierta' THEN
    RETURN NEW;
  END IF;

  IF NEW.pedido_id IS NOT NULL THEN
    SELECT "Cantidad","Cant_Entregada" INTO v_cant, v_ent
      FROM "Pedidos" WHERE "id" = NEW.pedido_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado
      FROM "apartados_pedido" WHERE pedido_id = NEW.pedido_id AND estado = 'Activo';

    SELECT COALESCE(SUM("Cantidad"),0) INTO v_oc_abiertas
      FROM "OrdenesCompra"
     WHERE "Tipo" = 'Traslado' AND "Estado" = 'Abierta'
       AND pedido_id = NEW.pedido_id
       AND "id" IS DISTINCT FROM NEW.id;

    IF v_apartado + COALESCE(v_ent,0) + v_oc_abiertas + COALESCE(NEW."Cantidad",0) > COALESCE(v_cant,0) THEN
      RAISE EXCEPTION 'La solicitud de compra excede lo pedido en la línea % de Pedidos (pedida %, entregada %, apartada %, OC abiertas %, intento %)',
        NEW.pedido_id, COALESCE(v_cant,0), COALESCE(v_ent,0), v_apartado, v_oc_abiertas, COALESCE(NEW."Cantidad",0);
    END IF;

  ELSIF NEW.muestra_id IS NOT NULL THEN
    SELECT "Cantidad","Cant_Entregada" INTO v_cant, v_ent
      FROM "SolicitudMuestras" WHERE "id" = NEW.muestra_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT COALESCE(SUM(cantidad),0) INTO v_apartado
      FROM "apartados_muestra" WHERE muestra_id = NEW.muestra_id AND estado = 'Activo';

    SELECT COALESCE(SUM("Cantidad"),0) INTO v_oc_abiertas
      FROM "OrdenesCompra"
     WHERE "Tipo" = 'Traslado' AND "Estado" = 'Abierta'
       AND muestra_id = NEW.muestra_id
       AND "id" IS DISTINCT FROM NEW.id;

    IF v_apartado + COALESCE(v_ent,0) + v_oc_abiertas + COALESCE(NEW."Cantidad",0) > COALESCE(v_cant,0) THEN
      RAISE EXCEPTION 'La solicitud de compra excede lo pedido en la línea % de SolicitudMuestras (pedida %, entregada %, apartada %, OC abiertas %, intento %)',
        NEW.muestra_id, COALESCE(v_cant,0), COALESCE(v_ent,0), v_apartado, v_oc_abiertas, COALESCE(NEW."Cantidad",0);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_oc_traslado_no_excede ON "OrdenesCompra";
CREATE TRIGGER trg_oc_traslado_no_excede
  BEFORE INSERT OR UPDATE ON "OrdenesCompra"
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_traslado_no_excede();

REVOKE ALL ON FUNCTION public.fn_oc_traslado_no_excede() FROM public, anon, authenticated;


-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración guard_oc_traslado_pedido_muestra
-- ============================================================
