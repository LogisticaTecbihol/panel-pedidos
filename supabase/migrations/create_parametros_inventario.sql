-- Fase 3 (Reabastecimiento) — Parametros de inventario por producto.
--
-- Punto de reorden, stock de seguridad, lead time y cobertura objetivo que el
-- modulo Reabastecimiento cruza con el stock actual (snapshot Kardex) y el
-- consumo real (salidas a cliente, 90 dias) para sugerir que reponer.
--
-- Empresa NULL = el parametro aplica a todas las empresas del holding; una fila
-- con Empresa especifica lo sobrescribe para esa empresa (indice unico sobre
-- (Producto, COALESCE(Empresa,''))).
--
-- punto_reorden = 0  -> el modulo lo calcula: consumo_diario * lead_time + stock_seguridad
-- lote_optimo_compra = 0 -> sin redondeo de la cantidad sugerida
--
-- RLS y triggers de auditoria siguen el patron de maestro_productos.
-- Aplicar con apply_migration del MCP de Supabase (no se aplica con el push).

CREATE TABLE IF NOT EXISTS public."parametros_inventario" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Producto" text NOT NULL,
  "Empresa" text,
  "stock_seguridad" numeric NOT NULL DEFAULT 0,
  "punto_reorden" numeric NOT NULL DEFAULT 0,
  "lote_optimo_compra" numeric NOT NULL DEFAULT 0,
  "lead_time_dias" integer NOT NULL DEFAULT 15,
  "dias_cobertura_objetivo" integer NOT NULL DEFAULT 30,
  "empresa_proveedora_default" text NOT NULL DEFAULT '',
  "activo" boolean NOT NULL DEFAULT true,
  "creado_por" uuid,
  "creado_por_nombre" text,
  "creado_en" timestamptz,
  "modificado_por" uuid,
  "modificado_por_nombre" text,
  "modificado_en" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS parametros_inventario_prod_emp
  ON public."parametros_inventario" ("Producto", COALESCE("Empresa", ''));

COMMENT ON TABLE public."parametros_inventario" IS
  'Fase 3 Reabastecimiento. Punto de reorden / stock de seguridad / lead time por producto (Empresa NULL = todas). Editable desde el modulo Reabastecimiento.';

-- ── RLS (patron maestro_productos) ──
ALTER TABLE public."parametros_inventario" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parametros_inventario_select" ON public."parametros_inventario";
DROP POLICY IF EXISTS "parametros_inventario_insert" ON public."parametros_inventario";
DROP POLICY IF EXISTS "parametros_inventario_update" ON public."parametros_inventario";
DROP POLICY IF EXISTS "parametros_inventario_delete" ON public."parametros_inventario";

CREATE POLICY "parametros_inventario_select" ON public."parametros_inventario"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "parametros_inventario_insert" ON public."parametros_inventario"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

CREATE POLICY "parametros_inventario_update" ON public."parametros_inventario"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

CREATE POLICY "parametros_inventario_delete" ON public."parametros_inventario"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

GRANT ALL ON public."parametros_inventario" TO anon, authenticated, service_role;

-- ── Auditoria (mismos triggers que las otras tablas del panel) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."parametros_inventario";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."parametros_inventario"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."parametros_inventario";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."parametros_inventario"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

NOTIFY pgrst, 'reload schema';
