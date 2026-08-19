-- Agregar columna Sucursal a Pedidos (aplica cuando un mismo cliente tiene varias sucursales)
ALTER TABLE "Pedidos" ADD COLUMN IF NOT EXISTS "Sucursal" text DEFAULT '';

-- Actualizar funcion editar_pedido_completo para incluir Sucursal
CREATE OR REPLACE FUNCTION editar_pedido_completo(
  p_header jsonb,
  p_lineas jsonb,
  p_delete_ids bigint[] DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  lin jsonb;
  v_row bigint;
  v_updated int := 0;
  v_added int := 0;
  v_deleted int := 0;
  v_uid UUID := auth.uid();
BEGIN
  FOR lin IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    v_row := (lin->>'__row')::bigint;
    IF v_row IS NOT NULL THEN
      UPDATE "Pedidos" SET
        "Cliente" = COALESCE(p_header->>'Cliente', "Cliente"),
        "NIT" = COALESCE(p_header->>'NIT', "NIT"),
        "Fecha_Pedido" = COALESCE(p_header->>'Fecha_Pedido', "Fecha_Pedido"),
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
        "Fecha_Procesamiento","Nombre_Empresa","Consecutivo","Fecha_Pedido",
        "Cliente","NIT","Telefono","Direccion_Envio","Municipio","Departamento",
        "Comercial","Plazo_Pago","Precio_Facturacion","Producto","Presentacion",
        "Cantidad","Valor_Unitario","Valor_Total","Total_Orden","Archivo_Fuente",
        "Estado","Observaciones","Estado_2","Bonificado",
        "Facturar_A","NIT_Adicional","Consignacion","Bodega_Facturacion","Sucursal",
        creado_por
      ) VALUES (
        COALESCE(lin->>'Fecha_Procesamiento', p_header->>'Fecha_Procesamiento', ''),
        COALESCE(lin->>'Nombre_Empresa', p_header->>'Nombre_Empresa', ''),
        COALESCE(lin->>'Consecutivo', p_header->>'Consecutivo', ''),
        COALESCE(lin->>'Fecha_Pedido', p_header->>'Fecha_Pedido', ''),
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
$$;
