-- Corregir hallazgo crítico: Clientes y Comerciales con authenticated_full_access
-- Cualquier usuario autenticado podía leer, modificar y borrar todo el maestro
-- de clientes (PII: NIT, teléfono, dirección) y comerciales.
-- Ejecutado en producción el 2026-08-29. Se versiona como documentación del
-- estado real de la BD (fuera del historial de migraciones de Supabase); no
-- re-ejecutar a ciegas.

-- Clientes
DROP POLICY IF EXISTS authenticated_full_access ON "Clientes";

CREATE POLICY "Clientes_select" ON "Clientes"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Clientes_insert" ON "Clientes"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY(ARRAY['admin','editor']));

CREATE POLICY "Clientes_update" ON "Clientes"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY(ARRAY['admin','editor']))
  WITH CHECK (get_user_role() = ANY(ARRAY['admin','editor']));

CREATE POLICY "Clientes_delete" ON "Clientes"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY(ARRAY['admin','editor']));

-- Comerciales
DROP POLICY IF EXISTS authenticated_full_access ON "Comerciales";

CREATE POLICY "Comerciales_select" ON "Comerciales"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Comerciales_insert" ON "Comerciales"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY(ARRAY['admin','editor']));

CREATE POLICY "Comerciales_update" ON "Comerciales"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY(ARRAY['admin','editor']))
  WITH CHECK (get_user_role() = ANY(ARRAY['admin','editor']));

CREATE POLICY "Comerciales_delete" ON "Comerciales"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY(ARRAY['admin','editor']));
