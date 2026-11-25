-- ============================================================
-- Rollback de reenvases_ver_por_ingreso_vinculado.sql
-- Deja «Reenvases_select» como estaba en producción el 2026-11-25
-- (Empresa propia, Empresa_Destino propia o gerente_iaso).
-- ============================================================

DROP POLICY IF EXISTS "Reenvases_select" ON "Reenvases";

CREATE POLICY "Reenvases_select" ON "Reenvases"
  FOR SELECT TO authenticated
  USING (
    user_has_company("Empresa")
    OR ("Empresa_Destino" IS NOT NULL AND TRIM(BOTH FROM "Empresa_Destino") <> '' AND user_has_company("Empresa_Destino"))
    OR get_user_role() = 'gerente_iaso'
  );
