-- ============================================================
-- Migración: BodegasConsignacion — catálogo de bodegas en
--            consignación por empresa, y su enlace desde Pedidos.
--
-- Formaliza lo que hoy se hacía a mano (Consignacion='Sí' + un
-- "cliente" cuyo nombre empieza por "Bodega X" para IASO, o valores
-- fijos de Bodega_Facturacion para PARCELAR — ver
-- js/bodegas-consignacion.js, función _bcCalifica/_bcBodegaKey).
--
-- El flujo "Nuevo Traslado" en pedidos.html elige la bodega de este
-- catálogo y sigue llenando Pedidos.Cliente/Sucursal con su nombre,
-- así que js/bodegas-consignacion.js NO se modifica: los traslados
-- nuevos ya califican por Consignacion='Sí' igual que hoy.
-- Bodega_Consignacion_Id es solo trazabilidad hacia el catálogo.
--
-- Histórico NO se toca (sin backfill ni reclasificación retroactiva).
-- Aplicar con apply_migration del MCP de Supabase (no se aplica con
-- el push a GitHub).
-- Fecha: 2026-09-16
-- ============================================================

-- ── 1. Catálogo ──
CREATE TABLE IF NOT EXISTS public."BodegasConsignacion" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Nombre_Empresa" text NOT NULL DEFAULT '',
  "Nombre"         text NOT NULL DEFAULT '',
  "Municipio"      text NOT NULL DEFAULT '',
  "Departamento"   text NOT NULL DEFAULT '',
  "Direccion"      text NOT NULL DEFAULT '',
  "Activo"         boolean NOT NULL DEFAULT true,
  "creado_por" uuid,
  "creado_por_nombre" text,
  "creado_en" timestamptz,
  "modificado_por" uuid,
  "modificado_por_nombre" text,
  "modificado_en" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS bodegas_consignacion_empresa_nombre_uq
  ON public."BodegasConsignacion" ("Nombre_Empresa", "Nombre");
-- NOTA: reemplazado por bodegas_consignacion_empresa_nombre_municipio_uq,
-- ver fix_bodegas_consignacion_uq_incluye_municipio.sql (2026-09-17).

COMMENT ON TABLE public."BodegasConsignacion" IS
  'Catálogo de bodegas en consignación por empresa, usado por el flujo "Nuevo Traslado" de pedidos.html.';


-- ── 2. RLS (patrón maestro_productos: lectura amplia, escritura staff) ──
ALTER TABLE public."BodegasConsignacion" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BodegasConsignacion_select" ON public."BodegasConsignacion";
DROP POLICY IF EXISTS "BodegasConsignacion_insert" ON public."BodegasConsignacion";
DROP POLICY IF EXISTS "BodegasConsignacion_update" ON public."BodegasConsignacion";
DROP POLICY IF EXISTS "BodegasConsignacion_delete" ON public."BodegasConsignacion";

CREATE POLICY "BodegasConsignacion_select" ON public."BodegasConsignacion"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "BodegasConsignacion_insert" ON public."BodegasConsignacion"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

CREATE POLICY "BodegasConsignacion_update" ON public."BodegasConsignacion"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

CREATE POLICY "BodegasConsignacion_delete" ON public."BodegasConsignacion"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

GRANT ALL ON public."BodegasConsignacion" TO anon, authenticated, service_role;


-- ── 3. Auditoría (mismo patrón genérico que ClientesUnicos/maestro_productos) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."BodegasConsignacion";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."BodegasConsignacion"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."BodegasConsignacion";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."BodegasConsignacion"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ── 4. Enlace desde Pedidos ──
ALTER TABLE public."Pedidos"
  ADD COLUMN IF NOT EXISTS "Bodega_Consignacion_Id" bigint REFERENCES public."BodegasConsignacion"(id);


-- ── 5. editar_pedido_completo: persistir Bodega_Consignacion_Id también al editar ──
-- Redefinición completa de la función existente (mismo cuerpo) + el
-- nuevo campo en el UPDATE y en el INSERT de línea nueva.
CREATE OR REPLACE FUNCTION public.editar_pedido_completo(p_header jsonb, p_lineas jsonb, p_delete_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  lin jsonb;
  v_row bigint;
  v_updated int := 0;
  v_added int := 0;
  v_deleted int := 0;
  v_uid UUID := auth.uid();
  v_role text := public.get_user_role();
BEGIN
  IF NOT public.user_has_company(p_header->>'Nombre_Empresa') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_role = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']) THEN
    NULL; -- staff: acceso completo dentro de su(s) empresa(s)
  ELSIF v_role = 'comercial' THEN
    -- Solo su propio pedido (mismo criterio que las politicas RLS de "Pedidos").
    IF NOT EXISTS (
      SELECT 1 FROM "Pedidos"
      WHERE "Nombre_Empresa" = p_header->>'Nombre_Empresa'
        AND "Consecutivo" = p_header->>'Consecutivo'
        AND (comercial_id = v_uid OR creado_por = v_uid)
    ) THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
    -- Las lineas a actualizar (__row) deben pertenecer a ese mismo pedido.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lineas) AS le(lin)
      WHERE (le.lin->>'__row') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Pedidos" p
          WHERE p.id = (le.lin->>'__row')::bigint
            AND p."Nombre_Empresa" = p_header->>'Nombre_Empresa'
            AND p."Consecutivo" = p_header->>'Consecutivo'
        )
    ) THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
    -- Tampoco puede borrar lineas de otro pedido.
    IF p_delete_ids IS NOT NULL AND array_length(p_delete_ids, 1) > 0 AND EXISTS (
      SELECT 1 FROM "Pedidos" p
      WHERE p.id = ANY(p_delete_ids)
        AND NOT (p."Nombre_Empresa" = p_header->>'Nombre_Empresa' AND p."Consecutivo" = p_header->>'Consecutivo')
    ) THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
  ELSE
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR lin IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    v_row := (lin->>'__row')::bigint;
    IF v_row IS NOT NULL THEN
      UPDATE "Pedidos" SET
        "Cliente" = COALESCE(p_header->>'Cliente', "Cliente"),
        "NIT" = COALESCE(p_header->>'NIT', "NIT"),
        "Fecha_Pedido" = COALESCE(p_header->>'Fecha_Pedido', "Fecha_Pedido"),
        "Fecha_Compromiso" = COALESCE(p_header->>'Fecha_Compromiso', "Fecha_Compromiso"),
        "Comercial" = COALESCE(p_header->>'Comercial', "Comercial"),
        "Municipio" = COALESCE(p_header->>'Municipio', "Municipio"),
        "Departamento" = COALESCE(p_header->>'Departamento', "Departamento"),
        "Telefono" = COALESCE(p_header->>'Telefono', "Telefono"),
        "Plazo_Pago" = COALESCE(p_header->>'Plazo_Pago', "Plazo_Pago"),
        "Precio_Facturacion" = COALESCE(p_header->>'Precio_Facturacion', "Precio_Facturacion"),
        "Facturar_A" = COALESCE(p_header->>'Facturar_A', "Facturar_A"),
        "NIT_Adicional" = COALESCE(p_header->>'NIT_Adicional', "NIT_Adicional"),
        "Consignacion" = COALESCE(p_header->>'Consignacion', "Consignacion"),
        "Bodega_Facturacion" = COALESCE(p_header->>'Bodega_Facturacion', "Bodega_Facturacion"),
        "Sucursal" = COALESCE(p_header->>'Sucursal', "Sucursal"),
        "Bodega_Consignacion_Id" = COALESCE((p_header->>'Bodega_Consignacion_Id')::bigint, "Bodega_Consignacion_Id"),
        "Total_Orden" = COALESCE((p_header->>'Total_Orden')::numeric, "Total_Orden"),
        "Estado_2" = COALESCE(p_header->>'Estado_2', "Estado_2"),
        "Producto" = COALESCE(lin->>'Producto', "Producto"),
        "Presentacion" = COALESCE(lin->>'Presentacion', "Presentacion"),
        "Cantidad" = COALESCE((lin->>'Cantidad')::numeric, "Cantidad"),
        "Valor_Unitario" = COALESCE((lin->>'Valor_Unitario')::numeric, "Valor_Unitario"),
        "Valor_Total" = COALESCE((lin->>'Valor_Total')::numeric, "Valor_Total"),
        "Cant_Entregada" = COALESCE((lin->>'Cant_Entregada')::numeric, "Cant_Entregada"),
        "Cant_Pendiente" = COALESCE((lin->>'Cant_Pendiente')::numeric, "Cant_Pendiente"),
        "Estado_Entrega" = COALESCE(lin->>'Estado_Entrega', "Estado_Entrega"),
        "Fecha_Ult_Entrega" = COALESCE(NULLIF(lin->>'Fecha_Ult_Entrega', ''), "Fecha_Ult_Entrega"),
        "Remisiones" = COALESCE(lin->>'Remisiones', "Remisiones"),
        "Bonificado" = COALESCE(lin->>'Bonificado', "Bonificado"),
        modificado_por = v_uid
      WHERE id = v_row;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO "Pedidos" (
        "Fecha_Procesamiento","Nombre_Empresa","Consecutivo","Fecha_Pedido","Fecha_Compromiso",
        "Cliente","NIT","Telefono","Direccion_Envio","Municipio","Departamento",
        "Comercial","Plazo_Pago","Precio_Facturacion","Producto","Presentacion",
        "Cantidad","Valor_Unitario","Valor_Total","Total_Orden","Archivo_Fuente",
        "Estado","Observaciones","Estado_2","Bonificado",
        "Facturar_A","NIT_Adicional","Consignacion","Bodega_Facturacion","Sucursal",
        "Bodega_Consignacion_Id",
        creado_por
      ) VALUES (
        COALESCE(lin->>'Fecha_Procesamiento', p_header->>'Fecha_Procesamiento', ''),
        COALESCE(lin->>'Nombre_Empresa', p_header->>'Nombre_Empresa', ''),
        COALESCE(lin->>'Consecutivo', p_header->>'Consecutivo', ''),
        COALESCE(lin->>'Fecha_Pedido', p_header->>'Fecha_Pedido', ''),
        COALESCE(lin->>'Fecha_Compromiso', p_header->>'Fecha_Compromiso', ''),
        COALESCE(lin->>'Cliente', p_header->>'Cliente', ''),
        COALESCE(lin->>'NIT', p_header->>'NIT', ''),
        COALESCE(lin->>'Telefono', p_header->>'Telefono', ''),
        COALESCE(lin->>'Direccion_Envio', p_header->>'Direccion_Envio', ''),
        COALESCE(lin->>'Municipio', p_header->>'Municipio', ''),
        COALESCE(lin->>'Departamento', p_header->>'Departamento', ''),
        COALESCE(lin->>'Comercial', p_header->>'Comercial', ''),
        COALESCE(lin->>'Plazo_Pago', p_header->>'Plazo_Pago', ''),
        COALESCE(lin->>'Precio_Facturacion', p_header->>'Precio_Facturacion', ''),
        COALESCE(lin->>'Producto', ''),
        COALESCE(lin->>'Presentacion', ''),
        COALESCE((lin->>'Cantidad')::numeric, 0),
        COALESCE((lin->>'Valor_Unitario')::numeric, 0),
        COALESCE((lin->>'Valor_Total')::numeric, 0),
        COALESCE((p_header->>'Total_Orden')::numeric, 0),
        COALESCE(lin->>'Archivo_Fuente', p_header->>'Archivo_Fuente', ''),
        'recibido',
        COALESCE(lin->>'Observaciones', p_header->>'Observaciones', ''),
        'Abierto',
        COALESCE(lin->>'Bonificado', ''),
        COALESCE(p_header->>'Facturar_A', ''),
        COALESCE(p_header->>'NIT_Adicional', ''),
        COALESCE(p_header->>'Consignacion', 'No'),
        COALESCE(p_header->>'Bodega_Facturacion', ''),
        COALESCE(p_header->>'Sucursal', ''),
        NULLIF(p_header->>'Bodega_Consignacion_Id','')::bigint,
        v_uid
      );
      v_added := v_added + 1;
    END IF;
  END LOOP;

  IF p_header->>'Nombre_Empresa' IS NOT NULL AND p_header->>'Consecutivo' IS NOT NULL THEN
    WITH order_stats AS (
      SELECT bool_or(COALESCE("Cant_Entregada", 0) > 0) AS any_delivery
      FROM "Pedidos"
      WHERE "Nombre_Empresa" = p_header->>'Nombre_Empresa'
        AND "Consecutivo" = p_header->>'Consecutivo'
    )
    UPDATE "Pedidos" p SET
      "Estado_Entrega" = CASE
        WHEN COALESCE(p."Cantidad", 0) > 0 AND COALESCE(p."Cant_Entregada", 0) >= p."Cantidad" THEN 'Entregado'
        WHEN COALESCE(p."Cant_Entregada", 0) > 0 THEN 'Parcial'
        WHEN os.any_delivery THEN 'Parcial'
        ELSE 'Recibido'
      END
    FROM order_stats os
    WHERE p."Nombre_Empresa" = p_header->>'Nombre_Empresa'
      AND p."Consecutivo" = p_header->>'Consecutivo';
  END IF;

  IF array_length(p_delete_ids, 1) > 0 THEN
    DELETE FROM "Pedidos" WHERE id = ANY(p_delete_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated, 'added', v_added, 'deleted', v_deleted);
END;
$function$;


-- ── 6. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_bodegas_consignacion
-- ============================================================
