-- ============================================================
-- Migración: apartados de pedido — colisión de consecutivo + cierre
-- ------------------------------------------------------------
-- Problema 1 (colisión): el N° de pedido se numera por comercial, así que
-- (empresa, consecutivo) NO es único (p. ej. IASO #128 = ENCISO AVILA MARINA
-- y AGROEXPORT). liberar_apartados_pedido y la cascada de anulación cruzaban
-- pedidos de clientes distintos por ese par:
--   · "Descomprometer" del pedido A liberaba los apartados del pedido B y
--     anulaba las OC de traslado de B (Ref_Pedido = 'empresa #consecutivo').
--   · anular el pedido A anulaba las OC de traslado de B.
--   Se acotan por línea: OrdenesCompra.pedido_id / apartados_pedido.pedido_id.
--
-- Problema 2 (cierre): un pedido puesto en Estado_2 = 'Cerrado' sin haberse
-- entregado (o sin consumir el apartado) dejaba el apartado 'Activo' para
-- siempre, reservando stock de un pedido ya cerrado. Ahora la cascada libera
-- los apartados al pasar la línea a 'Cerrado', y se limpian los que ya existían.
-- ============================================================


-- ── 1. liberar_apartados_pedido: parámetro nuevo p_pedido_ids ──
-- p_pedido_ids = ids de las líneas (Pedidos.id) del pedido exacto (cliente
-- incluido). NULL = comportamiento anterior (por empresa + consecutivo).
-- Se DROPea la firma vieja: con dos sobrecargas PostgREST no sabría cuál elegir.
DROP FUNCTION IF EXISTS public.liberar_apartados_pedido(text, text, bigint, text, text);

CREATE OR REPLACE FUNCTION public.liberar_apartados_pedido(
  p_empresa text,
  p_consecutivo text,
  p_pedido_id bigint DEFAULT NULL,
  p_empresa_stock text DEFAULT NULL,
  p_motivo text DEFAULT '',
  p_pedido_ids bigint[] DEFAULT NULL
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
     AND (p_pedido_ids IS NULL OR pedido_id = ANY(p_pedido_ids))
     AND (p_empresa_stock IS NULL OR empresa_stock = p_empresa_stock);
  GET DIAGNOSTICS v_liberados = ROW_COUNT;

  -- OC de traslado abiertas del pedido: anular en liberación total.
  -- Con p_pedido_ids solo las de ESAS líneas; las OC históricas sin pedido_id
  -- (y las llamadas antiguas sin p_pedido_ids) siguen cruzando por Ref_Pedido.
  IF p_pedido_id IS NULL THEN
    UPDATE "OrdenesCompra"
       SET "Estado" = 'Anulada'
     WHERE "Tipo" = 'Traslado'
       AND COALESCE("Remision",'') = ''
       AND COALESCE("Remision_Origen",'') = ''
       AND COALESCE("Estado",'') NOT IN ('Anulada','Cerrada')
       AND (
         CASE WHEN p_pedido_ids IS NULL
              THEN "Ref_Pedido" = p_empresa || ' #' || p_consecutivo
              ELSE "pedido_id" = ANY(p_pedido_ids)
                   OR ("pedido_id" IS NULL AND "Ref_Pedido" = p_empresa || ' #' || p_consecutivo)
         END
       )
       AND (p_empresa_stock IS NULL OR "Empresa_Origen" = p_empresa_stock);
    GET DIAGNOSTICS v_ocs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'liberados', v_liberados, 'ocs_anuladas', v_ocs);
END;
$function$;

REVOKE ALL ON FUNCTION public.liberar_apartados_pedido(text,text,bigint,text,text,bigint[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_apartados_pedido(text,text,bigint,text,text,bigint[]) TO authenticated;


-- ── 2. Cascada: anular acota las OC por línea + cerrar libera apartados ──
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

    -- Solo las OC de ESTE pedido (mismo cliente): otro pedido puede compartir
    -- empresa + consecutivo. Las OC históricas sin pedido_id siguen por Ref_Pedido.
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

  -- Cierre del pedido: un pedido cerrado ya no reserva stock. (Si se cierra
  -- porque se entregó todo, consumir_apartados_pedido ya lo dejó 'Consumido' o
  -- no encontrará nada que consumir; ambos casos son inocuos.)
  IF COALESCE(NEW."Estado_2",'') = 'Cerrado'
     AND COALESCE(OLD."Estado_2",'') <> 'Cerrado' THEN
    UPDATE public."apartados_pedido"
       SET estado = 'Liberado',
           notas  = TRIM(BOTH ' |' FROM COALESCE(notas,'') || ' | pedido cerrado'),
           modificado_por = auth.uid()
     WHERE pedido_id = NEW.id AND estado = 'Activo';
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


-- ── 3. Limpieza: apartados 'Activo' de líneas que ya están Cerradas/Anuladas ──
-- Al 2026-09-18 eran 6 (ids 93-98, PARCELAR #833 EL ESTABLO COLOMBIA, cerrado
-- sin entregar). Para revertir: UPDATE apartados_pedido SET estado='Activo'
-- WHERE id IN (93,94,95,96,97,98).
UPDATE public."apartados_pedido" a
   SET estado = 'Liberado',
       notas  = TRIM(BOTH ' |' FROM COALESCE(a.notas,'') || ' | liberado: pedido ya cerrado/anulado (limpieza 2026-09-18)')
  FROM public."Pedidos" p
 WHERE p.id = a.pedido_id
   AND a.estado = 'Activo'
   AND COALESCE(p."Estado_2",'') IN ('Cerrado','Anulado');


-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración fix_apartados_colision_consecutivo_y_cierre
-- ============================================================
