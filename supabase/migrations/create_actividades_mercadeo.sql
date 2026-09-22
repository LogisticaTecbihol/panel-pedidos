-- ============================================================
-- CRM de Mercadeo — Entrega 2: tabla ActividadesMercadeo
--
-- Registro de actividades de mercadeo (eventos, digital, POP, trade) con
-- presupuesto asignado, fechas y responsable. Un lead puede opcionalmente
-- vincularse a la actividad que lo generó (Leads."Actividad_Id"), lo que
-- permite calcular "leads generados" por actividad en el cliente.
--
-- Acceso: SELECT abierto a cualquier autenticado (útil para que un comercial
-- sepa de un evento activo); INSERT/UPDATE/DELETE solo admin/editor/mercadeo
-- (mismo criterio que Leads en create_crm_leads.sql).
--
-- Requiere que create_crm_leads.sql ya se haya aplicado.
-- Idempotente. Aplicar con apply_migration (MCP).
-- ============================================================

-- ── 1. Tabla ActividadesMercadeo ──
CREATE TABLE IF NOT EXISTS public."ActividadesMercadeo" (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Nombre"                   text NOT NULL DEFAULT '',
  "Tipo"                     text NOT NULL CHECK ("Tipo" IN ('Eventos','Digital','POP','Trade','Diseño','Otro')),
  "Empresas"                 text NOT NULL DEFAULT '',
  "Fecha_Solicitud"          date,
  "Fecha_Inicio"             date,
  "Fecha_Fin"                date,
  "Responsable"              uuid REFERENCES usuarios(id),
  "Estado"                   text NOT NULL DEFAULT 'Planificada'
                                   CHECK ("Estado" IN ('Planificada','En ejecucion','Cerrada','Cancelada')),
  "Objetivo"                 text NOT NULL DEFAULT '',
  "Presupuesto_Asignado"     numeric NOT NULL DEFAULT 0,
  "Base_Datos_Entregada"     boolean NOT NULL DEFAULT false,
  "Fecha_Entrega_Base_Datos" date,
  "Observaciones"            text NOT NULL DEFAULT '',
  "creado_por"               uuid,
  "creado_por_nombre"        text,
  "creado_en"                timestamptz,
  "modificado_por"           uuid,
  "modificado_por_nombre"    text,
  "modificado_en"            timestamptz
);

CREATE INDEX IF NOT EXISTS actividadesmercadeo_estado ON public."ActividadesMercadeo" ("Estado");
CREATE INDEX IF NOT EXISTS actividadesmercadeo_tipo ON public."ActividadesMercadeo" ("Tipo");

COMMENT ON TABLE public."ActividadesMercadeo" IS
  'CRM de Mercadeo. Actividades (eventos, digital, POP, trade) con presupuesto asignado y responsable; Leads.Actividad_Id referencia la actividad que generó cada lead.';

-- ── 2. Vínculo opcional Leads -> ActividadesMercadeo ──
ALTER TABLE public."Leads"
  ADD COLUMN IF NOT EXISTS "Actividad_Id" bigint REFERENCES public."ActividadesMercadeo"(id);

CREATE INDEX IF NOT EXISTS leads_actividad_id ON public."Leads" ("Actividad_Id");

-- ── 3. Auditoría (trigger genérico ya existente) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."ActividadesMercadeo";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."ActividadesMercadeo"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."ActividadesMercadeo";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."ActividadesMercadeo"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 4. RLS ──
ALTER TABLE public."ActividadesMercadeo" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ActividadesMercadeo_select" ON public."ActividadesMercadeo";
DROP POLICY IF EXISTS "ActividadesMercadeo_insert" ON public."ActividadesMercadeo";
DROP POLICY IF EXISTS "ActividadesMercadeo_update" ON public."ActividadesMercadeo";
DROP POLICY IF EXISTS "ActividadesMercadeo_delete" ON public."ActividadesMercadeo";

CREATE POLICY "ActividadesMercadeo_select" ON public."ActividadesMercadeo" FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ActividadesMercadeo_insert" ON public."ActividadesMercadeo" FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

CREATE POLICY "ActividadesMercadeo_update" ON public."ActividadesMercadeo" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

CREATE POLICY "ActividadesMercadeo_delete" ON public."ActividadesMercadeo" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

GRANT ALL ON public."ActividadesMercadeo" TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
