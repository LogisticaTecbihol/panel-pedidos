-- ============================================================
-- FIX: Agregar políticas authenticated a todas las tablas existentes
-- Las políticas anon siguen activas para respaldo.
-- Estas políticas temporales dan acceso completo a usuarios autenticados.
-- En la Fase 4 se reemplazarán por políticas con filtro por empresa.
--
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Pedidos
CREATE POLICY "authenticated_full_access" ON "Pedidos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Consecutivos
CREATE POLICY "authenticated_full_access" ON "Consecutivos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ingresos
CREATE POLICY "authenticated_full_access" ON "Ingresos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Devoluciones
CREATE POLICY "authenticated_full_access" ON "Devoluciones"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Inventario
CREATE POLICY "authenticated_full_access" ON "Inventario"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- OrdenesCompra
CREATE POLICY "authenticated_full_access" ON "OrdenesCompra"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Clientes
CREATE POLICY "authenticated_full_access" ON "Clientes"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Comerciales
CREATE POLICY "authenticated_full_access" ON "Comerciales"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Productos
CREATE POLICY "authenticated_full_access" ON "Productos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- maestro_productos
CREATE POLICY "authenticated_full_access" ON "maestro_productos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ClientesUnicos
CREATE POLICY "authenticated_full_access" ON "ClientesUnicos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- KardexAjustes
CREATE POLICY "authenticated_full_access" ON "KardexAjustes"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- KardexNC (si existe)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'KardexNC') THEN
    EXECUTE 'CREATE POLICY "authenticated_full_access" ON "KardexNC" FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- SolicitudMuestras (si existe)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'SolicitudMuestras') THEN
    EXECUTE 'CREATE POLICY "authenticated_full_access" ON "SolicitudMuestras" FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- Reenvases (si existe)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'Reenvases') THEN
    EXECUTE 'CREATE POLICY "authenticated_full_access" ON "Reenvases" FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- RemisionesAnuladas (si existe)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'RemisionesAnuladas') THEN
    EXECUTE 'CREATE POLICY "authenticated_full_access" ON "RemisionesAnuladas" FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- CambiosMercancia (si existe)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'CambiosMercancia') THEN
    EXECUTE 'CREATE POLICY "authenticated_full_access" ON "CambiosMercancia" FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;
