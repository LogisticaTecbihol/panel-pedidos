-- ============================================================
-- ESQUEMA COMPLETO: Migración Panel de Pedidos → Supabase
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. TABLAS PRINCIPALES
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "Pedidos" (
  id bigint generated always as identity primary key,
  "Fecha_Procesamiento" text,
  "Nombre_Empresa" text,
  "Consecutivo" text,
  "Fecha_Pedido" text,
  "Cliente" text,
  "NIT" text,
  "Telefono" text,
  "Direccion_Envio" text,
  "Municipio" text,
  "Departamento" text,
  "Comercial" text,
  "Plazo_Pago" text,
  "Precio_Facturacion" text,
  "Producto" text,
  "Presentacion" text,
  "Cantidad" numeric default 0,
  "Valor_Unitario" numeric default 0,
  "Valor_Total" numeric default 0,
  "Total_Orden" numeric default 0,
  "Archivo_Fuente" text default '',
  "Estado" text default 'recibido',
  "ID_Cliente" text default '',
  "ID_Comercial" text default '',
  "ID_Producto" text default '',
  "Cant_Entregada" numeric default 0,
  "Cant_Pendiente" numeric default 0,
  "Estado_Entrega" text default '',
  "Fecha_Ult_Entrega" text default '',
  "Remisiones" text default '',
  "Observaciones" text default '',
  "Estado_2" text default 'Abierto',
  "Bonificado" text default ''
);

CREATE TABLE "Consecutivos" (
  id bigint generated always as identity primary key,
  "N" int,
  "Nombre_Empresa" text,
  "Cliente" text,
  "Fecha_Pedido" text,
  "Consecutivo" text,
  "Comercial" text,
  "Total_Orden" numeric,
  "Archivo_Fuente" text
);

CREATE TABLE "Ingresos" (
  id bigint generated always as identity primary key,
  "Fecha" text,
  "Origen" text,
  "Empresa_Origen" text,
  "Empresa_Destino" text,
  "Producto" text,
  "Presentacion" text,
  "Cantidad" numeric default 0,
  "Responsable" text default '',
  "Remision_Origen" text default '',
  "Remision_Destino" text default '',
  "Observaciones" text default '',
  "Fecha_Registro" text
);

CREATE TABLE "Devoluciones" (
  id bigint generated always as identity primary key,
  "Fecha" text,
  "Empresa" text,
  "Consecutivo" text,
  "Vendedor" text,
  "Cliente" text,
  "NIT" text,
  "Direccion" text,
  "Municipio" text,
  "Departamento" text,
  "Telefono" text,
  "Num_Factura" text,
  "Producto" text,
  "Presentacion" text,
  "Cantidad" numeric default 0,
  "Cant_Entregada" numeric default 0,
  "Valor_Unitario" numeric default 0,
  "Valor_Total" numeric default 0,
  "Motivo" text default '',
  "Observaciones" text default '',
  "Fecha_Registro" text
);

CREATE TABLE "Inventario" (
  id bigint generated always as identity primary key,
  "Fecha" text,
  "Empresa" text,
  "Producto" text,
  "Presentacion" text,
  "Unidad_Medida" text default '',
  "Cantidad_Caja" numeric default 0,
  "Lote" text default '',
  "Cantidad" numeric default 0,
  "Observaciones" text default '',
  "Fecha_Registro" text
);

CREATE TABLE "OrdenesCompra" (
  id bigint generated always as identity primary key,
  "Fecha" text,
  "Empresa_Destino" text,
  "Empresa_Origen" text,
  "Consecutivo" text,
  "Direccion" text,
  "Bodega" text,
  "Municipio" text,
  "Producto" text,
  "Presentacion" text,
  "Cantidad" numeric default 0,
  "Valor_Unitario" numeric default 0,
  "Valor_Total" numeric default 0,
  "Total_Orden" numeric default 0,
  "Observaciones" text default '',
  "Estado" text default 'Abierta',
  "Fecha_Registro" text,
  "Remision" text default '',
  "Remision_Origen" text default ''
);

-- ══════════════════════════════════════════════════════════════
-- 2. TABLAS DIMENSIONALES
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "Clientes" (
  id text primary key,
  "Nombre" text,
  "NIT" text,
  "Telefono" text,
  "Direccion" text,
  "Municipio" text,
  "Departamento" text
);

CREATE TABLE "Comerciales" (
  id text primary key,
  "Nombre" text
);

CREATE TABLE "Productos" (
  id text primary key,
  "Nombre_Empresa" text,
  "Producto" text,
  "Presentacion" text
);

-- ══════════════════════════════════════════════════════════════
-- 3. CATÁLOGOS (autocompletar)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "maestro_productos" (
  id bigint generated always as identity primary key,
  "Producto" text UNIQUE
);

CREATE TABLE "ClientesUnicos" (
  id bigint generated always as identity primary key,
  "Cliente" text,
  "NIT" text,
  "Telefono" text,
  "Direccion" text,
  "Municipio" text,
  "Departamento" text
);

-- ══════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY (acceso anónimo completo)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "Pedidos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Pedidos" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Consecutivos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Consecutivos" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Ingresos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Ingresos" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Devoluciones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Devoluciones" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Inventario" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Inventario" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "OrdenesCompra" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "OrdenesCompra" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Clientes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Clientes" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Comerciales" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Comerciales" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "Productos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "Productos" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "maestro_productos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "maestro_productos" FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE "ClientesUnicos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "ClientesUnicos" FOR ALL TO anon USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 5. FUNCIONES PostgreSQL
-- ══════════════════════════════════════════════════════════════

-- ── rebuild_consecutivos ──
CREATE OR REPLACE FUNCTION rebuild_consecutivos()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  TRUNCATE "Consecutivos";
  INSERT INTO "Consecutivos" ("N", "Nombre_Empresa", "Cliente", "Fecha_Pedido",
    "Consecutivo", "Comercial", "Total_Orden", "Archivo_Fuente")
  SELECT
    ROW_NUMBER() OVER (ORDER BY "Nombre_Empresa", "Cliente", "Fecha_Pedido")::int,
    "Nombre_Empresa", "Cliente", "Fecha_Pedido", "Consecutivo",
    "Comercial", "Total_Orden", "Archivo_Fuente"
  FROM (
    SELECT DISTINCT ON ("Nombre_Empresa", "Cliente", "Fecha_Pedido", "Consecutivo")
      "Nombre_Empresa", "Cliente", "Fecha_Pedido", "Consecutivo",
      "Comercial", "Total_Orden", "Archivo_Fuente"
    FROM "Pedidos"
    ORDER BY "Nombre_Empresa", "Cliente", "Fecha_Pedido", "Consecutivo"
  ) sub;
END;
$$;

-- ── registrar_entrega ──
CREATE OR REPLACE FUNCTION registrar_entrega(
  p_entregas jsonb,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
BEGIN
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
        ELSE "Estado_2" END
    WHERE id = v_row;

    v_order_keys := array_append(v_order_keys, v_emp || '||' || v_con);
    v_updated := v_updated + 1;
  END LOOP;

  IF array_length(v_order_keys, 1) > 0 THEN
    UPDATE "Pedidos"
    SET "Estado_Entrega" = 'Parcial'
    WHERE ("Nombre_Empresa" || '||' || "Consecutivo") = ANY(v_order_keys)
      AND (TRIM(COALESCE("Estado_Entrega", '')) = '' OR LOWER(TRIM("Estado_Entrega")) = 'recibido');
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- ── editar_pedido_completo ──
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
        "Bonificado" = COALESCE(lin->>'Bonificado', "Bonificado")
      WHERE id = v_row;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO "Pedidos" (
        "Fecha_Procesamiento","Nombre_Empresa","Consecutivo","Fecha_Pedido",
        "Cliente","NIT","Telefono","Direccion_Envio","Municipio","Departamento",
        "Comercial","Plazo_Pago","Precio_Facturacion","Producto","Presentacion",
        "Cantidad","Valor_Unitario","Valor_Total","Total_Orden","Archivo_Fuente",
        "Estado","Observaciones","Estado_2","Bonificado"
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
        COALESCE(lin->>'Bonificado', '')
      );
      v_added := v_added + 1;
    END IF;
  END LOOP;

  -- Recalculate Estado_Entrega for all sibling lines of the order
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

-- ── eliminar_pedido_completo ──
CREATE OR REPLACE FUNCTION eliminar_pedido_completo(
  p_empresa text,
  p_consecutivo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM "Pedidos"
  WHERE TRIM("Nombre_Empresa") = TRIM(p_empresa)
    AND TRIM("Consecutivo") = TRIM(p_consecutivo);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM rebuild_consecutivos();
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

-- ── KardexAjustes ──
CREATE TABLE IF NOT EXISTS "KardexAjustes" (
  id bigint generated always as identity primary key,
  "Fecha" text,
  "Empresa" text,
  "Producto" text,
  "Presentacion" text default '',
  "Tipo" text,
  "Cantidad" numeric default 0,
  "Observaciones" text default '',
  "Fecha_Registro" text
);
ALTER TABLE "KardexAjustes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON "KardexAjustes" FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── get_or_create_cliente ──
CREATE OR REPLACE FUNCTION get_or_create_cliente(
  p_cliente text,
  p_nit text,
  p_telefono text DEFAULT '',
  p_direccion text DEFAULT '',
  p_municipio text DEFAULT '',
  p_departamento text DEFAULT ''
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id text;
  v_nit_clean text;
  v_count int;
BEGIN
  v_nit_clean := regexp_replace(TRIM(COALESCE(p_nit, '')), '[\.\s]', '', 'g');
  v_nit_clean := split_part(v_nit_clean, '-', 1);

  IF v_nit_clean != '' THEN
    SELECT id INTO v_id FROM "Clientes"
    WHERE split_part(regexp_replace(TRIM(COALESCE("NIT", '')), '[\.\s]', '', 'g'), '-', 1) = v_nit_clean
    LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  IF COALESCE(p_cliente, '') != '' THEN
    SELECT id INTO v_id FROM "Clientes" WHERE "Nombre" = p_cliente LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  IF COALESCE(p_cliente, '') = '' THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO v_count FROM "Clientes";
  v_id := 'CL-' || LPAD((v_count + 1)::text, 3, '0');
  INSERT INTO "Clientes" (id, "Nombre", "NIT", "Telefono", "Direccion", "Municipio", "Departamento")
  VALUES (v_id, p_cliente, p_nit, p_telefono, p_direccion, p_municipio, p_departamento);
  RETURN v_id;
END;
$$;

-- ── get_or_create_comercial ──
CREATE OR REPLACE FUNCTION get_or_create_comercial(p_comercial text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id text;
  v_count int;
BEGIN
  IF COALESCE(p_comercial, '') = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM "Comerciales" WHERE "Nombre" = p_comercial LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;
  SELECT COUNT(*) INTO v_count FROM "Comerciales";
  v_id := 'CM-' || LPAD((v_count + 1)::text, 3, '0');
  INSERT INTO "Comerciales" (id, "Nombre") VALUES (v_id, p_comercial);
  RETURN v_id;
END;
$$;

-- ── get_or_create_producto ──
CREATE OR REPLACE FUNCTION get_or_create_producto(
  p_producto text,
  p_presentacion text,
  p_empresa text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id text;
  v_count int;
BEGIN
  IF COALESCE(p_producto, '') = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM "Productos"
  WHERE "Nombre_Empresa" = p_empresa AND "Producto" = p_producto AND "Presentacion" = p_presentacion
  LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;
  SELECT COUNT(*) INTO v_count FROM "Productos";
  v_id := 'PR-' || LPAD((v_count + 1)::text, 3, '0');
  INSERT INTO "Productos" (id, "Nombre_Empresa", "Producto", "Presentacion")
  VALUES (v_id, p_empresa, p_producto, p_presentacion);
  RETURN v_id;
END;
$$;
