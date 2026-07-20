-- ============================================================
-- FASE 4: Row Level Security en tablas de datos
-- Ejecutar en Supabase SQL Editor
--
-- Usa las funciones helper de Fase 1:
--   get_user_role()      → rol del usuario autenticado
--   user_has_company(p)  → true si el usuario tiene acceso a esa empresa
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. TABLAS CON COLUMNA "Empresa" (texto = nombre completo)
--    Devoluciones, CambiosMercancia, Inventario, SolicitudMuestras,
--    Reenvases, KardexAjustes, KardexNC, RemisionesAnuladas
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Devoluciones','CambiosMercancia','Inventario','SolicitudMuestras',
    'Reenvases','KardexAjustes','KardexNC','RemisionesAnuladas'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (user_has_company("Empresa"))',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'') AND user_has_company("Empresa"))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'') AND user_has_company("Empresa")) WITH CHECK (get_user_role() IN (''admin'',''editor'') AND user_has_company("Empresa"))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'') AND user_has_company("Empresa"))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 2. TABLAS CON COLUMNA "Nombre_Empresa"
--    Pedidos, Productos
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Pedidos','Productos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (user_has_company("Nombre_Empresa"))',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'') AND user_has_company("Nombre_Empresa"))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'') AND user_has_company("Nombre_Empresa")) WITH CHECK (get_user_role() IN (''admin'',''editor'') AND user_has_company("Nombre_Empresa"))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'') AND user_has_company("Nombre_Empresa"))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 3. TABLAS CON Empresa_Origen + Empresa_Destino
--    Ingresos, OrdenesCompra
--    Visible si el usuario tiene acceso a CUALQUIERA de las dos
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Ingresos','OrdenesCompra']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino"))',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor'') AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'') AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino"))) WITH CHECK (get_user_role() IN (''admin'',''editor'') AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor'') AND (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 4. TABLAS DE REFERENCIA (sin columna empresa)
--    Consecutivos, ClientesUnicos, maestro_productos
--    Todos pueden leer, solo editores/admins pueden modificar
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Consecutivos','ClientesUnicos','maestro_productos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (get_user_role() IN (''admin'',''editor''))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (get_user_role() IN (''admin'',''editor'')) WITH CHECK (get_user_role() IN (''admin'',''editor''))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (get_user_role() IN (''admin'',''editor''))',
      t || '_delete', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 5. GRANTS para authenticated en todas las tablas de datos
-- ══════════════════════════════════════════════════════════════

GRANT ALL ON "Pedidos" TO authenticated;
GRANT ALL ON "Productos" TO authenticated;
GRANT ALL ON "Consecutivos" TO authenticated;
GRANT ALL ON "ClientesUnicos" TO authenticated;
GRANT ALL ON "Ingresos" TO authenticated;
GRANT ALL ON "Devoluciones" TO authenticated;
GRANT ALL ON "CambiosMercancia" TO authenticated;
GRANT ALL ON "Inventario" TO authenticated;
GRANT ALL ON "OrdenesCompra" TO authenticated;
GRANT ALL ON maestro_productos TO authenticated;
GRANT ALL ON "SolicitudMuestras" TO authenticated;
GRANT ALL ON "Reenvases" TO authenticated;
GRANT ALL ON "KardexAjustes" TO authenticated;
GRANT ALL ON "KardexNC" TO authenticated;
GRANT ALL ON "RemisionesAnuladas" TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- FIN FASE 4
-- ══════════════════════════════════════════════════════════════
