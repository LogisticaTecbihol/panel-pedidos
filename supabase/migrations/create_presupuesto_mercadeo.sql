-- ============================================================
-- CRM de Mercadeo — Entrega 3: Presupuesto + cierre automático de leads
--
-- Presupuesto: cabecera PresupuestoMercadeo (lo presupuestado por
-- empresa/rubro/periodo) + detalle PresupuestoMercadeoGastos (lo ejecutado,
-- opcionalmente ligado a una actividad puntual, con fecha de legalización
-- para el indicador de 5 días hábiles del manual de POP). Lo ejecutado NUNCA
-- se duplica en la cabecera: se suma en el cliente desde el detalle (mismo
-- patrón cabecera+líneas que Pedidos/EntregasPedido).
--
-- Acceso: información financiera por empresa — completamente restringida
-- (SELECT incluido) a admin/editor/mercadeo, a diferencia de Leads y
-- ActividadesMercadeo donde comercial sí puede leer.
--
-- Cierre automático de leads: un lead sin movimiento (Fecha_Ultima_Interaccion
-- o, en su defecto, Fecha_Asignacion o creado_en) por más de 90 días se marca
-- 'Cerrado'/'Cierre automático' vía un job diario de pg_cron (mismo patrón que
-- notifica_diaria_programacion_planta.sql).
--
-- Requiere que create_crm_leads.sql y create_actividades_mercadeo.sql ya se
-- hayan aplicado. Idempotente. Aplicar con apply_migration (MCP).
-- ============================================================

-- ── 1. Tabla PresupuestoMercadeo (cabecera) ──
CREATE TABLE IF NOT EXISTS public."PresupuestoMercadeo" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Empresa"             text NOT NULL,
  "Rubro"               text NOT NULL CHECK ("Rubro" IN ('Eventos','Digital','POP','Trade','Diseño','Otro')),
  "Periodo"             text NOT NULL,
  "Valor_Presupuestado" numeric NOT NULL DEFAULT 0,
  "Observaciones"       text NOT NULL DEFAULT '',
  "creado_por"            uuid,
  "creado_por_nombre"     text,
  "creado_en"             timestamptz,
  "modificado_por"        uuid,
  "modificado_por_nombre" text,
  "modificado_en"         timestamptz,
  UNIQUE ("Empresa", "Rubro", "Periodo")
);

COMMENT ON TABLE public."PresupuestoMercadeo" IS
  'CRM de Mercadeo. Presupuesto asignado por empresa/rubro/periodo; lo ejecutado se suma en el cliente desde PresupuestoMercadeoGastos.';

-- ── 2. Tabla PresupuestoMercadeoGastos (detalle ejecutado) ──
CREATE TABLE IF NOT EXISTS public."PresupuestoMercadeoGastos" (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Presupuesto_Id"       bigint NOT NULL REFERENCES public."PresupuestoMercadeo"(id) ON DELETE CASCADE,
  "Actividad_Id"         bigint REFERENCES public."ActividadesMercadeo"(id),
  "Fecha_Gasto"          date NOT NULL DEFAULT current_date,
  "Valor_Ejecutado"      numeric NOT NULL DEFAULT 0,
  "Concepto"             text NOT NULL DEFAULT '',
  "Fecha_Legalizacion"   date,
  "Observaciones"        text NOT NULL DEFAULT '',
  "creado_por"            uuid,
  "creado_por_nombre"     text,
  "creado_en"             timestamptz,
  "modificado_por"        uuid,
  "modificado_por_nombre" text,
  "modificado_en"         timestamptz
);

CREATE INDEX IF NOT EXISTS presupuestomercadeogastos_presupuesto_id ON public."PresupuestoMercadeoGastos" ("Presupuesto_Id");
CREATE INDEX IF NOT EXISTS presupuestomercadeogastos_actividad_id ON public."PresupuestoMercadeoGastos" ("Actividad_Id");

COMMENT ON TABLE public."PresupuestoMercadeoGastos" IS
  'CRM de Mercadeo. Gastos ejecutados y legalizados contra una línea de PresupuestoMercadeo, opcionalmente ligados a una actividad puntual.';

-- ── 3. Auditoría (trigger genérico ya existente) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."PresupuestoMercadeo";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."PresupuestoMercadeo"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."PresupuestoMercadeo";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."PresupuestoMercadeo"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."PresupuestoMercadeoGastos";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."PresupuestoMercadeoGastos"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."PresupuestoMercadeoGastos";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."PresupuestoMercadeoGastos"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 4. RLS: completamente restringida a admin/editor/mercadeo ──
ALTER TABLE public."PresupuestoMercadeo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PresupuestoMercadeoGastos" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PresupuestoMercadeo_all" ON public."PresupuestoMercadeo";
CREATE POLICY "PresupuestoMercadeo_all" ON public."PresupuestoMercadeo" FOR ALL TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

DROP POLICY IF EXISTS "PresupuestoMercadeoGastos_all" ON public."PresupuestoMercadeoGastos";
CREATE POLICY "PresupuestoMercadeoGastos_all" ON public."PresupuestoMercadeoGastos" FOR ALL TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

GRANT ALL ON public."PresupuestoMercadeo" TO anon, authenticated, service_role;
GRANT ALL ON public."PresupuestoMercadeoGastos" TO anon, authenticated, service_role;

-- ── 5. Cierre automático de leads sin movimiento en 90 días ──
CREATE OR REPLACE FUNCTION public.cerrar_leads_inactivos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public."Leads"
     SET "Estado" = 'Cerrado',
         "Resultado_Cierre" = 'Cierre automático',
         "Fecha_Cierre" = now()
   WHERE "Estado" <> 'Cerrado'
     AND COALESCE("Fecha_Ultima_Interaccion", "Fecha_Asignacion", "creado_en") < now() - interval '90 days';
END;
$function$;

-- Sin GRANT a authenticated/anon: solo lo invoca el cron job (como postgres).
REVOKE ALL ON FUNCTION public.cerrar_leads_inactivos() FROM public, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm-cerrar-leads-inactivos';
END $$;

SELECT cron.schedule(
  'crm-cerrar-leads-inactivos',
  '0 10 * * *',   -- 10:00 UTC = 5:00 a.m. Bogotá (antes de que arranque el día laboral)
  $$SELECT public.cerrar_leads_inactivos();$$
);

-- ── 6. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';
