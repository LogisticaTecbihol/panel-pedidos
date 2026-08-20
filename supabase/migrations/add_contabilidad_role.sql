-- ============================================================
-- Migración: Agregar rol 'contabilidad'
--
-- Comportamiento: idéntico a 'editor' en todos los módulos,
-- excepto en Ingresos donde solo ve registros cuya
-- Empresa_Destino coincide con su empresa asignada.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- Fecha: 2026-08-20
-- ============================================================


-- ── 1. Ampliar CHECK constraint para aceptar 'contabilidad' ──

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador','contabilidad'));


-- ── 2. Ingresos: SELECT condicional por rol ──
--    contabilidad → solo Empresa_Destino
--    demás roles  → Empresa_Origen O Empresa_Destino (sin cambio)

DROP POLICY IF EXISTS "Ingresos_select" ON "Ingresos";

CREATE POLICY "Ingresos_select" ON "Ingresos"
  FOR SELECT TO authenticated
  USING (
    CASE WHEN get_user_role() = 'contabilidad'
      THEN user_has_company("Empresa_Destino")
      ELSE user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")
    END
  );


-- ── 3. Ingresos: INSERT/UPDATE/DELETE incluir contabilidad ──

DROP POLICY IF EXISTS "Ingresos_insert" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_update" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_delete" ON "Ingresos";

CREATE POLICY "Ingresos_insert" ON "Ingresos"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "Ingresos_update" ON "Ingresos"
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "Ingresos_delete" ON "Ingresos"
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));


-- ── 4. Demás tablas de datos: incluir contabilidad en escritura ──
--    (Secciones 1, 2, 3b y 4 de rls_data_tables.sql)

-- 4a. Tablas con columna "Empresa"
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Devoluciones','CambiosMercancia','Inventario','SolicitudMuestras',
    'Reenvases','KardexAjustes','KardexNC','RemisionesAnuladas'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Empresa"))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Empresa")) WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Empresa"))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Empresa"))',
      t || '_delete', t);
  END LOOP;
END $$;

-- 4b. Tablas con columna "Nombre_Empresa"
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Pedidos','Productos']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Nombre_Empresa"))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Nombre_Empresa")) WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Nombre_Empresa"))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'') AND user_has_company("Nombre_Empresa"))',
      t || '_delete', t);
  END LOOP;
END $$;

-- 4c. OrdenesCompra
DROP POLICY IF EXISTS "OrdenesCompra_insert" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_update" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_delete" ON "OrdenesCompra";

CREATE POLICY "OrdenesCompra_insert" ON "OrdenesCompra"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "OrdenesCompra_update" ON "OrdenesCompra"
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "OrdenesCompra_delete" ON "OrdenesCompra"
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

-- 4d. Tablas de referencia
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Consecutivos','ClientesUnicos','maestro_productos']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad''))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'')) WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad''))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad''))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ============================================================
-- FIN migración contabilidad
-- ============================================================
