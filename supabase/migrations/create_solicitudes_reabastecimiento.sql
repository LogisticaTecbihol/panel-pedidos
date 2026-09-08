-- Fase 3 (Reabastecimiento) — Solicitudes de reabastecimiento generadas.
--
-- Cada fila es una necesidad de reposicion que alguien confirmo desde el modulo
-- Reabastecimiento, con la foto del stock / consumo / cobertura al momento de
-- generarla. Se exporta a Excel y opcionalmente se convierte en una OC
-- inter-empresa borrador (OrdenesCompra Tipo 'Compra', Estado_Aprobacion 'Por aprobar').
--
-- estado:  Pendiente -> En OC -> Comprada   |   Descartada
--
-- RLS y triggers de auditoria siguen el patron de maestro_productos.
-- Aplicar con apply_migration del MCP de Supabase (no se aplica con el push).

CREATE TABLE IF NOT EXISTS public."solicitudes_reabastecimiento" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Fecha" text NOT NULL DEFAULT '',
  "Producto" text NOT NULL,
  "Presentacion" text NOT NULL DEFAULT '',
  "Empresa" text NOT NULL,
  "cantidad_sugerida" numeric NOT NULL DEFAULT 0,
  "motivo" text NOT NULL DEFAULT '',
  "stock_actual" numeric NOT NULL DEFAULT 0,
  "consumo_diario" numeric NOT NULL DEFAULT 0,
  "cobertura_dias" numeric NOT NULL DEFAULT 0,
  "estado" text NOT NULL DEFAULT 'Pendiente',
  "empresa_proveedora" text NOT NULL DEFAULT '',
  "oc_consecutivo" text NOT NULL DEFAULT '',
  "notas" text NOT NULL DEFAULT '',
  "creado_por" uuid,
  "creado_por_nombre" text,
  "creado_en" timestamptz,
  "modificado_por" uuid,
  "modificado_por_nombre" text,
  "modificado_en" timestamptz
);

CREATE INDEX IF NOT EXISTS solicitudes_reab_estado
  ON public."solicitudes_reabastecimiento" ("estado");
CREATE INDEX IF NOT EXISTS solicitudes_reab_prod_emp
  ON public."solicitudes_reabastecimiento" ("Producto", "Empresa");

COMMENT ON TABLE public."solicitudes_reabastecimiento" IS
  'Fase 3 Reabastecimiento. Necesidades de reposicion confirmadas desde el modulo; se exportan a Excel y opcionalmente se convierten en OC inter-empresa borrador.';

-- ── RLS (patron maestro_productos) ──
ALTER TABLE public."solicitudes_reabastecimiento" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solicitudes_reab_select" ON public."solicitudes_reabastecimiento";
DROP POLICY IF EXISTS "solicitudes_reab_insert" ON public."solicitudes_reabastecimiento";
DROP POLICY IF EXISTS "solicitudes_reab_update" ON public."solicitudes_reabastecimiento";
DROP POLICY IF EXISTS "solicitudes_reab_delete" ON public."solicitudes_reabastecimiento";

CREATE POLICY "solicitudes_reab_select" ON public."solicitudes_reabastecimiento"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "solicitudes_reab_insert" ON public."solicitudes_reabastecimiento"
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

CREATE POLICY "solicitudes_reab_update" ON public."solicitudes_reabastecimiento"
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

CREATE POLICY "solicitudes_reab_delete" ON public."solicitudes_reabastecimiento"
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador']));

GRANT ALL ON public."solicitudes_reabastecimiento" TO anon, authenticated, service_role;

-- ── Auditoria ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."solicitudes_reabastecimiento";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."solicitudes_reabastecimiento"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."solicitudes_reabastecimiento";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."solicitudes_reabastecimiento"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

NOTIFY pgrst, 'reload schema';
