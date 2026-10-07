-- ============================================================
-- Tipo de despacho (pedidos.html → pestaña Despachos).
--
-- Cada despacho (= una remisión de un pedido) se clasifica como:
--   'Ruta' (por defecto) | 'Envío' | 'Comercial'.
--
-- Por qué una tabla propia y no una columna en EntregasPedido:
--   · EntregasPedido solo tiene filas desde 2026-07-31; ~la mitad de las
--     remisiones históricas que lista la pestaña no tienen fila ahí.
--   · Los N° de remisión viejos son numéricos ("1206") y se repiten entre
--     empresas/pedidos, así que la clave es la MISMA que usa la lista de
--     Despachos: (empresa, consecutivo, cliente, remisión).
--
-- Solo se guardan las filas que alguien cambia o confirma; "sin fila" = 'Ruta'.
-- Por eso no hace falta backfill.
--
-- Escritura: admin, editor, remisionador y despachador (los roles que operan
-- los despachos). Lectura: los mismos roles que ven Pedidos; el comercial solo
-- ve las de sus propios pedidos.
--
-- Fecha: 2026-10-07
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."TipoDespacho" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "empresa"                text NOT NULL DEFAULT '',
  "consecutivo"            text NOT NULL DEFAULT '',
  "cliente"                text NOT NULL DEFAULT '',
  "remision"               text NOT NULL DEFAULT '',
  "tipo"                   text NOT NULL DEFAULT 'Ruta',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);

ALTER TABLE public."TipoDespacho"
  DROP CONSTRAINT IF EXISTS tipo_despacho_tipo_valido;
ALTER TABLE public."TipoDespacho"
  ADD  CONSTRAINT tipo_despacho_tipo_valido
       CHECK ("tipo" IN ('Ruta','Envío','Comercial'));

-- Una sola fila por despacho (también es el destino del upsert del panel).
CREATE UNIQUE INDEX IF NOT EXISTS ux_tipo_despacho_clave
  ON public."TipoDespacho" ("empresa", "consecutivo", "cliente", "remision");

COMMENT ON TABLE public."TipoDespacho" IS
  'Clasificación del despacho (Ruta/Envío/Comercial) por remisión de un pedido. Sin fila = Ruta. Clave = la de la lista de Despachos en pedidos.html.';

-- ── 2. Auditoría (triggers genéricos ya existentes) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."TipoDespacho";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."TipoDespacho"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."TipoDespacho";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."TipoDespacho"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 3. RLS ──
ALTER TABLE public."TipoDespacho" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TipoDespacho_select" ON public."TipoDespacho";
CREATE POLICY "TipoDespacho_select" ON public."TipoDespacho" FOR SELECT TO authenticated
  USING (
    (user_has_company("empresa") OR get_user_role() = 'gerente_iaso')
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','lector','contabilidad','gerente_iaso','despachador','remisionador','cartera','produccion'])
      OR (
        get_user_role() = 'comercial'
        AND EXISTS (
          SELECT 1 FROM public."Pedidos" p
          WHERE p."Nombre_Empresa" = "TipoDespacho"."empresa"
            AND p."Consecutivo"    = "TipoDespacho"."consecutivo"
            AND p."Cliente"        = "TipoDespacho"."cliente"
        )
      )
    )
  );

DROP POLICY IF EXISTS "TipoDespacho_insert" ON public."TipoDespacho";
CREATE POLICY "TipoDespacho_insert" ON public."TipoDespacho" FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  );

DROP POLICY IF EXISTS "TipoDespacho_update" ON public."TipoDespacho";
CREATE POLICY "TipoDespacho_update" ON public."TipoDespacho" FOR UPDATE TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  )
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','remisionador','despachador'])
    AND user_has_company("empresa")
  );

DROP POLICY IF EXISTS "TipoDespacho_delete" ON public."TipoDespacho";
CREATE POLICY "TipoDespacho_delete" ON public."TipoDespacho" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor']));

-- ── 4. Permisos ──
-- Los grants por defecto del esquema public no deben dar acceso a anon.
REVOKE ALL ON public."TipoDespacho" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TipoDespacho" TO authenticated;

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_tipo_despacho
-- ============================================================
