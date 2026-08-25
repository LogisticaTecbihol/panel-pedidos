-- ============================================================
-- Fix RLS: NULL-safe company checks + gerente_iaso bypass
--
-- Problems found:
-- 1. Reenvases SELECT only checked "Empresa" (origin), not
--    "Empresa_Destino" — users with the destination company
--    couldn't see transfer records, causing Kardex discrepancies.
--    ALSO: user_has_company(NULL) returns true, so the check on
--    Empresa_Destino must guard against NULL (222/247 rows).
--
-- 2. Ingresos SELECT: 43 rows have NULL Empresa_Origen,
--    making them visible to all users via user_has_company(NULL).
--
-- 3. Pedidos SELECT: the remisionador migration replaced
--    "OR gerente_iaso" with "AND (role list)", breaking the
--    gerente_iaso global-read bypass.
--
-- Fecha: 2026-08-25
-- ============================================================


-- ── 1. Reenvases ──

DROP POLICY IF EXISTS "Reenvases_select" ON "Reenvases";

CREATE POLICY "Reenvases_select" ON "Reenvases"
  FOR SELECT TO authenticated
  USING (
    user_has_company("Empresa")
    OR ("Empresa_Destino" IS NOT NULL AND TRIM("Empresa_Destino") != '' AND user_has_company("Empresa_Destino"))
    OR get_user_role() = 'gerente_iaso'
  );


-- ── 2. Ingresos ──

DROP POLICY IF EXISTS "Ingresos_select" ON "Ingresos";

CREATE POLICY "Ingresos_select" ON "Ingresos"
  FOR SELECT TO authenticated
  USING (
    CASE get_user_role()
      WHEN 'contabilidad' THEN user_has_company("Empresa_Destino")
      WHEN 'gerente_iaso'  THEN true
      ELSE (
        ("Empresa_Origen" IS NOT NULL AND TRIM("Empresa_Origen") != '' AND user_has_company("Empresa_Origen"))
        OR user_has_company("Empresa_Destino")
      )
    END
  );


-- ── 3. Pedidos — restaurar bypass gerente_iaso ──

DROP POLICY IF EXISTS "Pedidos_select" ON "Pedidos";

CREATE POLICY "Pedidos_select" ON "Pedidos"
  FOR SELECT TO authenticated
  USING (
    (user_has_company("Nombre_Empresa") OR get_user_role() = 'gerente_iaso')
    AND (
      (get_user_role() = ANY (ARRAY['admin','editor','lector','contabilidad','gerente_iaso','despachador','remisionador']))
      OR ((get_user_role() = 'comercial') AND (comercial_id = auth.uid() OR creado_por = auth.uid()))
    )
  );
