-- ============================================================
-- Migración: Agregar rol 'gerente_iaso'
--
-- Comportamiento: idéntico a 'editor', pero puede LEER datos
-- de TODAS las empresas en todas las tablas (necesario para
-- calcular el Kardex completo, ya que IASO no maneja inventario
-- propio). INSERT/UPDATE/DELETE siguen restringidos a su empresa.
--
-- En la UI, solo el módulo Kardex muestra todas las empresas
-- en los dropdowns; los demás módulos muestran solo IASO.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- Fecha: 2026-08-20
-- ============================================================


-- ── 1. Ampliar CHECK constraint ──

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador','contabilidad','gerente_iaso'));


-- ── 2. Tablas con columna "Empresa" ──
--    SELECT: gerente_iaso puede leer TODO (bypass de empresa)
--    INSERT/UPDATE/DELETE: gerente_iaso puede escribir solo su empresa

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Devoluciones','CambiosMercancia','Inventario','SolicitudMuestras',
    'Reenvases','KardexAjustes','KardexNC','RemisionesAnuladas'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (user_has_company("Empresa") OR get_user_role() = ''gerente_iaso'')',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Empresa"))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Empresa")) WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Empresa"))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Empresa"))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ── 3. Tablas con columna "Nombre_Empresa" ──

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Pedidos','Productos']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (user_has_company("Nombre_Empresa") OR get_user_role() = ''gerente_iaso'')',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Nombre_Empresa"))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Nombre_Empresa")) WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Nombre_Empresa"))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'') AND user_has_company("Nombre_Empresa"))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ── 4. Ingresos ──

DROP POLICY IF EXISTS "Ingresos_select" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_insert" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_update" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_delete" ON "Ingresos";

CREATE POLICY "Ingresos_select" ON "Ingresos"
  FOR SELECT TO authenticated
  USING (
    CASE get_user_role()
      WHEN 'contabilidad' THEN user_has_company("Empresa_Destino")
      WHEN 'gerente_iaso'  THEN true
      ELSE user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")
    END
  );

CREATE POLICY "Ingresos_insert" ON "Ingresos"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "Ingresos_update" ON "Ingresos"
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "Ingresos_delete" ON "Ingresos"
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));


-- ── 5. OrdenesCompra ──

DROP POLICY IF EXISTS "OrdenesCompra_select" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_insert" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_update" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_delete" ON "OrdenesCompra";

CREATE POLICY "OrdenesCompra_select" ON "OrdenesCompra"
  FOR SELECT TO authenticated
  USING (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino") OR get_user_role() = 'gerente_iaso');

CREATE POLICY "OrdenesCompra_insert" ON "OrdenesCompra"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "OrdenesCompra_update" ON "OrdenesCompra"
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))
  WITH CHECK (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));

CREATE POLICY "OrdenesCompra_delete" ON "OrdenesCompra"
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('admin','editor','contabilidad','gerente_iaso')
    AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")));


-- ── 6. Tablas de referencia ──

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
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso''))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso'')) WITH CHECK (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso''))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'',''contabilidad'',''gerente_iaso''))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ============================================================
-- FIN migración gerente_iaso
-- ============================================================
