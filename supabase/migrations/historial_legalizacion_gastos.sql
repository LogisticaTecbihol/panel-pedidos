-- ============================================================
-- Historial de una Legalización de Gastos (pestaña "Historial")
--
-- Pestaña "Historial" de legalizacion-gastos.html (y botón «Historial» del
-- detalle «Ver»): muestra, dado un consecutivo (LEG-00044, ENV-00012…), todo
-- lo que quedó registrado de esa legalización — quién la creó, qué cambió en
-- la cabecera, en las líneas de gasto y en el reparto entre empresas, y cuándo.
--
-- El rastro vive en public.audit_log (trigger fn_audit_log de las tablas
-- LegalizacionGastos / LegalizacionGastosItems / LegalizacionGastosEmpresas),
-- que solo lee un admin. Por eso esta función es SECURITY DEFINER y filtra por
-- permiso: solo quien concilia gastos (legalizacion_gastos_aprobar, que
-- user_has_module() también concede al admin).
--
-- Devuelve, sin interpretar, los eventos crudos del audit_log; armar el
-- «qué cambió» (diferencias, líneas regrabadas sin cambios, etc.) lo hace el
-- navegador (js/legalizacion-historial.js).
--
--   get_historial_legalizacion_gastos(p_consecutivo text) → jsonb
--   {
--     generado, consecutivo,
--     registros: [ {
--       id, existe, truncado,
--       actual:  { tipo, fecha, responsable, placa, estado, creado_por, creado_en,
--                  modificado_por, modificado_en, conciliado_por,
--                  fecha_conciliacion, motivo_rechazo } | null   (null = eliminada)
--       eventos: [ { audit_id, cuando, usuario, email, tabla, accion,
--                    registro_id, antes, despues } ]              (más antiguo primero)
--     } ]
--   }
--
-- · p_consecutivo admite «LEG-00044», «leg-44», «LEG44»… y lo normaliza a 5
--   dígitos. Un consecutivo que ya no existe (eliminada o renumerada) se
--   resuelve por el audit_log: se devuelve el registro que lo tuvo.
-- · Los eventos de líneas y reparto se buscan por el id de la fila (registro_id),
--   no por Legalizacion_Id, porque un UPDATE del audit_log solo guarda los
--   campos que cambiaron y puede no traerlo.
-- · Empresas: igual que el RLS de LegalizacionGastos — si la legalización existe
--   se usa legalizacion_gastos_visible(); si fue eliminada, se aplica la misma
--   regla sobre el reparto que quedó en el audit_log.
-- · Tope de 3000 eventos por registro (`truncado` = true si se pasó).
--
-- Solo lee; no cambia datos. Reversión: DROP FUNCTION (ver el final).
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_historial_legalizacion_gastos(p_consecutivo text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m         text[];
  v_cons      text;
  v_ids       bigint[];
  v_id        bigint;
  v_existe    boolean;
  v_visible   boolean;
  v_actual    jsonb;
  v_eventos   jsonb;
  v_trunc     boolean;
  v_registros jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.user_has_module('legalizacion_gastos_aprobar') THEN
    RAISE EXCEPTION 'Sin permiso para consultar el historial de legalizaciones';
  END IF;

  v_m := regexp_match(upper(btrim(coalesce(p_consecutivo, ''))), '^(LEG|ENV)-?([0-9]{1,5})$');
  IF v_m IS NULL THEN
    RAISE EXCEPTION 'Escribe un consecutivo como LEG-00044 o ENV-00012';
  END IF;
  v_cons := v_m[1] || '-' || lpad(v_m[2], 5, '0');

  -- Todos los registros que han llevado ese consecutivo: el que lo tiene hoy y
  -- los que lo tuvieron (eliminados, o renumerados a otra serie).
  SELECT array_agg(DISTINCT s.x ORDER BY s.x) INTO v_ids
    FROM (
      SELECT g.id AS x
        FROM public."LegalizacionGastos" g
       WHERE g."Consecutivo" = v_cons
      UNION
      SELECT a.registro_id::bigint
        FROM public.audit_log a
       WHERE a.tabla = 'LegalizacionGastos'
         AND (a.datos_despues->>'Consecutivo' = v_cons OR a.datos_antes->>'Consecutivo' = v_cons)
    ) s;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('generado', now(), 'consecutivo', v_cons, 'registros', '[]'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT EXISTS (SELECT 1 FROM public."LegalizacionGastos" g WHERE g.id = v_id) INTO v_existe;

    IF v_existe THEN
      v_visible := public.legalizacion_gastos_visible(v_id);
    ELSE
      -- Eliminada: la misma regla de empresas, sobre el reparto que dejó el audit_log.
      v_visible :=
        NOT EXISTS (
          SELECT 1 FROM public.audit_log a
           WHERE a.tabla = 'LegalizacionGastosEmpresas'
             AND coalesce(a.datos_despues->>'Legalizacion_Id', a.datos_antes->>'Legalizacion_Id') = v_id::text
             AND coalesce(a.datos_despues->>'Empresa', a.datos_antes->>'Empresa') NOT IN ('CHIA ABAGO', 'MATERIAS PRIMAS'))
        OR EXISTS (
          SELECT 1 FROM public.audit_log a
           WHERE a.tabla = 'LegalizacionGastosEmpresas'
             AND coalesce(a.datos_despues->>'Legalizacion_Id', a.datos_antes->>'Legalizacion_Id') = v_id::text
             AND coalesce(a.datos_despues->>'Empresa', a.datos_antes->>'Empresa') NOT IN ('CHIA ABAGO', 'MATERIAS PRIMAS')
             AND public.user_has_company(coalesce(a.datos_despues->>'Empresa', a.datos_antes->>'Empresa')));
    END IF;
    IF NOT v_visible THEN
      RAISE EXCEPTION 'Esa legalización es de empresas a las que no tienes acceso';
    END IF;

    SELECT CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object(
             'tipo',               g."Tipo",
             'fecha',              g."Fecha",
             'responsable',        g."Responsable",
             'placa',              g."Placa",
             'estado',             g."Estado_Conciliacion",
             'creado_por',         g.creado_por_nombre,
             'creado_en',          g.creado_en,
             'modificado_por',     g.modificado_por_nombre,
             'modificado_en',      g.modificado_en,
             'conciliado_por',     g."Conciliado_Por",
             'fecha_conciliacion', g."Fecha_Conciliacion",
             'motivo_rechazo',     g."Motivo_Rechazo") END
      INTO v_actual
      FROM (SELECT v_id AS vid) q
      LEFT JOIN public."LegalizacionGastos" g ON g.id = q.vid;

    WITH it AS (   -- filas de gasto que han sido de esta legalización
      SELECT l.id::text AS rid FROM public."LegalizacionGastosItems" l WHERE l."Legalizacion_Id" = v_id
      UNION
      SELECT a.registro_id FROM public.audit_log a
       WHERE a.tabla = 'LegalizacionGastosItems'
         AND coalesce(a.datos_despues->>'Legalizacion_Id', a.datos_antes->>'Legalizacion_Id') = v_id::text
    ), em AS (     -- filas de reparto que han sido de esta legalización
      SELECT e.id::text AS rid FROM public."LegalizacionGastosEmpresas" e WHERE e."Legalizacion_Id" = v_id
      UNION
      SELECT a.registro_id FROM public.audit_log a
       WHERE a.tabla = 'LegalizacionGastosEmpresas'
         AND coalesce(a.datos_despues->>'Legalizacion_Id', a.datos_antes->>'Legalizacion_Id') = v_id::text
    ), ev AS (
      SELECT a.id, a.created_at, a.usuario_id, a.usuario_email, a.tabla, a.accion,
             a.registro_id, a.datos_antes, a.datos_despues,
             row_number() OVER (ORDER BY a.created_at, a.id) AS rn
        FROM public.audit_log a
       WHERE (a.tabla = 'LegalizacionGastos' AND a.registro_id = v_id::text)
          OR (a.tabla = 'LegalizacionGastosItems'    AND a.registro_id IN (SELECT rid FROM it))
          OR (a.tabla = 'LegalizacionGastosEmpresas' AND a.registro_id IN (SELECT rid FROM em))
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'audit_id',    ev.id,
             'cuando',      ev.created_at,
             'usuario',     coalesce(nullif(btrim(u.nombre), ''), ev.usuario_email),
             'email',       ev.usuario_email,
             'tabla',       ev.tabla,
             'accion',      ev.accion,
             'registro_id', ev.registro_id,
             'antes',       ev.datos_antes,
             'despues',     ev.datos_despues) ORDER BY ev.created_at, ev.id) FILTER (WHERE ev.rn <= 3000), '[]'::jsonb),
           count(*) > 3000
      INTO v_eventos, v_trunc
      FROM ev
      LEFT JOIN public.usuarios u ON u.id = ev.usuario_id;

    v_registros := v_registros || jsonb_build_array(jsonb_build_object(
      'id',        v_id,
      'existe',    v_existe,
      'actual',    v_actual,
      'truncado',  v_trunc,
      'eventos',   v_eventos));
  END LOOP;

  RETURN jsonb_build_object('generado', now(), 'consecutivo', v_cons, 'registros', v_registros);
END;
$$;

REVOKE ALL ON FUNCTION public.get_historial_legalizacion_gastos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_historial_legalizacion_gastos(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- REVERSIÓN (no hay datos que deshacer; solo se quita la función):
--   DROP FUNCTION IF EXISTS public.get_historial_legalizacion_gastos(text);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
