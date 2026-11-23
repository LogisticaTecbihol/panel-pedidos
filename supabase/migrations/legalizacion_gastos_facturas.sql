-- ============================================================
-- Legalización de gastos: CONCILIACIÓN CONTABLE (facturas por empresa)
--
-- Pedido 2026-11-23. Cada factura (o documento) del sistema contable se registra POR EMPRESA,
-- con su valor facturado y el RANGO DE FECHAS al que corresponde (no siempre es el mes completo).
-- Lo causado por empresa sale del Prorrateo (gasto por producto + su Combustible + su
-- Mantenimiento); lo facturado lo descuenta y queda el pendiente por conciliar. Lo que el
-- Prorrateo no puede atribuir a ninguna empresa (Otros, Sin identificar, y el Combustible o
-- Mantenimiento «Sin reparto asignado») sigue pendiente como «Sin empresa» hasta que se le asigne
-- reparto a la legalización.
--
-- Esto REEMPLAZA al Conciliar / Rechazar de cada legalización (saldo a favor del empleado / por
-- reembolsar), que se retira de la pantalla. La función conciliar_legalizacion_gastos y las columnas
-- Estado_Conciliacion / Saldo_* / Conciliado_Por / etc. NO se tocan: nadie las usó (163 de 163
-- registros siguen «Por conciliar»).
--
-- Modelo: tabla LegalizacionGastosFacturas.
--   * "Empresa": el nombre completo de una empresa del holding (como en LegalizacionGastosEmpresas)
--     o uno de los grupos externos 'TECBIHOL', 'CHIA ABAGO', 'MATERIAS PRIMAS'.
--   * "Numero_Documento": el de la factura / comprobante en el sistema contable. No se repite dentro
--     de la misma empresa entre facturas VIGENTES (sin importar mayúsculas ni espacios en los bordes).
--   * "Periodo_Desde" / "Periodo_Hasta": rango (inclusive) de las FECHAS DE LAS LEGALIZACIONES que
--     cubre la factura. Pueden cruzarse entre facturas de la misma empresa (factura complementaria).
--   * "Causado_Al_Registrar": lo que el Prorrateo calculaba para esa empresa y ese rango al guardar
--     (lo calcula el navegador; NULL si el cálculo no estaba disponible). Sirve para avisar si el
--     reparto cambió después.
--   * Nada se borra: se ANULA (Estado = 'Anulada', con motivo). Una factura anulada no se modifica.
--
-- Permisos (RLS):
--   * Ver: quien tiene el módulo legalizacion_gastos o legalizacion_gastos_aprobar, solo las facturas
--     de empresas que puede ver (user_has_company). Los grupos externos los ve quien ve TODAS las
--     empresas del holding (misma regla que legalizacion_gastos_visible y LegProrrateo.empresaVisible).
--   * Registrar / editar / anular: quien tiene legalizacion_gastos_aprobar («Conciliar legalización de
--     gastos»; el admin pasa siempre) y no es rol lector, con las mismas restricciones de empresa.
--   * Borrar de verdad: solo admin (correcciones).
--   * El cierre de mes NO aplica: registrar una factura no cambia ninguna legalización (igual que
--     conciliar, que sí se permitía en meses cerrados).
--
-- Aplicar con apply_migration (MCP) ANTES de publicar el código.
-- Reversión: legalizacion_gastos_facturas_rollback.sql
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."LegalizacionGastosFacturas" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Empresa"                text NOT NULL,
  "Numero_Documento"       text NOT NULL,
  "Fecha_Documento"        date NOT NULL,
  "Periodo_Desde"          date NOT NULL,
  "Periodo_Hasta"          date NOT NULL,
  "Valor"                  numeric NOT NULL,
  "Observacion"            text NOT NULL DEFAULT '',
  "Causado_Al_Registrar"   numeric,
  "Estado"                 text NOT NULL DEFAULT 'Vigente',
  "Motivo_Anulacion"       text,
  "Anulado_Por"            text,
  "Fecha_Anulacion"        timestamptz,
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz,
  CONSTRAINT legalizacion_facturas_empresa_valida CHECK ("Empresa" IN (
    'PARCELAR DE COLOMBIA SAS', 'GREEN AGROSOLUCIONES DE COLOMBIA SAS', 'SOLUCIONES INTEGRALES RESO SAS',
    'INSUMOS AGROPECUARIOS SOSTENIBLES SAS', 'INSUMOS AGROPECUARIOS DE LA SABANA SAS',
    'CHIA ABAGO', 'MATERIAS PRIMAS', 'TECBIHOL')),
  CONSTRAINT legalizacion_facturas_numero_valido CHECK (btrim("Numero_Documento") <> '' AND length("Numero_Documento") <= 60),
  CONSTRAINT legalizacion_facturas_valor_valido  CHECK ("Valor" > 0 AND "Valor" < 1000000000000),
  CONSTRAINT legalizacion_facturas_periodo_orden CHECK ("Periodo_Desde" <= "Periodo_Hasta"),
  CONSTRAINT legalizacion_facturas_fechas_razonables CHECK (
    "Periodo_Desde" >= DATE '2020-01-01' AND "Periodo_Hasta" <= DATE '2100-12-31' AND "Fecha_Documento" >= DATE '2020-01-01'),
  CONSTRAINT legalizacion_facturas_estado_valido CHECK ("Estado" IN ('Vigente', 'Anulada')),
  CONSTRAINT legalizacion_facturas_anulada_con_motivo CHECK (
    "Estado" = 'Vigente' OR length(btrim(COALESCE("Motivo_Anulacion", ''))) >= 5),
  CONSTRAINT legalizacion_facturas_observacion_corta CHECK (length("Observacion") <= 500)
);

COMMENT ON TABLE public."LegalizacionGastosFacturas" IS
  'Conciliación contable de Legalización de gastos: facturas (o documentos) del sistema contable registradas por empresa, con valor y rango de fechas. Descuentan lo causado por empresa en el Prorrateo. No se borran: se anulan.';

-- Una empresa no repite el número entre facturas vigentes (una anulada libera el número).
CREATE UNIQUE INDEX IF NOT EXISTS legalizacion_facturas_documento_unico
  ON public."LegalizacionGastosFacturas" ("Empresa", upper("Numero_Documento"))
  WHERE "Estado" = 'Vigente';
CREATE INDEX IF NOT EXISTS idx_legalizacion_facturas_empresa_periodo
  ON public."LegalizacionGastosFacturas" ("Empresa", "Periodo_Desde", "Periodo_Hasta");

-- ── 2. Funciones ──
-- ¿Puede el usuario ver las facturas de esta empresa? Holding: user_has_company (admin y cartera
-- ven todo). Grupos externos (no son del holding): quien ve las 5 empresas del holding.
CREATE OR REPLACE FUNCTION public.legalizacion_factura_empresa_visible(p_empresa text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_empresa IN ('CHIA ABAGO', 'MATERIAS PRIMAS', 'TECBIHOL') THEN
      public.user_has_company('PARCELAR DE COLOMBIA SAS')
      AND public.user_has_company('GREEN AGROSOLUCIONES DE COLOMBIA SAS')
      AND public.user_has_company('SOLUCIONES INTEGRALES RESO SAS')
      AND public.user_has_company('INSUMOS AGROPECUARIOS SOSTENIBLES SAS')
      AND public.user_has_company('INSUMOS AGROPECUARIOS DE LA SABANA SAS')
    ELSE public.user_has_company(p_empresa)
  END;
$$;

COMMENT ON FUNCTION public.legalizacion_factura_empresa_visible(text) IS
  'Visibilidad de las facturas de Legalización por empresa: holding = user_has_company; grupos externos (Chia Abago, Materias primas, Tecbihol) = quien ve las 5 empresas del holding.';

-- Reglas que no se pueden saltar escribiendo directo a la tabla.
CREATE OR REPLACE FUNCTION public.fn_legalizacion_facturas_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Columnas que la auditoría o la propia anulación mueven.
  v_ignorar text[] := ARRAY['Estado', 'Motivo_Anulacion', 'Anulado_Por', 'Fecha_Anulacion',
                            'modificado_por', 'modificado_por_nombre', 'modificado_en'];
BEGIN
  NEW."Empresa"          := btrim(NEW."Empresa");
  NEW."Numero_Documento" := btrim(NEW."Numero_Documento");
  NEW."Observacion"      := btrim(COALESCE(NEW."Observacion", ''));

  IF TG_OP = 'INSERT' THEN
    -- Siempre nace vigente.
    NEW."Estado" := 'Vigente';
    NEW."Motivo_Anulacion" := NULL;
    NEW."Anulado_Por" := NULL;
    NEW."Fecha_Anulacion" := NULL;
    RETURN NEW;
  END IF;

  IF OLD."Estado" = 'Anulada' THEN
    RAISE EXCEPTION 'La factura % ya está anulada y no se puede modificar', OLD."Numero_Documento";
  END IF;

  IF NEW."Estado" = 'Anulada' THEN
    -- Anular solo cambia el estado (y el motivo): el resto debe quedar igual.
    IF (to_jsonb(NEW) - v_ignorar) IS DISTINCT FROM (to_jsonb(OLD) - v_ignorar) THEN
      RAISE EXCEPTION 'Al anular una factura no se puede cambiar ningún otro dato';
    END IF;
    NEW."Motivo_Anulacion" := btrim(COALESCE(NEW."Motivo_Anulacion", ''));
    IF length(NEW."Motivo_Anulacion") < 5 THEN
      RAISE EXCEPTION 'Indica el motivo de la anulación (mínimo 5 caracteres)';
    END IF;
    NEW."Anulado_Por" := public._usuario_nombre(auth.uid());
    NEW."Fecha_Anulacion" := now();
  ELSE
    -- Una factura vigente se edita: el estado y los datos de anulación no se tocan a mano.
    NEW."Estado" := 'Vigente';
    NEW."Motivo_Anulacion" := NULL;
    NEW."Anulado_Por" := NULL;
    NEW."Fecha_Anulacion" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_legalizacion_facturas_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legalizacion_factura_empresa_visible(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legalizacion_factura_empresa_visible(text) TO authenticated, service_role;

-- ── 3. Triggers ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LegalizacionGastosFacturas";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastosFacturas"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_legalizacion_facturas_guard ON public."LegalizacionGastosFacturas";
CREATE TRIGGER trg_legalizacion_facturas_guard
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastosFacturas"
  FOR EACH ROW EXECUTE FUNCTION public.fn_legalizacion_facturas_guard();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LegalizacionGastosFacturas";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosFacturas"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 4. RLS ──
ALTER TABLE public."LegalizacionGastosFacturas" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LegalizacionGastosFacturas_select" ON public."LegalizacionGastosFacturas";
CREATE POLICY "LegalizacionGastosFacturas_select" ON public."LegalizacionGastosFacturas" FOR SELECT TO authenticated
  USING ((public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'))
         AND public.legalizacion_factura_empresa_visible("Empresa"));

DROP POLICY IF EXISTS "LegalizacionGastosFacturas_insert" ON public."LegalizacionGastosFacturas";
CREATE POLICY "LegalizacionGastosFacturas_insert" ON public."LegalizacionGastosFacturas" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('legalizacion_gastos_aprobar')
              AND COALESCE(public.get_user_role(), '') <> 'lector'
              AND public.legalizacion_factura_empresa_visible("Empresa"));

DROP POLICY IF EXISTS "LegalizacionGastosFacturas_update" ON public."LegalizacionGastosFacturas";
CREATE POLICY "LegalizacionGastosFacturas_update" ON public."LegalizacionGastosFacturas" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos_aprobar')
         AND COALESCE(public.get_user_role(), '') <> 'lector'
         AND public.legalizacion_factura_empresa_visible("Empresa"))
  WITH CHECK (public.user_has_module('legalizacion_gastos_aprobar')
              AND COALESCE(public.get_user_role(), '') <> 'lector'
              AND public.legalizacion_factura_empresa_visible("Empresa"));

DROP POLICY IF EXISTS "LegalizacionGastosFacturas_delete" ON public."LegalizacionGastosFacturas";
CREATE POLICY "LegalizacionGastosFacturas_delete" ON public."LegalizacionGastosFacturas" FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

REVOKE ALL ON public."LegalizacionGastosFacturas" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LegalizacionGastosFacturas" TO authenticated;
GRANT ALL ON public."LegalizacionGastosFacturas" TO service_role;

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
