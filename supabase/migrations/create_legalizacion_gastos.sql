-- ============================================================
-- Módulo "Legalización de Gastos"
--
-- Reemplaza el formato Excel CT-PFT-FO02 "Legalización de Gastos":
-- gastos de ruta de un conductor (combustible, alimentación, peajes)
-- contra un anticipo entregado, con conciliación de saldo.
--
-- Modelo cabecera + líneas (mismo patrón que PresupuestoMercadeo /
-- PresupuestoMercadeoGastos, create_presupuesto_mercadeo.sql):
--   - LegalizacionGastos          cabecera (1 fila por legalización)
--   - LegalizacionGastosItems     líneas de gasto (concepto/proveedor/NIT/valor)
--   - LegalizacionGastosEmpresas  reparto MANUAL del total entre empresas
--
-- Flujo en dos pasos:
--   1) Captura (módulo 'legalizacion_gastos'): crea la legalización, sus
--      líneas de gasto y el reparto por empresa. Editable mientras
--      Estado_Conciliacion = 'Por conciliar'.
--   2) Conciliación (módulo 'legalizacion_gastos_aprobar', vía RPC
--      conciliar_legalizacion_gastos): fija el saldo a favor del empleado
--      o por reembolsar a la empresa, y cierra el registro (Conciliada) o
--      lo devuelve con motivo (Rechazada). Mismo estilo que
--      resolver_aprobacion_pedido (add_aprobacion_pedido_cliente_nuevo.sql).
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

-- ── 1. Tabla LegalizacionGastos (cabecera) ──
CREATE TABLE IF NOT EXISTS public."LegalizacionGastos" (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Consecutivo"               text GENERATED ALWAYS AS ('LEG-' || lpad(id::text, 5, '0')) STORED,
  "Fecha"                     date NOT NULL DEFAULT current_date,
  "Responsable"               text NOT NULL DEFAULT '',
  "Recorrido_Ruta"            text NOT NULL DEFAULT '',
  "No_Personas"               int,
  "Fecha_Salida"              date,
  "Fecha_Llegada"             date,
  "Clientes"                  text NOT NULL DEFAULT '',
  "Remisiones_Relacionadas"   text NOT NULL DEFAULT '',
  "Anticipo_Entregado"        numeric NOT NULL DEFAULT 0,
  "Saldo_Favor_Empleado"      numeric,
  "Saldo_Reembolsar_Empresa"  numeric,
  "Observaciones"             text NOT NULL DEFAULT '',
  "Estado_Conciliacion"       text NOT NULL DEFAULT 'Por conciliar',
  "Conciliado_Por"            text,
  "Fecha_Conciliacion"        timestamptz,
  "Motivo_Rechazo"            text,
  "creado_por"                uuid,
  "creado_por_nombre"         text,
  "creado_en"                 timestamptz,
  "modificado_por"            uuid,
  "modificado_por_nombre"     text,
  "modificado_en"             timestamptz
);

ALTER TABLE public."LegalizacionGastos"
  DROP CONSTRAINT IF EXISTS legalizacion_gastos_estado_valido;
ALTER TABLE public."LegalizacionGastos"
  ADD  CONSTRAINT legalizacion_gastos_estado_valido
       CHECK ("Estado_Conciliacion" IN ('Por conciliar','Conciliada','Rechazada'));

COMMENT ON TABLE public."LegalizacionGastos" IS
  'Legalización de gastos de ruta de conductores (combustible, alimentación, peajes) contra un anticipo, reemplaza el formato CT-PFT-FO02. Líneas de gasto en LegalizacionGastosItems, reparto entre empresas en LegalizacionGastosEmpresas.';

-- ── 2. Tabla LegalizacionGastosItems (líneas de gasto) ──
CREATE TABLE IF NOT EXISTS public."LegalizacionGastosItems" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Legalizacion_Id"        bigint NOT NULL REFERENCES public."LegalizacionGastos"(id) ON DELETE CASCADE,
  "Concepto"               text NOT NULL DEFAULT '',
  "Proveedor"              text NOT NULL DEFAULT '',
  "NIT"                    text NOT NULL DEFAULT '',
  "Valor"                  numeric NOT NULL DEFAULT 0,
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_legalizacion_gastos_items_legalizacion
  ON public."LegalizacionGastosItems" ("Legalizacion_Id");

COMMENT ON TABLE public."LegalizacionGastosItems" IS
  'Líneas de gasto (concepto/proveedor/NIT/valor) de una LegalizacionGastos.';

-- ── 3. Tabla LegalizacionGastosEmpresas (reparto manual entre empresas) ──
CREATE TABLE IF NOT EXISTS public."LegalizacionGastosEmpresas" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Legalizacion_Id"        bigint NOT NULL REFERENCES public."LegalizacionGastos"(id) ON DELETE CASCADE,
  "Empresa"                text NOT NULL,
  "Monto"                  numeric NOT NULL DEFAULT 0,
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz,
  UNIQUE ("Legalizacion_Id", "Empresa")
);
CREATE INDEX IF NOT EXISTS idx_legalizacion_gastos_empresas_legalizacion
  ON public."LegalizacionGastosEmpresas" ("Legalizacion_Id");

COMMENT ON TABLE public."LegalizacionGastosEmpresas" IS
  'Reparto manual (monto por empresa) del total de una LegalizacionGastos entre las empresas del holding involucradas.';

-- ── 4. Auditoría (trigger genérico ya existente) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LegalizacionGastos";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LegalizacionGastos";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LegalizacionGastosItems";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastosItems"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LegalizacionGastosItems";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosItems"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LegalizacionGastosEmpresas";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastosEmpresas"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LegalizacionGastosEmpresas";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosEmpresas"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 5. Módulo/permiso nuevo en usuario_modulos ──
-- (mismo patrón que muestras_aprobar/ordenes_aprobar, add_aprobacion_ordenes.sql)
ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;
ALTER TABLE usuario_modulos
  ADD  CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad','notificaciones','clientes',
    'productos','reabastecimiento','bodegas_consignacion',
    'cartera','crm',
    'legalizacion_gastos','legalizacion_gastos_aprobar'
  ));

-- ── 6. RLS ──
ALTER TABLE public."LegalizacionGastos"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LegalizacionGastosItems"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LegalizacionGastosEmpresas" ENABLE ROW LEVEL SECURITY;

-- Helper: visible si NO tiene reparto todavía (recién creada, en el mismo
-- flujo de guardado) o si el usuario tiene acceso a alguna de las empresas
-- del reparto (admin/cartera siempre pasan vía user_has_company).
CREATE OR REPLACE FUNCTION public.legalizacion_gastos_visible(p_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM "LegalizacionGastosEmpresas" e WHERE e."Legalizacion_Id" = p_id)
    OR EXISTS (
      SELECT 1 FROM "LegalizacionGastosEmpresas" e
       WHERE e."Legalizacion_Id" = p_id AND user_has_company(e."Empresa")
    );
$$;

-- LegalizacionGastos
DROP POLICY IF EXISTS "LegalizacionGastos_select" ON public."LegalizacionGastos";
CREATE POLICY "LegalizacionGastos_select" ON public."LegalizacionGastos" FOR SELECT TO authenticated
  USING (
    (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'))
    AND public.legalizacion_gastos_visible(id)
  );

DROP POLICY IF EXISTS "LegalizacionGastos_insert" ON public."LegalizacionGastos";
CREATE POLICY "LegalizacionGastos_insert" ON public."LegalizacionGastos" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('legalizacion_gastos'));

DROP POLICY IF EXISTS "LegalizacionGastos_update" ON public."LegalizacionGastos";
CREATE POLICY "LegalizacionGastos_update" ON public."LegalizacionGastos" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos') AND "Estado_Conciliacion" = 'Por conciliar')
  WITH CHECK (public.user_has_module('legalizacion_gastos') AND "Estado_Conciliacion" = 'Por conciliar');

DROP POLICY IF EXISTS "LegalizacionGastos_delete" ON public."LegalizacionGastos";
CREATE POLICY "LegalizacionGastos_delete" ON public."LegalizacionGastos" FOR DELETE TO authenticated
  USING (public.user_has_module('legalizacion_gastos') AND "Estado_Conciliacion" = 'Por conciliar');

-- LegalizacionGastosItems
DROP POLICY IF EXISTS "LegalizacionGastosItems_select" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_select" ON public."LegalizacionGastosItems" FOR SELECT TO authenticated
  USING (
    (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'))
    AND public.legalizacion_gastos_visible("Legalizacion_Id")
  );

DROP POLICY IF EXISTS "LegalizacionGastosItems_insert" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_insert" ON public."LegalizacionGastosItems" FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosItems_update" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_update" ON public."LegalizacionGastosItems" FOR UPDATE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  )
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosItems_delete" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_delete" ON public."LegalizacionGastosItems" FOR DELETE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

-- LegalizacionGastosEmpresas (mismas reglas que Items)
DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_select" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_select" ON public."LegalizacionGastosEmpresas" FOR SELECT TO authenticated
  USING (
    (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'))
    AND public.legalizacion_gastos_visible("Legalizacion_Id")
  );

DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_insert" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_insert" ON public."LegalizacionGastosEmpresas" FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_update" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_update" ON public."LegalizacionGastosEmpresas" FOR UPDATE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  )
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_delete" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_delete" ON public."LegalizacionGastosEmpresas" FOR DELETE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

GRANT ALL ON public."LegalizacionGastos"         TO anon, authenticated, service_role;
GRANT ALL ON public."LegalizacionGastosItems"    TO anon, authenticated, service_role;
GRANT ALL ON public."LegalizacionGastosEmpresas" TO anon, authenticated, service_role;

-- ── 7. RPC: conciliar / rechazar (segundo paso, permiso 'legalizacion_gastos_aprobar') ──
-- Mismo estilo que resolver_aprobacion_pedido (add_aprobacion_pedido_cliente_nuevo.sql).
CREATE OR REPLACE FUNCTION public.conciliar_legalizacion_gastos(
  p_id               bigint,
  p_aprobar          boolean,
  p_saldo_favor      numeric DEFAULT NULL,
  p_saldo_reembolsar numeric DEFAULT NULL,
  p_motivo_rechazo   text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT public.user_has_module('legalizacion_gastos_aprobar') THEN
    RAISE EXCEPTION 'No autorizado: falta el permiso para conciliar legalizaciones de gastos';
  END IF;
  IF NOT p_aprobar AND btrim(COALESCE(p_motivo_rechazo, '')) = '' THEN
    RAISE EXCEPTION 'Indica el motivo del rechazo';
  END IF;

  UPDATE "LegalizacionGastos"
     SET "Estado_Conciliacion"      = CASE WHEN p_aprobar THEN 'Conciliada' ELSE 'Rechazada' END,
         "Saldo_Favor_Empleado"     = CASE WHEN p_aprobar THEN p_saldo_favor ELSE NULL END,
         "Saldo_Reembolsar_Empresa" = CASE WHEN p_aprobar THEN p_saldo_reembolsar ELSE NULL END,
         "Motivo_Rechazo"           = NULLIF(btrim(COALESCE(p_motivo_rechazo, '')), ''),
         "Conciliado_Por"           = public._usuario_nombre(auth.uid()),
         "Fecha_Conciliacion"       = now(),
         modificado_por             = auth.uid()
   WHERE id = p_id AND "Estado_Conciliacion" = 'Por conciliar';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'La legalización ya no está pendiente de conciliar (o no existe)';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'aprobada', p_aprobar);
END;
$$;

REVOKE ALL ON FUNCTION public.conciliar_legalizacion_gastos(bigint, boolean, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conciliar_legalizacion_gastos(bigint, boolean, numeric, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.conciliar_legalizacion_gastos(bigint, boolean, numeric, numeric, text) TO authenticated;

-- ── 8. Storage: bucket NO público (a diferencia de pedidos/ingresos/muestras/
--    cambios-adjuntos, ver hallazgo de seguridad #7): solo accesible a quien
--    tenga alguno de los dos módulos, con límite de tamaño/tipo también a
--    nivel de bucket (defensa en profundidad además de la validación en JS). ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'legalizacion-gastos-adjuntos', 'legalizacion-gastos-adjuntos', false,
  5242880, ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "leg_adjuntos_select" ON storage.objects;
CREATE POLICY "leg_adjuntos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'legalizacion-gastos-adjuntos'
    AND (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'))
  );

DROP POLICY IF EXISTS "leg_adjuntos_insert" ON storage.objects;
CREATE POLICY "leg_adjuntos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'legalizacion-gastos-adjuntos'
    AND public.user_has_module('legalizacion_gastos')
  );

DROP POLICY IF EXISTS "leg_adjuntos_delete" ON storage.objects;
CREATE POLICY "leg_adjuntos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'legalizacion-gastos-adjuntos'
    AND public.user_has_module('legalizacion_gastos')
  );

-- ── 9. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
