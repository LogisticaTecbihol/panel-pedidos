-- Restringir visibilidad de SolicitudMuestras al rol 'comercial'.
--
-- Modelo: se agrega responsable_id (FK usuarios) como vínculo explícito.
-- El campo Responsable (texto libre) se sigue guardando para mostrar y
-- retrocompatibilidad. El backfill matchea por nombre; el resolver del
-- cliente cae a comercial_codigo si el nombre no matchea.

-- 1. Nueva columna + índice.
ALTER TABLE "SolicitudMuestras"
  ADD COLUMN IF NOT EXISTS "responsable_id" uuid REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_muestras_responsable_id
  ON "SolicitudMuestras"("responsable_id");

-- 2. Backfill: match por nombre (case-insensitive, trim). Fallback opcional
--    por comercial_codigo se hace en el cliente al resolver.
UPDATE "SolicitudMuestras" m
   SET "responsable_id" = u.id
  FROM usuarios u
 WHERE u.activo = true
   AND lower(trim(u.nombre)) = lower(trim(m."Responsable"))
   AND m."responsable_id" IS NULL
   AND m."Responsable" IS NOT NULL
   AND trim(m."Responsable") <> '';

-- Backfill secundario: si el nombre no matcheó pero el Responsable coincide
-- con un comercial_codigo, también asigna.
UPDATE "SolicitudMuestras" m
   SET "responsable_id" = u.id
  FROM usuarios u
 WHERE u.activo = true
   AND u.comercial_codigo IS NOT NULL
   AND trim(u.comercial_codigo) <> ''
   AND lower(trim(u.comercial_codigo)) = lower(trim(m."Responsable"))
   AND m."responsable_id" IS NULL;

-- 3. Redefinir RLS de SolicitudMuestras.
--    Antes: INSERT/UPDATE/DELETE exigían admin/editor. El rol comercial
--    quedaba excluido de crear solicitudes. Ahora se le permite crear las
--    propias (con responsable_id = auth.uid()).

DROP POLICY IF EXISTS "SolicitudMuestras_select" ON "SolicitudMuestras";
DROP POLICY IF EXISTS "SolicitudMuestras_insert" ON "SolicitudMuestras";
DROP POLICY IF EXISTS "SolicitudMuestras_update" ON "SolicitudMuestras";
DROP POLICY IF EXISTS "SolicitudMuestras_delete" ON "SolicitudMuestras";

CREATE POLICY "SolicitudMuestras_select" ON "SolicitudMuestras"
  FOR SELECT TO authenticated
  USING (
    user_has_company("Empresa")
    AND (
      get_user_role() IN ('admin','editor','lector')
      OR (
        get_user_role() = 'comercial'
        AND ("responsable_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );

CREATE POLICY "SolicitudMuestras_insert" ON "SolicitudMuestras"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Empresa")
    AND (
      get_user_role() IN ('admin','editor')
      OR (get_user_role() = 'comercial' AND "responsable_id" = auth.uid())
    )
  );

CREATE POLICY "SolicitudMuestras_update" ON "SolicitudMuestras"
  FOR UPDATE TO authenticated
  USING (
    user_has_company("Empresa")
    AND (
      get_user_role() IN ('admin','editor')
      OR (
        get_user_role() = 'comercial'
        AND ("responsable_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  )
  WITH CHECK (
    user_has_company("Empresa")
    AND (
      get_user_role() IN ('admin','editor')
      OR (
        get_user_role() = 'comercial'
        AND ("responsable_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );

CREATE POLICY "SolicitudMuestras_delete" ON "SolicitudMuestras"
  FOR DELETE TO authenticated
  USING (
    user_has_company("Empresa")
    AND get_user_role() IN ('admin','editor')
  );
