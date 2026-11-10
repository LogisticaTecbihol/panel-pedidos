-- ═══════════════════════════════════════════════════════════════════════════
-- Legalización de Gastos: el rol 'lector' es de solo lectura también en la BD
-- ═══════════════════════════════════════════════════════════════════════════
-- BORRADOR PARA REVISAR: no está aplicado en la base viva.
--
-- Problema: las políticas de escritura de Legalización de Gastos solo piden
-- user_has_module('legalizacion_gastos'). Un lector necesita ese módulo para VER la
-- pantalla, así que —aunque la pantalla ya le oculta los botones (js/auth.js,
-- js/legalizacion-gastos.js)— podía crear, editar y borrar por la API o la consola.
--
-- Qué hace:
--   1. Crea public.user_can_write_module(modulo): igual a user_has_module, pero
--      falso para el rol 'lector'.
--   2. Cambia (ALTER POLICY, sin tocar roles ni comando) las 22 políticas de ESCRITURA
--      de las tablas de Legalización de Gastos, Remisiones externas, Vehículos, notas
--      del consecutivo y el bucket de soportes para usar esa función. Las de lectura
--      (SELECT) no cambian: el lector sigue viendo todo lo que ve hoy.
--   3. conciliar_legalizacion_gastos (RPC) también exige que no sea lector.
-- Nada cambia para los demás roles: admin/editor/contabilidad/... pasan igual que antes.
--
-- Reversión: legalizacion_gastos_lector_solo_lectura_rollback.sql
-- Comprobación: verify_legalizacion_gastos_lector.sql (solo lee)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Función auxiliar
CREATE OR REPLACE FUNCTION public.user_can_write_module(p_modulo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_user_role() IS DISTINCT FROM 'lector'
     AND public.user_has_module(p_modulo);
$$;
REVOKE ALL ON FUNCTION public.user_can_write_module(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_write_module(text) TO authenticated;

-- 2. Políticas de escritura
ALTER POLICY "LegalizacionGastos_insert" ON public."LegalizacionGastos"
  WITH CHECK (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "LegalizacionGastos_update" ON public."LegalizacionGastos"
  USING ((user_can_write_module('legalizacion_gastos'::text) AND ("Estado_Conciliacion" = 'Por conciliar'::text)))
  WITH CHECK ((user_can_write_module('legalizacion_gastos'::text) AND ("Estado_Conciliacion" = 'Por conciliar'::text)));

ALTER POLICY "LegalizacionGastos_delete" ON public."LegalizacionGastos"
  USING ((user_can_write_module('legalizacion_gastos'::text) AND ("Estado_Conciliacion" = 'Por conciliar'::text)));

ALTER POLICY "LegalizacionGastosItems_insert" ON public."LegalizacionGastosItems"
  WITH CHECK ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosItems_update" ON public."LegalizacionGastosItems"
  USING ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))))
  WITH CHECK ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosItems_delete" ON public."LegalizacionGastosItems"
  USING ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosEmpresas_insert" ON public."LegalizacionGastosEmpresas"
  WITH CHECK ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosEmpresas_update" ON public."LegalizacionGastosEmpresas"
  USING ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))))
  WITH CHECK ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosEmpresas_delete" ON public."LegalizacionGastosEmpresas"
  USING ((user_can_write_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LGConsecutivoNotas_insert" ON public."LegalizacionGastosConsecutivoNotas"
  WITH CHECK (user_can_write_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "LGConsecutivoNotas_update" ON public."LegalizacionGastosConsecutivoNotas"
  USING (user_can_write_module('legalizacion_gastos_aprobar'::text))
  WITH CHECK (user_can_write_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "LGConsecutivoNotas_delete" ON public."LegalizacionGastosConsecutivoNotas"
  USING (user_can_write_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "RemisionesExternas_insert" ON public."RemisionesExternas"
  WITH CHECK (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternas_update" ON public."RemisionesExternas"
  USING (user_can_write_module('legalizacion_gastos'::text))
  WITH CHECK (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternas_delete" ON public."RemisionesExternas"
  USING (((get_user_role() = 'admin'::text) OR (user_can_write_module('legalizacion_gastos'::text) AND (creado_por = auth.uid()) AND (creado_en > (now() - '00:05:00'::interval)) AND (NOT (EXISTS ( SELECT 1
   FROM "RemisionesExternasItems" i
  WHERE (i."Remision_Id" = "RemisionesExternas".id)))))));

ALTER POLICY "RemisionesExternasItems_insert" ON public."RemisionesExternasItems"
  WITH CHECK (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternasItems_update" ON public."RemisionesExternasItems"
  USING (user_can_write_module('legalizacion_gastos'::text))
  WITH CHECK (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternasItems_delete" ON public."RemisionesExternasItems"
  USING (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "Vehiculos_insert" ON public."Vehiculos"
  WITH CHECK (user_can_write_module('legalizacion_gastos'::text));

ALTER POLICY "Vehiculos_update" ON public."Vehiculos"
  USING (user_can_write_module('legalizacion_gastos_aprobar'::text))
  WITH CHECK (user_can_write_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "leg_adjuntos_insert" ON storage.objects
  WITH CHECK (((bucket_id = 'legalizacion-gastos-adjuntos'::text) AND user_can_write_module('legalizacion_gastos'::text)));

ALTER POLICY "leg_adjuntos_delete" ON storage.objects
  USING (((bucket_id = 'legalizacion-gastos-adjuntos'::text) AND user_can_write_module('legalizacion_gastos'::text)));

-- 3. RPC de conciliación
CREATE OR REPLACE FUNCTION public.conciliar_legalizacion_gastos(p_id bigint, p_aprobar boolean, p_saldo_favor numeric DEFAULT NULL::numeric, p_saldo_reembolsar numeric DEFAULT NULL::numeric, p_motivo_rechazo text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  IF NOT public.user_can_write_module('legalizacion_gastos_aprobar') THEN
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
$function$;

COMMIT;
