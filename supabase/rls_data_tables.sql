-- ============================================================
-- FASE 4: Row Level Security en tablas de datos
-- Ejecutar en Supabase SQL Editor
--
-- Usa las funciones helper de Fase 1:
--   get_user_role()      → rol del usuario autenticado
--   user_has_company(p)  → true si el usuario tiene acceso a esa empresa
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 0. LIMPIAR políticas permisivas preexistentes (anon_all,
--    authenticated_full_access, etc.) que anulan el filtrado
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  p text;
BEGIN
  FOR t, p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
    AND policyname IN ('anon_all','anon_full_access','anon_full_clientesunicos','authenticated_full_access')
    AND tablename IN ('Pedidos','Productos','Ingresos','Devoluciones','CambiosMercancia',
      'Inventario','OrdenesCompra','SolicitudMuestras','Reenvases','KardexAjustes',
      'KardexNC','RemisionesAnuladas','Consecutivos','ClientesUnicos','maestro_productos')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I', p, t);
  END LOOP;
END $$;


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


-- ══════════════════════════════════════════════════════════════
-- 3a. Ingresos (Empresa_Origen + Empresa_Destino)
--     SELECT: rol contabilidad solo ve registros donde su empresa
--     es Empresa_Destino; los demás roles ven ambas direcciones.
--     INSERT/UPDATE/DELETE permiten acceso si el usuario tiene
--     cualquiera de las dos empresas.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "Ingresos" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ingresos_select" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_insert" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_update" ON "Ingresos";
DROP POLICY IF EXISTS "Ingresos_delete" ON "Ingresos";

CREATE POLICY "Ingresos_select" ON "Ingresos"
  FOR SELECT TO authenticated
  USING (
    CASE WHEN get_user_role() = 'contabilidad'
      THEN user_has_company("Empresa_Destino")
      ELSE user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino")
    END
  );

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


-- ══════════════════════════════════════════════════════════════
-- 3b. OrdenesCompra (Empresa_Origen + Empresa_Destino)
--     Visible si el usuario tiene acceso a CUALQUIERA de las dos
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "OrdenesCompra" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "OrdenesCompra_select" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_insert" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_update" ON "OrdenesCompra";
DROP POLICY IF EXISTS "OrdenesCompra_delete" ON "OrdenesCompra";

CREATE POLICY "OrdenesCompra_select" ON "OrdenesCompra"
  FOR SELECT TO authenticated
  USING (user_has_company("Empresa_Origen") OR user_has_company("Empresa_Destino"));

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
