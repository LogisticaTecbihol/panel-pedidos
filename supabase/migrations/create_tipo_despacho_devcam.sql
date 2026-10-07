-- ============================================================
-- Tipo de entrega de las devoluciones y cambios de mercancía
-- (devoluciones.html → pestaña Despachos).
--
-- Cada remisión de SALIDA (lo que se entrega al cliente) de una devolución o de
-- un cambio se clasifica como: 'Ruta' (por defecto) | 'Envío' | 'Comercial'.
-- Es el equivalente de TipoDespacho (pedidos) y TipoDespachoMuestra (muestras).
--
-- Clave: (origen, empresa, remision). La remisión es el despacho físico: si cubre
-- varias devoluciones/cambios se clasifica una sola vez. Solo se guardan las filas
-- que alguien cambia o confirma; "sin fila" = 'Ruta'. No hace falta backfill.
--
-- Escritura: admin, editor, remisionador y despachador.
-- Lectura: igual que Devoluciones / CambiosMercancia — cualquier rol de la empresa,
-- salvo el comercial, que solo ve las remisiones de SUS devoluciones/cambios (la
-- RLS de esas tablas, creado_por = auth.uid(), se aplica dentro del EXISTS).
--
-- Fecha: 2026-10-07
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."TipoDespachoDevCam" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "origen"                 text NOT NULL,
  "empresa"                text NOT NULL DEFAULT '',
  "remision"               text NOT NULL DEFAULT '',
  "tipo"                   text NOT NULL DEFAULT 'Ruta',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);

ALTER TABLE public."TipoDespachoDevCam"
  DROP CONSTRAINT IF EXISTS tipo_despacho_devcam_tipo_valido;
ALTER TABLE public."TipoDespachoDevCam"
  ADD  CONSTRAINT tipo_despacho_devcam_tipo_valido
       CHECK ("tipo" IN ('Ruta','Envío','Comercial'));

ALTER TABLE public."TipoDespachoDevCam"
  DROP CONSTRAINT IF EXISTS tipo_despacho_devcam_origen_valido;
ALTER TABLE public."TipoDespachoDevCam"
  ADD  CONSTRAINT tipo_despacho_devcam_origen_valido
       CHECK ("origen" IN ('Devolucion','Cambio'));

-- Una sola fila por despacho (también es el destino del upsert del panel).
CREATE UNIQUE INDEX IF NOT EXISTS ux_tipo_despacho_devcam_clave
  ON public."TipoDespachoDevCam" ("origen", "empresa", "remision");

COMMENT ON TABLE public."TipoDespachoDevCam" IS
  'Clasificación de la entrega (Ruta/Envío/Comercial) de una remisión de salida de Devoluciones o CambiosMercancia. Sin fila = Ruta. Clave = (origen, empresa, remision).';

-- ── 2. Auditoría (triggers genéricos ya existentes) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."TipoDespachoDevCam";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."TipoDespachoDevCam"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."TipoDespachoDevCam";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."TipoDespachoDevCam"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 3. RLS ──
ALTER TABLE public."TipoDespachoDevCam" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TipoDespachoDevCam_select" ON public."TipoDespachoDevCam";
CREATE POLICY "TipoDespachoDevCam_select" ON public."TipoDespachoDevCam" FOR SELECT TO authenticated
  USING (
    (user_has_company("empresa") OR get_user_role() = 'gerente_iaso')
    AND (
      get_user_role() <> 'comercial'
      OR ("origen" = 'Devolucion' AND EXISTS (
            SELECT 1 FROM public."Devoluciones" d
            WHERE btrim(d."Empresa") = "TipoDespachoDevCam"."empresa"
              AND btrim(d."Remision_Salida") = "TipoDespachoDevCam"."remision"))
      OR ("origen" = 'Cambio' AND EXISTS (
            SELECT 1 FROM public."CambiosMercancia" c
            WHERE btrim(c."Empresa") = "TipoDespachoDevCam"."empresa"
              AND btrim(c."Remision_Salida") = "TipoDespachoDevCam"."remision"))
    )
  );

DROP POLICY IF EXISTS "TipoDespachoDevCam_insert" ON public."TipoDespachoDevCam";
CREATE POLICY "TipoDespachoDevCam_insert" ON public."TipoDespachoDevCam" FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  );

DROP POLICY IF EXISTS "TipoDespachoDevCam_update" ON public."TipoDespachoDevCam";
CREATE POLICY "TipoDespachoDevCam_update" ON public."TipoDespachoDevCam" FOR UPDATE TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  )
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  );

DROP POLICY IF EXISTS "TipoDespachoDevCam_delete" ON public."TipoDespachoDevCam";
CREATE POLICY "TipoDespachoDevCam_delete" ON public."TipoDespachoDevCam" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']));

-- ── 4. Permisos ──
REVOKE ALL ON public."TipoDespachoDevCam" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TipoDespachoDevCam" TO authenticated;

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_tipo_despacho_devcam
-- ============================================================
