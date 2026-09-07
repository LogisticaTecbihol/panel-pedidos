-- Corregir hallazgo crítico: RPCs SECURITY DEFINER sin autorización
-- Las 6 funciones ejecutaban como postgres (saltando RLS) sin validar
-- rol ni empresa del usuario. Cualquier usuario autenticado podía
-- editar/borrar pedidos de cualquier empresa.
-- Ejecutado en producción el 2026-08-29. Se versiona como documentación del
-- estado real de la BD (fuera del historial de migraciones de Supabase); no
-- re-ejecutar a ciegas.

-- 1. rebuild_consecutivos: solo admin (hace TRUNCATE)
CREATE OR REPLACE FUNCTION rebuild_consecutivos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  TRUNCATE "Consecutivos";
  INSERT INTO "Consecutivos" ("N","Nombre_Empresa","Cliente","Fecha_Pedido",
    "Consecutivo","Comercial","Total_Orden","Archivo_Fuente")
  SELECT
    ROW_NUMBER() OVER (ORDER BY "Nombre_Empresa","Cliente","Fecha_Pedido")::int,
    "Nombre_Empresa","Cliente","Fecha_Pedido","Consecutivo",
    "Comercial","Total_Orden","Archivo_Fuente"
  FROM (
    SELECT DISTINCT ON ("Nombre_Empresa","Cliente","Fecha_Pedido","Consecutivo")
      "Nombre_Empresa","Cliente","Fecha_Pedido","Consecutivo",
      "Comercial","Total_Orden","Archivo_Fuente"
    FROM "Pedidos"
    ORDER BY "Nombre_Empresa","Cliente","Fecha_Pedido","Consecutivo"
  ) sub;
END;
$$;

-- 2. eliminar_pedido_completo: rol + empresa
CREATE OR REPLACE FUNCTION eliminar_pedido_completo(p_empresa text, p_consecutivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF NOT (public.user_has_company(p_empresa)
          AND public.get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  DELETE FROM "Pedidos"
  WHERE TRIM("Nombre_Empresa") = TRIM(p_empresa)
    AND TRIM("Consecutivo") = TRIM(p_consecutivo);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM rebuild_consecutivos();
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

-- 3. generar_remision: rol + empresa
CREATE OR REPLACE FUNCTION generar_remision(p_empresa_nombre text, p_tipo text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sigla TEXT;
  v_nuevo_numero INT;
  v_sufijo TEXT;
BEGIN
  IF NOT (public.user_has_company(p_empresa_nombre)
          AND public.get_user_role() = ANY(ARRAY['admin','editor','despachador','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_sigla := CASE
    WHEN TRIM(p_empresa_nombre) ILIKE '%PARCELAR%' THEN 'PARCELAR'
    WHEN TRIM(p_empresa_nombre) ILIKE '%GREEN%'    THEN 'GREEN'
    WHEN TRIM(p_empresa_nombre) ILIKE '%RESO%'     THEN 'RESO'
    WHEN TRIM(p_empresa_nombre) ILIKE '%INSUMOS AGROPECUARIOS SOSTENIBLES%' THEN 'IASO'
    WHEN TRIM(p_empresa_nombre) ILIKE '%INSUMOS AGROPECUARIOS DE LA SABANA%' THEN 'IAS'
    WHEN TRIM(p_empresa_nombre) = 'PARCELAR' THEN 'PARCELAR'
    WHEN TRIM(p_empresa_nombre) = 'GREEN'    THEN 'GREEN'
    WHEN TRIM(p_empresa_nombre) = 'RESO'     THEN 'RESO'
    WHEN TRIM(p_empresa_nombre) = 'IASO'     THEN 'IASO'
    WHEN TRIM(p_empresa_nombre) = 'IAS'      THEN 'IAS'
    ELSE NULL
  END;

  IF v_sigla IS NULL THEN
    RAISE EXCEPTION 'Empresa no reconocida: %', p_empresa_nombre;
  END IF;

  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo invalido: %. Debe ser ENTRADA o SALIDA', p_tipo;
  END IF;

  v_sufijo := CASE WHEN p_tipo = 'ENTRADA' THEN 'RE' ELSE 'RS' END;

  UPDATE "consecutivos_remisiones"
  SET ultimo_numero = ultimo_numero + 1
  WHERE empresa = v_sigla AND tipo = p_tipo
  RETURNING ultimo_numero INTO v_nuevo_numero;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consecutivo no encontrado para empresa=%, tipo=%', v_sigla, p_tipo;
  END IF;

  RETURN v_sigla || '-' || v_sufijo || '-' || LPAD(v_nuevo_numero::TEXT, 4, '0');
END;
$$;

-- 4. generar_remision_dual: rol + ambas empresas
CREATE OR REPLACE FUNCTION generar_remision_dual(p_empresa_salida text, p_empresa_entrada text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rem_salida TEXT;
  v_rem_entrada TEXT;
BEGIN
  IF NOT (public.user_has_company(p_empresa_salida)
          AND public.user_has_company(p_empresa_entrada)
          AND public.get_user_role() = ANY(ARRAY['admin','editor','despachador','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_rem_salida  := generar_remision(p_empresa_salida,  'SALIDA');
  v_rem_entrada := generar_remision(p_empresa_entrada, 'ENTRADA');

  RETURN jsonb_build_object(
    'remision_salida',  v_rem_salida,
    'remision_entrada', v_rem_entrada
  );
END;
$$;

-- 5. registrar_entrega: rol (opera por row IDs, no tiene parametro empresa)
CREATE OR REPLACE FUNCTION registrar_entrega(p_entregas jsonb, p_observaciones text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ent jsonb;
  v_row bigint;
  v_cant_pedida numeric;
  v_prev_entregada numeric;
  v_nueva_entregada numeric;
  v_pendiente numeric;
  v_estado text;
  v_prev_rem text;
  v_new_rem text;
  v_updated int := 0;
  v_order_keys text[] := '{}';
  v_emp text;
  v_con text;
  v_uid UUID := auth.uid();
BEGIN
  IF NOT (public.get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','despachador','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR ent IN SELECT * FROM jsonb_array_elements(p_entregas)
  LOOP
    v_row := (ent->>'row')::bigint;
    IF v_row IS NULL THEN CONTINUE; END IF;

    SELECT "Cantidad", COALESCE("Cant_Entregada", 0), COALESCE("Remisiones", ''),
           "Nombre_Empresa", "Consecutivo"
    INTO v_cant_pedida, v_prev_entregada, v_prev_rem, v_emp, v_con
    FROM "Pedidos" WHERE id = v_row;

    IF NOT FOUND THEN CONTINUE; END IF;

    v_nueva_entregada := v_prev_entregada + COALESCE((ent->>'cantidad')::numeric, 0);
    v_pendiente := GREATEST(0, v_cant_pedida - v_nueva_entregada);
    v_estado := CASE WHEN v_pendiente <= 0 THEN
      CASE WHEN ent->>'remision' IS NOT NULL AND ent->>'remision' != '' THEN 'Entregado' ELSE 'Alistado' END
      ELSE 'Parcial' END;
    v_new_rem := CASE
      WHEN ent->>'remision' IS NOT NULL AND ent->>'remision' != ''
      THEN CASE WHEN v_prev_rem != '' THEN v_prev_rem || ', ' || (ent->>'remision') ELSE ent->>'remision' END
      ELSE v_prev_rem
    END;

    UPDATE "Pedidos" SET
      "Cant_Entregada" = v_nueva_entregada,
      "Cant_Pendiente" = v_pendiente,
      "Estado_Entrega" = v_estado,
      "Fecha_Ult_Entrega" = ent->>'fecha',
      "Remisiones" = v_new_rem,
      "Observaciones" = COALESCE(p_observaciones, "Observaciones"),
      "Estado_2" = CASE WHEN v_pendiente <= 0 THEN
        CASE WHEN ent->>'remision' IS NOT NULL AND ent->>'remision' != '' THEN 'Cerrado' ELSE 'Alistado' END
        ELSE "Estado_2" END,
      modificado_por = v_uid
    WHERE id = v_row;

    v_order_keys := array_append(v_order_keys, v_emp || '||' || v_con);
    v_updated := v_updated + 1;
  END LOOP;

  IF array_length(v_order_keys, 1) > 0 THEN
    UPDATE "Pedidos"
    SET "Estado_Entrega" = 'Parcial',
        modificado_por = v_uid
    WHERE ("Nombre_Empresa" || '||' || "Consecutivo") = ANY(v_order_keys)
      AND (TRIM(COALESCE("Estado_Entrega", '')) = '' OR LOWER(TRIM("Estado_Entrega")) = 'recibido');
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- 6. editar_pedido_completo: rol + empresa
CREATE OR REPLACE FUNCTION editar_pedido_completo(p_header jsonb, p_lineas jsonb, p_delete_ids bigint[] DEFAULT '{}'::bigint[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  lin jsonb;
  v_row bigint;
  v_updated int := 0;
  v_added int := 0;
  v_deleted int := 0;
  v_uid UUID := auth.uid();
BEGIN
  IF NOT (public.user_has_company(p_header->>'Nombre_Empresa')
          AND public.get_user_role() = ANY(ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) THEN
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
