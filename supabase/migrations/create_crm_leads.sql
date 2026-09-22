-- ============================================================
-- CRM de Mercadeo — Entrega 1: módulo 'crm' + tablas Leads/LeadsSeguimiento
--
-- Pipeline de leads (manual de proceso MKT-P-10 de Mercadeo): captura ->
-- calificación -> asignación (48h) -> seguimiento -> cierre (Convertido /
-- Perdido / Cierre automático a 90 días sin movimiento).
--
-- Tablas independientes de ClientesUnicos/SolicitudMuestras/Pedidos por
-- decisión explícita (sin vinculación por ahora; se podrá enlazar después).
--
-- Acceso: admin/editor/mercadeo ven y gestionan todo; comercial solo ve y
-- gestiona los leads que tiene asignados (Asignado_A), mismo patrón RLS que
-- SolicitudMuestras.responsable_id.
--
-- Actividades de mercadeo y Presupuesto (Entregas 2 y 3) llegan en
-- migraciones posteriores; Leads."Actividad_Id" se añadirá entonces como FK.
--
-- Requiere que add_mercadeo_role.sql ya se haya aplicado.
-- Idempotente. Aplicar con apply_migration (MCP).
-- ============================================================

-- ── 1. Módulo 'crm' ──
ALTER TABLE usuario_modulos DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;
ALTER TABLE usuario_modulos ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad','notificaciones','clientes',
    'productos','reabastecimiento','bodegas_consignacion',
    'cartera','crm'
  ));

-- Notificaciones: permitir modulo='crm' (aviso de lead asignado)
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo IN (
    'pedidos','devoluciones','cambios','muestras','ordenes',
    'ingresos','reenvases','kardex','reportes','crm'
  ));

-- ── 2. Tabla Leads ──
CREATE TABLE IF NOT EXISTS public."Leads" (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Nombre_Contacto"          text NOT NULL DEFAULT '',
  "Empresa_Contacto"         text NOT NULL DEFAULT '',
  "Producto_Interes"         text NOT NULL DEFAULT '',
  "Telefono"                 text NOT NULL DEFAULT '',
  "Correo"                   text NOT NULL DEFAULT '',
  "Municipio"                text NOT NULL DEFAULT '',
  "Departamento"             text NOT NULL DEFAULT '',
  "Origen"                   text NOT NULL CHECK ("Origen" IN ('Evento','Digital','Distribuidor')),
  "Autorizacion_Datos"       boolean NOT NULL DEFAULT false,
  "Fecha_Captura"            date NOT NULL DEFAULT current_date,
  "Calificacion"             text CHECK ("Calificacion" IS NULL OR "Calificacion" IN ('Caliente','Tibio','Frio')),
  "Fecha_Calificacion"       timestamptz,
  "Asignado_A"               uuid REFERENCES usuarios(id),
  "Fecha_Asignacion"         timestamptz,
  "Fecha_Ultima_Interaccion" timestamptz,
  "Estado"                   text NOT NULL DEFAULT 'Nuevo'
                                   CHECK ("Estado" IN ('Nuevo','Calificado','Asignado','En seguimiento','Cerrado')),
  "Resultado_Cierre"         text CHECK ("Resultado_Cierre" IS NULL OR "Resultado_Cierre" IN ('Convertido','Perdido','Cierre automático')),
  "Valor_Venta"              numeric,
  "Motivo_Perdida"           text NOT NULL DEFAULT '',
  "Fecha_Cierre"             timestamptz,
  "Observaciones"            text NOT NULL DEFAULT '',
  "creado_por"               uuid,
  "creado_por_nombre"        text,
  "creado_en"                timestamptz,
  "modificado_por"           uuid,
  "modificado_por_nombre"    text,
  "modificado_en"            timestamptz,
  CONSTRAINT leads_cierre_check CHECK (
    "Estado" <> 'Cerrado'
    OR ("Resultado_Cierre" = 'Convertido' AND "Valor_Venta" IS NOT NULL)
    OR ("Resultado_Cierre" = 'Perdido' AND "Motivo_Perdida" <> '')
    OR ("Resultado_Cierre" = 'Cierre automático')
  )
);

CREATE INDEX IF NOT EXISTS leads_asignado_a ON public."Leads" ("Asignado_A");
CREATE INDEX IF NOT EXISTS leads_estado ON public."Leads" ("Estado");
CREATE INDEX IF NOT EXISTS leads_fecha_ultima_interaccion ON public."Leads" ("Fecha_Ultima_Interaccion");

COMMENT ON TABLE public."Leads" IS
  'CRM de Mercadeo. Pipeline de leads (manual MKT-P-10): captura, calificación, asignación a comercial, seguimiento y cierre.';

-- ── 3. Tabla LeadsSeguimiento (timeline de interacciones) ──
CREATE TABLE IF NOT EXISTS public."LeadsSeguimiento" (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Lead_Id"               bigint NOT NULL REFERENCES public."Leads"(id) ON DELETE CASCADE,
  "Tipo"                  text NOT NULL DEFAULT 'Llamada' CHECK ("Tipo" IN ('Llamada','Visita','Email','WhatsApp','Reunion','Otro')),
  "Fecha"                 timestamptz NOT NULL DEFAULT now(),
  "Resultado"             text NOT NULL DEFAULT '',
  "Observaciones"         text NOT NULL DEFAULT '',
  "creado_por"            uuid,
  "creado_por_nombre"     text,
  "creado_en"             timestamptz,
  "modificado_por"        uuid,
  "modificado_por_nombre" text,
  "modificado_en"         timestamptz
);

CREATE INDEX IF NOT EXISTS leadsseguimiento_lead_id ON public."LeadsSeguimiento" ("Lead_Id");

COMMENT ON TABLE public."LeadsSeguimiento" IS
  'Timeline de interacciones por lead (llamadas, visitas, etc.) — evidencia de gestión comercial.';

-- ── 4. Auditoría (trigger genérico ya existente) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."Leads";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."Leads"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."Leads";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."Leads"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LeadsSeguimiento";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LeadsSeguimiento"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LeadsSeguimiento";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LeadsSeguimiento"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 5. Un seguimiento nuevo actualiza el lead (última interacción + estado) ──
CREATE OR REPLACE FUNCTION public.touch_lead_on_seguimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public."Leads"
     SET "Fecha_Ultima_Interaccion" = NEW."Fecha",
         "Estado" = CASE WHEN "Estado" = 'Asignado' THEN 'En seguimiento' ELSE "Estado" END
   WHERE id = NEW."Lead_Id";
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_lead_on_seguimiento ON public."LeadsSeguimiento";
CREATE TRIGGER trg_touch_lead_on_seguimiento
  AFTER INSERT ON public."LeadsSeguimiento"
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_on_seguimiento();

REVOKE ALL ON FUNCTION public.touch_lead_on_seguimiento() FROM public, anon, authenticated;

-- ── 6. RLS ──
ALTER TABLE public."Leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeadsSeguimiento" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leads_select" ON public."Leads";
DROP POLICY IF EXISTS "Leads_insert" ON public."Leads";
DROP POLICY IF EXISTS "Leads_update" ON public."Leads";
DROP POLICY IF EXISTS "Leads_delete" ON public."Leads";

CREATE POLICY "Leads_select" ON public."Leads" FOR SELECT TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
    OR (get_user_role() = 'comercial' AND ("Asignado_A" = auth.uid() OR "creado_por" = auth.uid()))
  );

CREATE POLICY "Leads_insert" ON public."Leads" FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
    OR (get_user_role() = 'comercial' AND "Asignado_A" = auth.uid())
  );

CREATE POLICY "Leads_update" ON public."Leads" FOR UPDATE TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
    OR (get_user_role() = 'comercial' AND ("Asignado_A" = auth.uid() OR "creado_por" = auth.uid()))
  )
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
    OR (get_user_role() = 'comercial' AND ("Asignado_A" = auth.uid() OR "creado_por" = auth.uid()))
  );

CREATE POLICY "Leads_delete" ON public."Leads" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

DROP POLICY IF EXISTS "LeadsSeguimiento_select" ON public."LeadsSeguimiento";
DROP POLICY IF EXISTS "LeadsSeguimiento_insert" ON public."LeadsSeguimiento";
DROP POLICY IF EXISTS "LeadsSeguimiento_update" ON public."LeadsSeguimiento";
DROP POLICY IF EXISTS "LeadsSeguimiento_delete" ON public."LeadsSeguimiento";

CREATE POLICY "LeadsSeguimiento_select" ON public."LeadsSeguimiento" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Leads" l WHERE l.id = "LeadsSeguimiento"."Lead_Id"
        AND (
          get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
          OR (get_user_role() = 'comercial' AND (l."Asignado_A" = auth.uid() OR l."creado_por" = auth.uid()))
        )
    )
  );

CREATE POLICY "LeadsSeguimiento_insert" ON public."LeadsSeguimiento" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."Leads" l WHERE l.id = "LeadsSeguimiento"."Lead_Id"
        AND (
          get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
          OR (get_user_role() = 'comercial' AND (l."Asignado_A" = auth.uid() OR l."creado_por" = auth.uid()))
        )
    )
  );

CREATE POLICY "LeadsSeguimiento_update" ON public."LeadsSeguimiento" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

CREATE POLICY "LeadsSeguimiento_delete" ON public."LeadsSeguimiento" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','mercadeo']));

GRANT ALL ON public."Leads" TO anon, authenticated, service_role;
GRANT ALL ON public."LeadsSeguimiento" TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
