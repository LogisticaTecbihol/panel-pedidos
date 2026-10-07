-- ============================================================
-- Tipo de entrega de las muestras (muestras.html → pestaña Despachos).
--
-- Cada despacho de muestras (= una solicitud despachada con su remisión) se
-- clasifica como: 'Ruta' (por defecto) | 'Envío' | 'Comercial'.
-- Es el equivalente de TipoDespacho (pedidos) — ver create_tipo_despacho.sql.
--
-- Clave: (empresa, consecutivo, remision). Solo se guardan las filas que
-- alguien cambia o confirma; "sin fila" = 'Ruta'. No hace falta backfill.
--
-- Escritura: admin, editor, remisionador y despachador.
-- Lectura: igual que SolicitudMuestras — cualquier rol de la empresa, salvo el
-- comercial, que solo ve las de SUS solicitudes (la RLS de SolicitudMuestras se
-- aplica dentro del EXISTS, así que no hay que repetir la regla responsable_id /
-- creado_por).
--
-- Fecha: 2026-10-07
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."TipoDespachoMuestra" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "empresa"                text NOT NULL DEFAULT '',
  "consecutivo"            text NOT NULL DEFAULT '',
  "remision"               text NOT NULL DEFAULT '',
  "tipo"                   text NOT NULL DEFAULT 'Ruta',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);

ALTER TABLE public."TipoDespachoMuestra"
  DROP CONSTRAINT IF EXISTS tipo_despacho_muestra_tipo_valido;
ALTER TABLE public."TipoDespachoMuestra"
  ADD  CONSTRAINT tipo_despacho_muestra_tipo_valido
       CHECK ("tipo" IN ('Ruta','Envío','Comercial'));

-- Una sola fila por despacho (también es el destino del upsert del panel).
CREATE UNIQUE INDEX IF NOT EXISTS ux_tipo_despacho_muestra_clave
  ON public."TipoDespachoMuestra" ("empresa", "consecutivo", "remision");

COMMENT ON TABLE public."TipoDespachoMuestra" IS
  'Clasificación de la entrega de una solicitud de muestras (Ruta/Envío/Comercial) por remisión. Sin fila = Ruta. Clave = (empresa, consecutivo, remision) de SolicitudMuestras.';

-- ── 2. Auditoría (triggers genéricos ya existentes) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."TipoDespachoMuestra";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."TipoDespachoMuestra"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."TipoDespachoMuestra";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."TipoDespachoMuestra"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 3. RLS ──
ALTER TABLE public."TipoDespachoMuestra" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TipoDespachoMuestra_select" ON public."TipoDespachoMuestra";
CREATE POLICY "TipoDespachoMuestra_select" ON public."TipoDespachoMuestra" FOR SELECT TO authenticated
  USING (
    (user_has_company("empresa") OR get_user_role() = 'gerente_iaso')
    AND (
      get_user_role() <> 'comercial'
      OR EXISTS (
        SELECT 1 FROM public."SolicitudMuestras" s
        WHERE s."Empresa"     = "TipoDespachoMuestra"."empresa"
          AND s."Consecutivo" = "TipoDespachoMuestra"."consecutivo"
      )
    )
  );

DROP POLICY IF EXISTS "TipoDespachoMuestra_insert" ON public."TipoDespachoMuestra";
CREATE POLICY "TipoDespachoMuestra_insert" ON public."TipoDespachoMuestra" FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  );

DROP POLICY IF EXISTS "TipoDespachoMuestra_update" ON public."TipoDespachoMuestra";
CREATE POLICY "TipoDespachoMuestra_update" ON public."TipoDespachoMuestra" FOR UPDATE TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  )
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  );

DROP POLICY IF EXISTS "TipoDespachoMuestra_delete" ON public."TipoDespachoMuestra";
CREATE POLICY "TipoDespachoMuestra_delete" ON public."TipoDespachoMuestra" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']));

-- ── 4. Permisos ──
REVOKE ALL ON public."TipoDespachoMuestra" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TipoDespachoMuestra" TO authenticated;

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_tipo_despacho_muestra
-- ============================================================
