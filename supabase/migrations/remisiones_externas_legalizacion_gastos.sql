-- ============================================================
-- Remisiones externas (Chia Abago) para Legalización de gastos / Envíos
--
-- Las remisiones propias de Chia Abago (proveedor) NO existen en el sistema
-- (no están en Pedidos/Ingresos/Muestras/Devoluciones) y no llevan sigla del
-- holding. Para poder relacionarles gastos (reparto por litros/kilos y
-- pestaña Prorrateo) se registran aquí: número, fecha y productos/cantidades.
--
-- Modelo cabecera + líneas (mismo patrón que LegalizacionGastos / Items):
--   - RemisionesExternas        1 fila por remisión (número único)
--   - RemisionesExternasItems   producto + cantidad de cada línea
--
-- No toca Kardex, Existencias ni stock: solo sirve para repartir gastos.
-- Estas remisiones se cargan a un grupo propio "CHIA ABAGO" (no es empresa del
-- holding): aparece como fila en el reparto y como grupo en Prorrateo.
--
-- Además ajusta legalizacion_gastos_visible: una fila de reparto con
-- Empresa = 'CHIA ABAGO' no debe ocultar el registro a usuarios limitados por
-- empresa (user_has_company solo conoce las empresas del holding). La
-- visibilidad se sigue decidiendo por las empresas del holding del reparto;
-- si el reparto es SOLO de Abago, lo ven todos los usuarios del módulo.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

-- ── 1. Cabecera ──
CREATE TABLE IF NOT EXISTS public."RemisionesExternas" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Remision"               text NOT NULL,
  "Fecha"                  date NOT NULL DEFAULT current_date,
  "Proveedor"              text NOT NULL DEFAULT 'CHIA ABAGO',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);

-- El número no se puede repetir (sin distinguir mayúsculas/espacios).
CREATE UNIQUE INDEX IF NOT EXISTS ux_remisiones_externas_remision
  ON public."RemisionesExternas" (upper(btrim("Remision")));

COMMENT ON TABLE public."RemisionesExternas" IS
  'Remisiones de proveedores externos (Chia Abago) que no están en el sistema, registradas desde Legalización de gastos / Envíos para relacionarles gastos (reparto por litros/kilos y Prorrateo). No afectan stock.';

-- ── 2. Líneas ──
CREATE TABLE IF NOT EXISTS public."RemisionesExternasItems" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Remision_Id"            bigint NOT NULL REFERENCES public."RemisionesExternas"(id) ON DELETE CASCADE,
  "Producto"               text NOT NULL,
  "Presentacion"           text NOT NULL DEFAULT '',
  "Cantidad"               numeric NOT NULL CHECK ("Cantidad" > 0),
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_remisiones_externas_items_remision
  ON public."RemisionesExternasItems" ("Remision_Id");

COMMENT ON TABLE public."RemisionesExternasItems" IS
  'Líneas (producto/cantidad) de una remisión externa. La presentación normalmente va en el nombre del producto (ej. CREOLINA X LITRO).';

-- ── 3. Auditoría (triggers genéricos ya existentes) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."RemisionesExternas";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."RemisionesExternas"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."RemisionesExternas";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."RemisionesExternas"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."RemisionesExternasItems";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."RemisionesExternasItems"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."RemisionesExternasItems";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."RemisionesExternasItems"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 4. Protección: no borrar ni renumerar una remisión que ya está relacionada ──
-- SECURITY DEFINER: debe ver TODAS las legalizaciones/envíos aunque el usuario
-- solo vea los de sus empresas (RLS). Los registros 'Rechazada' no cuentan.
CREATE OR REPLACE FUNCTION public.proteger_remision_externa_en_uso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := upper(btrim(OLD."Remision"));
  v_uso text;
BEGIN
  IF TG_OP = 'UPDATE' AND upper(btrim(NEW."Remision")) = v_key THEN
    RETURN NEW;
  END IF;

  SELECT o."Consecutivo" INTO v_uso
    FROM public."LegalizacionGastos" o
   WHERE o."Estado_Conciliacion" <> 'Rechazada'
     AND v_key = ANY (ARRAY(SELECT upper(btrim(x))
                              FROM unnest(string_to_array(o."Remisiones_Relacionadas", ',')) x))
   LIMIT 1;

  IF v_uso IS NOT NULL THEN
    RAISE EXCEPTION 'La remisión % está relacionada en % y no se puede %',
      OLD."Remision", v_uso,
      CASE WHEN TG_OP = 'DELETE' THEN 'eliminar' ELSE 'renumerar' END
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_remision_externa_en_uso() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_proteger_remision_externa ON public."RemisionesExternas";
CREATE TRIGGER trg_proteger_remision_externa
  BEFORE DELETE OR UPDATE OF "Remision" ON public."RemisionesExternas"
  FOR EACH ROW EXECUTE FUNCTION public.proteger_remision_externa_en_uso();

-- ── 5. RLS (mismos módulos que Legalización de gastos) ──
ALTER TABLE public."RemisionesExternas"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RemisionesExternasItems" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RemisionesExternas_select" ON public."RemisionesExternas";
CREATE POLICY "RemisionesExternas_select" ON public."RemisionesExternas" FOR SELECT TO authenticated
  USING (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'));

DROP POLICY IF EXISTS "RemisionesExternas_insert" ON public."RemisionesExternas";
CREATE POLICY "RemisionesExternas_insert" ON public."RemisionesExternas" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('legalizacion_gastos'));

DROP POLICY IF EXISTS "RemisionesExternas_update" ON public."RemisionesExternas";
CREATE POLICY "RemisionesExternas_update" ON public."RemisionesExternas" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos'))
  WITH CHECK (public.user_has_module('legalizacion_gastos'));

DROP POLICY IF EXISTS "RemisionesExternas_delete" ON public."RemisionesExternas";
CREATE POLICY "RemisionesExternas_delete" ON public."RemisionesExternas" FOR DELETE TO authenticated
  USING (public.user_has_module('legalizacion_gastos'));

DROP POLICY IF EXISTS "RemisionesExternasItems_select" ON public."RemisionesExternasItems";
CREATE POLICY "RemisionesExternasItems_select" ON public."RemisionesExternasItems" FOR SELECT TO authenticated
  USING (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'));

DROP POLICY IF EXISTS "RemisionesExternasItems_insert" ON public."RemisionesExternasItems";
CREATE POLICY "RemisionesExternasItems_insert" ON public."RemisionesExternasItems" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('legalizacion_gastos'));

DROP POLICY IF EXISTS "RemisionesExternasItems_update" ON public."RemisionesExternasItems";
CREATE POLICY "RemisionesExternasItems_update" ON public."RemisionesExternasItems" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos'))
  WITH CHECK (public.user_has_module('legalizacion_gastos'));

DROP POLICY IF EXISTS "RemisionesExternasItems_delete" ON public."RemisionesExternasItems";
CREATE POLICY "RemisionesExternasItems_delete" ON public."RemisionesExternasItems" FOR DELETE TO authenticated
  USING (public.user_has_module('legalizacion_gastos'));

GRANT ALL ON public."RemisionesExternas"      TO anon, authenticated, service_role;
GRANT ALL ON public."RemisionesExternasItems" TO anon, authenticated, service_role;

-- ── 6. Visibilidad de legalizaciones con reparto a 'CHIA ABAGO' ──
-- Antes: visible si NO tiene reparto o si el usuario tiene acceso a alguna
-- empresa del reparto. Ahora la fila 'CHIA ABAGO' no cuenta como empresa del
-- holding: la visibilidad depende de las demás filas; si solo hay Abago (o no
-- hay reparto), la ven todos los usuarios del módulo.
CREATE OR REPLACE FUNCTION public.legalizacion_gastos_visible(p_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM "LegalizacionGastosEmpresas" e
                 WHERE e."Legalizacion_Id" = p_id AND e."Empresa" <> 'CHIA ABAGO')
    OR EXISTS (
      SELECT 1 FROM "LegalizacionGastosEmpresas" e
       WHERE e."Legalizacion_Id" = p_id AND e."Empresa" <> 'CHIA ABAGO'
         AND user_has_company(e."Empresa")
    );
$$;

NOTIFY pgrst, 'reload schema';
