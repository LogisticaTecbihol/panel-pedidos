-- Rol 'comercial' y visibilidad granular de Pedidos.
--
-- Un usuario con rol 'comercial' solo puede ver, crear y editar los pedidos
-- cuyo comercial_id apunte a su propia usuarios.id (o donde él los haya
-- creado). Los roles admin/editor/lector mantienen la visibilidad completa
-- que ya tenían por RLS de empresa.
--
-- Modelo híbrido: se guarda tanto el string "Comercial" (para mostrar,
-- retrocompatible con importaciones y datos históricos) como comercial_id
-- (para la RLS). Cuando el string no matchea a ningún usuario del sistema,
-- comercial_id queda NULL y sólo los admins/editores/lectores pueden ver
-- ese pedido.

-- ══════════════════════════════════════════════════════════════
-- 1. Ampliar CHECK de usuarios.rol para aceptar 'comercial'
-- ══════════════════════════════════════════════════════════════
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial'));

-- ══════════════════════════════════════════════════════════════
-- 2. Nueva columna comercial_id (FK usuarios) + índice
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "Pedidos"
  ADD COLUMN IF NOT EXISTS "comercial_id" uuid REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_comercial_id ON "Pedidos"("comercial_id");

-- ══════════════════════════════════════════════════════════════
-- 3. Backfill: matchear string "Comercial" contra usuarios.nombre
--    (case-insensitive, trim). Idempotente: solo llena filas con
--    comercial_id NULL.
-- ══════════════════════════════════════════════════════════════
UPDATE "Pedidos" p
   SET "comercial_id" = u.id
  FROM usuarios u
 WHERE u.activo = true
   AND lower(trim(u.nombre)) = lower(trim(p."Comercial"))
   AND p."comercial_id" IS NULL
   AND p."Comercial" IS NOT NULL
   AND trim(p."Comercial") <> '';

-- ══════════════════════════════════════════════════════════════
-- 4. RLS: redefinir políticas de Pedidos para restringir rol=comercial
--    Admin/editor/lector mantienen visibilidad por empresa; comercial
--    ve/edita solo los propios (comercial_id o creado_por).
--    DELETE queda restringido a admin/editor (comercial no borra).
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Pedidos_select" ON "Pedidos";
DROP POLICY IF EXISTS "Pedidos_insert" ON "Pedidos";
DROP POLICY IF EXISTS "Pedidos_update" ON "Pedidos";
DROP POLICY IF EXISTS "Pedidos_delete" ON "Pedidos";

CREATE POLICY "Pedidos_select" ON "Pedidos" FOR SELECT TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor','lector')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );

CREATE POLICY "Pedidos_insert" ON "Pedidos" FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor')
      OR (get_user_role() = 'comercial' AND "comercial_id" = auth.uid())
    )
  );

CREATE POLICY "Pedidos_update" ON "Pedidos" FOR UPDATE TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  )
  WITH CHECK (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );

CREATE POLICY "Pedidos_delete" ON "Pedidos" FOR DELETE TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND get_user_role() IN ('admin','editor')
  );
