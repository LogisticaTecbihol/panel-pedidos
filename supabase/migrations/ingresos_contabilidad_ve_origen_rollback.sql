-- ============================================================
-- Rollback de ingresos_contabilidad_ve_origen.sql
-- Deja «Ingresos_select» como estaba en producción el 2026-11-25
-- (contabilidad solo ve las filas con Empresa_Destino propia).
-- ============================================================

DROP POLICY IF EXISTS "Ingresos_select" ON "Ingresos";

CREATE POLICY "Ingresos_select" ON "Ingresos"
  FOR SELECT TO authenticated
  USING (
    CASE get_user_role()
      WHEN 'contabilidad' THEN user_has_company("Empresa_Destino")
      WHEN 'gerente_iaso'  THEN true
      ELSE (
        ("Empresa_Origen" IS NOT NULL AND TRIM(BOTH FROM "Empresa_Origen") <> '' AND user_has_company("Empresa_Origen"))
        OR user_has_company("Empresa_Destino")
      )
    END
  );
