-- ============================================================
-- Ingresos: Contabilidad ve también los ingresos de los que su
-- empresa es ORIGEN (no solo los de destino)
--
-- Caso 2026-11-25 (Sharon Bajonero, contabilidad GREEN/IAS): no veía
-- en ingresos.html el ingreso RESO-RE-0082 (Empresa_Origen = GREEN,
-- Empresa_Destino = RESO, Reenvase de la planta Mosquera). La política
-- «Ingresos_select» de add_contabilidad_role.sql (2026-08-20) y
-- fix_reenvases_select_rls.sql (2026-08-25) solo dejaba a contabilidad
-- ver las filas con Empresa_Destino propia.
--
-- Efecto colateral: Kardex, Existencias, Inventario, Reportes, Dashboard
-- y Legalización leen Ingresos desde el navegador (getIngresos) y
-- descuentan la SALIDA de la empresa origen. Hoy el efecto en cifras es
-- mínimo: las salidas de GREEN y PARCELAR desde su planta no cuentan en el
-- Kardex, y la única salida que contabilidad dejaba de ver son 2 filas de
-- RESO del 2026-09-17 (187 ud). Aun así, contabilidad pasa a ver lo mismo
-- que admin/editor para su empresa.
--
-- Cambio: solo la rama 'contabilidad' de SELECT. Se agrega el origen con
-- la MISMA guarda que ya usan los demás roles: user_has_company(NULL o '')
-- devuelve true, así que sin ella las 160 filas sin Empresa_Origen se
-- verían para toda la contabilidad. INSERT / UPDATE / DELETE no cambian
-- (ya permitían origen O destino). El resto de roles queda idéntico.
--
-- Rollback: ingresos_contabilidad_ve_origen_rollback.sql
-- ============================================================

DROP POLICY IF EXISTS "Ingresos_select" ON "Ingresos";

CREATE POLICY "Ingresos_select" ON "Ingresos"
  FOR SELECT TO authenticated
  USING (
    CASE get_user_role()
      WHEN 'contabilidad' THEN (
        user_has_company("Empresa_Destino")
        OR ("Empresa_Origen" IS NOT NULL AND TRIM(BOTH FROM "Empresa_Origen") <> '' AND user_has_company("Empresa_Origen"))
      )
      WHEN 'gerente_iaso'  THEN true
      ELSE (
        ("Empresa_Origen" IS NOT NULL AND TRIM(BOTH FROM "Empresa_Origen") <> '' AND user_has_company("Empresa_Origen"))
        OR user_has_company("Empresa_Destino")
      )
    END
  );
