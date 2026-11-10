-- ═══════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de legalizacion_gastos_lector_solo_lectura.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Devuelve las 22 políticas de escritura y la RPC conciliar_legalizacion_gastos a su
-- definición anterior (leída de la base viva) y borra public.user_can_write_module.
-- Después de revertir, el lector solo queda bloqueado por la pantalla, no por la BD.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Políticas de escritura (definición anterior)
ALTER POLICY "LegalizacionGastos_insert" ON public."LegalizacionGastos"
  WITH CHECK (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "LegalizacionGastos_update" ON public."LegalizacionGastos"
  USING ((user_has_module('legalizacion_gastos'::text) AND ("Estado_Conciliacion" = 'Por conciliar'::text)))
  WITH CHECK ((user_has_module('legalizacion_gastos'::text) AND ("Estado_Conciliacion" = 'Por conciliar'::text)));

ALTER POLICY "LegalizacionGastos_delete" ON public."LegalizacionGastos"
  USING ((user_has_module('legalizacion_gastos'::text) AND ("Estado_Conciliacion" = 'Por conciliar'::text)));

ALTER POLICY "LegalizacionGastosItems_insert" ON public."LegalizacionGastosItems"
  WITH CHECK ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosItems_update" ON public."LegalizacionGastosItems"
  USING ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))))
  WITH CHECK ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosItems_delete" ON public."LegalizacionGastosItems"
  USING ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosItems"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosEmpresas_insert" ON public."LegalizacionGastosEmpresas"
  WITH CHECK ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosEmpresas_update" ON public."LegalizacionGastosEmpresas"
  USING ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))))
  WITH CHECK ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LegalizacionGastosEmpresas_delete" ON public."LegalizacionGastosEmpresas"
  USING ((user_has_module('legalizacion_gastos'::text) AND (EXISTS ( SELECT 1
   FROM "LegalizacionGastos" lg
  WHERE ((lg.id = "LegalizacionGastosEmpresas"."Legalizacion_Id") AND (lg."Estado_Conciliacion" = 'Por conciliar'::text))))));

ALTER POLICY "LGConsecutivoNotas_insert" ON public."LegalizacionGastosConsecutivoNotas"
  WITH CHECK (user_has_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "LGConsecutivoNotas_update" ON public."LegalizacionGastosConsecutivoNotas"
  USING (user_has_module('legalizacion_gastos_aprobar'::text))
  WITH CHECK (user_has_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "LGConsecutivoNotas_delete" ON public."LegalizacionGastosConsecutivoNotas"
  USING (user_has_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "RemisionesExternas_insert" ON public."RemisionesExternas"
  WITH CHECK (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternas_update" ON public."RemisionesExternas"
  USING (user_has_module('legalizacion_gastos'::text))
  WITH CHECK (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternas_delete" ON public."RemisionesExternas"
  USING (((get_user_role() = 'admin'::text) OR (user_has_module('legalizacion_gastos'::text) AND (creado_por = auth.uid()) AND (creado_en > (now() - '00:05:00'::interval)) AND (NOT (EXISTS ( SELECT 1
   FROM "RemisionesExternasItems" i
  WHERE (i."Remision_Id" = "RemisionesExternas".id)))))));

ALTER POLICY "RemisionesExternasItems_insert" ON public."RemisionesExternasItems"
  WITH CHECK (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternasItems_update" ON public."RemisionesExternasItems"
  USING (user_has_module('legalizacion_gastos'::text))
  WITH CHECK (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "RemisionesExternasItems_delete" ON public."RemisionesExternasItems"
  USING (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "Vehiculos_insert" ON public."Vehiculos"
  WITH CHECK (user_has_module('legalizacion_gastos'::text));

ALTER POLICY "Vehiculos_update" ON public."Vehiculos"
  USING (user_has_module('legalizacion_gastos_aprobar'::text))
  WITH CHECK (user_has_module('legalizacion_gastos_aprobar'::text));

ALTER POLICY "leg_adjuntos_insert" ON storage.objects
  WITH CHECK (((bucket_id = 'legalizacion-gastos-adjuntos'::text) AND user_has_module('legalizacion_gastos'::text)));

ALTER POLICY "leg_adjuntos_delete" ON storage.objects
  USING (((bucket_id = 'legalizacion-gastos-adjuntos'::text) AND user_has_module('legalizacion_gastos'::text)));

-- 2. RPC de conciliación (definición anterior)
CREATE OR REPLACE FUNCTION public.conciliar_legalizacion_gastos(p_id bigint, p_aprobar boolean, p_saldo_favor numeric DEFAULT NULL::numeric, p_saldo_reembolsar numeric DEFAULT NULL::numeric, p_motivo_rechazo text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- 3. Función auxiliar (ya nadie la usa)
DROP FUNCTION IF EXISTS public.user_can_write_module(text);

COMMIT;
