-- ============================================================
-- Salidas a producción (Reenvases): quien ve el ingreso de retorno de un
-- reenvase también ve la salida a producción que lo originó
--
-- Caso 2026-11-25 (Sharon Bajonero, contabilidad GREEN/IAS): ve el ingreso
-- RESO-RE-0082 (Empresa_Origen GREEN, planta Mosquera) gracias a
-- ingresos_contabilidad_ve_origen.sql, pero no la salida RESO-RS-0263 a la que
-- ese ingreso responde (Ingresos.Reenvase_Ref = 'RESO-RS-0263'): la política
-- «Reenvases_select» solo mostraba las filas con Empresa propia o con
-- Empresa_Destino propia. La RS es de RESO y va sin destino (a la planta).
--
-- Cambio: se agrega a «Reenvases_select» una cuarta condición — existe un
-- Ingreso con Reenvase_Ref = la Remision de esa salida. La subconsulta corre
-- con las reglas de lectura de Ingresos del propio usuario (RLS), así que la
-- salida solo se ve si el usuario ve el ingreso de retorno que la cita; si
-- mañana cambia quién ve cada ingreso, esto lo sigue.
--   · Es solo lectura: INSERT / UPDATE / DELETE de Reenvases no cambian
--     (siguen exigiendo la Empresa propia).
--   · Se ven todas las líneas de esa remisión (la relación es por número).
--   · Una salida sin ingreso de retorno registrado todavía NO se ve.
--   · Las otras tres condiciones quedan idénticas, incluido el bypass de
--     gerente_iaso y la guarda de Empresa_Destino en blanco.
-- Hoy los 143 ingresos con Reenvase_Ref apuntan a una salida existente (93
-- remisiones distintas) y existe idx_ingresos_reenvase_ref.
--
-- Rollback: reenvases_ver_por_ingreso_vinculado_rollback.sql
-- ============================================================

DROP POLICY IF EXISTS "Reenvases_select" ON "Reenvases";

CREATE POLICY "Reenvases_select" ON "Reenvases"
  FOR SELECT TO authenticated
  USING (
    user_has_company("Empresa")
    OR ("Empresa_Destino" IS NOT NULL AND TRIM(BOTH FROM "Empresa_Destino") <> '' AND user_has_company("Empresa_Destino"))
    OR get_user_role() = 'gerente_iaso'
    OR EXISTS (
      SELECT 1 FROM "Ingresos" i
       WHERE i."Reenvase_Ref" <> ''
         AND i."Reenvase_Ref" = "Reenvases"."Remision"
    )
  );
