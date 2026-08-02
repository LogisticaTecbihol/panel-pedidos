-- ============================================================
-- TRAZABILIDAD: Auditoría completa de acciones por usuario
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Estrategia A: Columnas creado_por/modificado_por en tablas
-- Estrategia B: Tabla audit_log centralizada con triggers
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- ESTRATEGIA A: Columnas de auditoría en tablas existentes
-- ══════════════════════════════════════════════════════════════

-- Agregar columnas de trazabilidad a las 11 tablas de datos
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Pedidos','Ingresos','Devoluciones','CambiosMercancia',
    'Inventario','OrdenesCompra','SolicitudMuestras',
    'KardexAjustes','KardexNC','Reenvases','RemisionesAnuladas',
    'usuarios'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES auth.users(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS modificado_por UUID REFERENCES auth.users(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMPTZ', t);
  END LOOP;
END $$;

-- Trigger genérico para auto-actualizar modificado_en en cada UPDATE
CREATE OR REPLACE FUNCTION set_modificado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.modificado_en := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Pedidos','Ingresos','Devoluciones','CambiosMercancia',
    'Inventario','OrdenesCompra','SolicitudMuestras',
    'KardexAjustes','KardexNC','Reenvases','RemisionesAnuladas',
    'usuarios'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_modificado_en ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_modificado_en BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_modificado_en()', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- ESTRATEGIA B: Tabla audit_log centralizada
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabla TEXT NOT NULL,
  accion TEXT NOT NULL,
  registro_id TEXT,
  usuario_id UUID,
  usuario_email TEXT,
  datos_antes JSONB,
  datos_despues JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tabla ON audit_log(tabla);
CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_fecha ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_registro ON audit_log(tabla, registro_id);

-- RLS para audit_log: solo admins pueden leer, el sistema escribe via SECURITY DEFINER
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE usuarios.id = auth.uid()
      AND usuarios.rol = 'admin'
    )
  );

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Función trigger genérica que registra INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_old JSONB;
  v_new JSONB;
  v_registro_id TEXT;
  v_changed JSONB;
  v_key TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email
    FROM usuarios WHERE id = v_user_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_registro_id := OLD.id::text;
    -- Excluir columnas de auditoría del snapshot
    v_old := v_old - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en';

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_antes)
    VALUES (TG_TABLE_NAME, 'DELETE', v_registro_id, v_user_id, v_user_email, v_old);

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_registro_id := NEW.id::text;
    v_new := v_new - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en';

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_despues)
    VALUES (TG_TABLE_NAME, 'INSERT', v_registro_id, v_user_id, v_user_email, v_new);

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_registro_id := NEW.id::text;

    -- Solo guardar los campos que realmente cambiaron
    v_changed := '{}'::jsonb;
    FOR v_key IN SELECT jsonb_object_keys(v_new)
    LOOP
      IF v_key IN ('creado_por','creado_en','modificado_por','modificado_en') THEN
        CONTINUE;
      END IF;
      IF (v_old->v_key)::text IS DISTINCT FROM (v_new->v_key)::text THEN
        v_changed := v_changed || jsonb_build_object(v_key, v_new->v_key);
      END IF;
    END LOOP;

    -- No registrar si nada cambió (ej: update cosmético)
    IF v_changed = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    -- datos_antes = solo los campos que cambiaron (valores anteriores)
    v_old := '{}'::jsonb;
    FOR v_key IN SELECT jsonb_object_keys(v_changed)
    LOOP
      v_old := v_old || jsonb_build_object(v_key, to_jsonb(OLD)->v_key);
    END LOOP;

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_antes, datos_despues)
    VALUES (TG_TABLE_NAME, 'UPDATE', v_registro_id, v_user_id, v_user_email, v_old, v_changed);

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Instalar el trigger de auditoría en todas las tablas de datos
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Pedidos','Ingresos','Devoluciones','CambiosMercancia',
    'Inventario','OrdenesCompra','SolicitudMuestras',
    'KardexAjustes','KardexNC','Reenvases','RemisionesAnuladas',
    'usuarios'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_log ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_log
       AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION fn_audit_log()', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- ACTUALIZAR RPCs PARA INCLUIR TRAZABILIDAD
-- ══════════════════════════════════════════════════════════════

-- registrar_entrega: ahora incluye modificado_por = auth.uid()
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
  v_uid UUID := auth.uid();
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

-- editar_pedido_completo: ahora incluye creado_por/modificado_por
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
      END,
      modificado_por = v_uid
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

-- eliminar_pedido_completo: sin cambios en firma, el trigger audit_log captura automáticamente
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


-- ══════════════════════════════════════════════════════════════
-- FUNCIÓN UTILITARIA: Consultar historial de un registro
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_audit_history(
  p_tabla TEXT,
  p_registro_id TEXT
) RETURNS TABLE (
  accion TEXT,
  usuario_email TEXT,
  datos_antes JSONB,
  datos_despues JSONB,
  fecha TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT accion, usuario_email, datos_antes, datos_despues, created_at
  FROM audit_log
  WHERE tabla = p_tabla AND registro_id = p_registro_id
  ORDER BY created_at DESC;
$$;
