-- ============================================================
-- Cambios de Legalización de Gastos desde una fecha (pestaña Historial → «Cambios desde una fecha»)
--
-- Responde: «¿qué legalizaciones o envíos se crearon, cambiaron o eliminaron desde tal
-- momento?» — p. ej. para explicar por qué el Prorrateo de un mes cerrado ya no da lo
-- mismo que cuando se calculó. get_historial_legalizacion_gastos trabaja de a UN
-- consecutivo; esta recorre todas.
--
--   get_cambios_legalizacion_gastos(p_desde, p_hasta, p_fecha_desde, p_fecha_hasta) → jsonb
--   {
--     generado, desde, hasta, fecha_desde, fecha_hasta,
--     candidatas, omitidas_visibilidad, omitidas_tope,
--     registros: [ {
--       id, consecutivo, existe, truncado,
--       actual:  { tipo, fecha, responsable, placa, estado, creado_por, creado_en,
--                  modificado_por, modificado_en, conciliado_por,
--                  fecha_conciliacion, motivo_rechazo } | null   (null = eliminada)
--       eventos:    [ { audit_id, cuando, usuario, email, tabla, accion,
--                       registro_id, antes, despues } ]   (TODO el historial, más antiguo primero)
--       remisiones: [ { id, existe, remision, tipo, planta, eventos:[…] } ]
--     } ]
--   }
--
-- · p_desde / p_hasta: ventana de tiempo de los CAMBIOS (hasta = ahora si es NULL).
-- · p_fecha_desde / p_fecha_hasta: (opcionales) fecha de la LEGALIZACIÓN (la que usa el
--   Prorrateo para asignarla a un mes). Entra si hoy, o en algún momento según el
--   audit_log, tuvo una fecha dentro del rango (cubre las que se movieron de mes).
-- · Una legalización entra si tuvo eventos propios en la ventana (cabecera, líneas de
--   gasto o reparto) o si lleva (hoy) una remisión EXTERNA (MP-…, Chia Abago…) que
--   cambió en la ventana: cambiar la Planta de una remisión mueve el Prorrateo aunque
--   nadie vuelva a guardar la legalización.
-- · Por cada una se devuelve TODO su historial (no solo la ventana): el navegador
--   necesita lo anterior para nombrar líneas y empresas en un UPDATE; él recorta a la
--   ventana. De las remisiones externas, solo las que cambiaron en la ventana.
-- · Lo que el usuario no puede ver (legalizacion_gastos_visible, o la misma regla sobre
--   el reparto que dejó el audit_log si fue eliminada) se omite y se cuenta en
--   `omitidas_visibilidad` (no se aborta, a diferencia de la consulta por consecutivo).
-- · Tope total de 6000 eventos; lo que no cabe se cuenta en `omitidas_tope`.
--
-- Mismo permiso que el Historial: legalizacion_gastos_aprobar (user_has_module también
-- lo concede al admin). SECURITY DEFINER porque audit_log solo lo lee un admin.
-- Solo lee; no cambia datos. Reversión: DROP FUNCTION (ver el final).
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cambios_legalizacion_gastos(
  p_desde       timestamptz,
  p_hasta       timestamptz DEFAULT NULL,
  p_fecha_desde date        DEFAULT NULL,
  p_fecha_hasta date        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hasta     timestamptz;
  v_ids       bigint[];
  v_id        bigint;
  v_existe    boolean;
  v_visible   boolean;
  v_actual    jsonb;
  v_cons      text;
  v_eventos   jsonb;
  v_n_ev      int;
  v_trunc     boolean;
  v_rems      jsonb;
  v_n_rem     int;
  v_trunc_rem boolean;
  v_registros jsonb := '[]'::jsonb;
  v_total     int := 0;
  v_vistas    int := 0;
  v_omitidas  int := 0;
  v_tope      int := 0;
BEGIN
  IF NOT public.user_has_module('legalizacion_gastos_aprobar') THEN
    RAISE EXCEPTION 'Sin permiso para consultar el historial de legalizaciones';
  END IF;
  IF p_desde IS NULL THEN
    RAISE EXCEPTION 'Indica desde qué fecha y hora buscar los cambios';
  END IF;
  v_hasta := coalesce(p_hasta, now());
  IF v_hasta < p_desde THEN
    RAISE EXCEPTION 'El «hasta» es anterior al «desde»';
  END IF;

  -- ── 1. Legalizaciones candidatas ──
  WITH rowleg AS (   -- fila de gasto / reparto → legalización a la que ha pertenecido
    SELECT DISTINCT ON (x.t, x.rid) x.t, x.rid, x.leg
      FROM (
        SELECT 'LegalizacionGastosItems'::text AS t, l.id::text AS rid, l."Legalizacion_Id" AS leg
          FROM public."LegalizacionGastosItems" l
        UNION ALL
        SELECT 'LegalizacionGastosEmpresas', e.id::text, e."Legalizacion_Id"
          FROM public."LegalizacionGastosEmpresas" e
        UNION ALL
        SELECT a.tabla, a.registro_id,
               coalesce(a.datos_despues->>'Legalizacion_Id', a.datos_antes->>'Legalizacion_Id')::bigint
          FROM public.audit_log a
         WHERE a.tabla IN ('LegalizacionGastosItems', 'LegalizacionGastosEmpresas')
           AND coalesce(a.datos_despues->>'Legalizacion_Id', a.datos_antes->>'Legalizacion_Id') IS NOT NULL
      ) x
  ), evleg AS (      -- con eventos propios en la ventana
    SELECT DISTINCT CASE WHEN a.tabla = 'LegalizacionGastos' THEN a.registro_id::bigint ELSE r.leg END AS leg
      FROM public.audit_log a
      LEFT JOIN rowleg r ON r.t = a.tabla AND r.rid = a.registro_id
     WHERE a.tabla IN ('LegalizacionGastos', 'LegalizacionGastosItems', 'LegalizacionGastosEmpresas')
       AND a.created_at >= p_desde AND a.created_at <= v_hasta
  ), remitm AS (     -- línea de remisión externa → remisión
    SELECT i.id::text AS rid, i."Remision_Id"::text AS remid
      FROM public."RemisionesExternasItems" i
    UNION
    SELECT a.registro_id, coalesce(a.datos_despues->>'Remision_Id', a.datos_antes->>'Remision_Id')
      FROM public.audit_log a
     WHERE a.tabla = 'RemisionesExternasItems'
       AND coalesce(a.datos_despues->>'Remision_Id', a.datos_antes->>'Remision_Id') IS NOT NULL
  ), remchg AS (     -- códigos de remisiones externas que cambiaron en la ventana
    SELECT DISTINCT upper(btrim(r."Remision")) AS cod
      FROM public.audit_log a
      JOIN public."RemisionesExternas" r
        ON r.id::text = CASE WHEN a.tabla = 'RemisionesExternas' THEN a.registro_id
                             ELSE (SELECT m.remid FROM remitm m WHERE m.rid = a.registro_id LIMIT 1) END
     WHERE a.tabla IN ('RemisionesExternas', 'RemisionesExternasItems')
       AND a.created_at >= p_desde AND a.created_at <= v_hasta
  ), legrem AS (     -- legalizaciones que llevan hoy alguna de ellas
    SELECT g.id AS leg
      FROM public."LegalizacionGastos" g
     WHERE EXISTS (SELECT 1
                     FROM regexp_split_to_table(coalesce(g."Remisiones_Relacionadas", ''), ',') c
                    WHERE upper(btrim(c)) IN (SELECT cod FROM remchg))
  ), cand AS (
    SELECT leg FROM evleg WHERE leg IS NOT NULL
    UNION
    SELECT leg FROM legrem
  )
  SELECT array_agg(c.leg ORDER BY c.leg) INTO v_ids
    FROM cand c
   WHERE (p_fecha_desde IS NULL AND p_fecha_hasta IS NULL)
      OR EXISTS (SELECT 1 FROM public."LegalizacionGastos" g
                  WHERE g.id = c.leg
                    AND (p_fecha_desde IS NULL OR g."Fecha" >= p_fecha_desde)
                    AND (p_fecha_hasta IS NULL OR g."Fecha" <= p_fecha_hasta))
      OR EXISTS (SELECT 1
                   FROM public.audit_log a
                  CROSS JOIN LATERAL (VALUES (a.datos_antes->>'Fecha'), (a.datos_despues->>'Fecha')) f(v)
                  WHERE a.tabla = 'LegalizacionGastos' AND a.registro_id = c.leg::text
                    AND f.v IS NOT NULL
                    AND (p_fecha_desde IS NULL OR f.v::date >= p_fecha_desde)
                    AND (p_fecha_hasta IS NULL OR f.v::date <= p_fecha_hasta));

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('generado', now(), 'desde', p_desde, 'hasta', v_hasta,
                              'fecha_desde', p_fecha_desde, 'fecha_hasta', p_fecha_hasta,
                              'candidatas', 0, 'omitidas_visibilidad', 0, 'omitidas_tope', 0,
                              'registros', '[]'::jsonb);
  END IF;

  -- ── 2. Historial de cada una (mismas consultas que get_historial_legalizacion_gastos) ──
  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_total > 6000 THEN
      v_tope := v_tope + 1;
      CONTINUE;
    END IF;

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
      v_omitidas := v_omitidas + 1;
      CONTINUE;
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
             'motivo_rechazo',     g."Motivo_Rechazo") END,
           g."Consecutivo"
      INTO v_actual, v_cons
      FROM (SELECT v_id AS vid) q
      LEFT JOIN public."LegalizacionGastos" g ON g.id = q.vid;

    IF v_cons IS NULL THEN   -- eliminada: el último consecutivo que dejó el audit_log
      SELECT coalesce(a.datos_despues->>'Consecutivo', a.datos_antes->>'Consecutivo') INTO v_cons
        FROM public.audit_log a
       WHERE a.tabla = 'LegalizacionGastos' AND a.registro_id = v_id::text
         AND coalesce(a.datos_despues->>'Consecutivo', a.datos_antes->>'Consecutivo') IS NOT NULL
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
    END IF;

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
           (count(*) FILTER (WHERE ev.rn <= 3000))::int,
           count(*) > 3000
      INTO v_eventos, v_n_ev, v_trunc
      FROM ev
      LEFT JOIN public.usuarios u ON u.id = ev.usuario_id;

    -- Remisiones externas que la legalización lleva o llevó; solo las que cambiaron en la ventana.
    WITH cods AS (   -- códigos de «Remisiones relacionadas»: el valor de hoy y todos los anteriores
      SELECT DISTINCT upper(btrim(s.c)) AS cod
        FROM (
          SELECT regexp_split_to_table(coalesce(g."Remisiones_Relacionadas", ''), ',') AS c
            FROM public."LegalizacionGastos" g WHERE g.id = v_id
          UNION ALL
          SELECT regexp_split_to_table(coalesce(x.v, ''), ',')
            FROM public.audit_log a
            CROSS JOIN LATERAL (VALUES (a.datos_antes->>'Remisiones_Relacionadas'),
                                       (a.datos_despues->>'Remisiones_Relacionadas')) x(v)
           WHERE a.tabla = 'LegalizacionGastos' AND a.registro_id = v_id::text
        ) s
       WHERE btrim(s.c) <> ''
    ), rem AS (      -- remisiones externas que han llevado alguno de esos códigos
      SELECT r.id::text AS rid
        FROM public."RemisionesExternas" r
       WHERE upper(btrim(r."Remision")) IN (SELECT cod FROM cods)
      UNION
      SELECT a.registro_id
        FROM public.audit_log a
       WHERE a.tabla = 'RemisionesExternas'
         AND (upper(btrim(a.datos_despues->>'Remision')) IN (SELECT cod FROM cods)
              OR upper(btrim(a.datos_antes->>'Remision')) IN (SELECT cod FROM cods))
    ), itm AS (      -- líneas que han sido de esas remisiones: id de la línea → id de la remisión
      SELECT i.id::text AS rid, i."Remision_Id"::text AS remid
        FROM public."RemisionesExternasItems" i
       WHERE i."Remision_Id"::text IN (SELECT rid FROM rem)
      UNION
      SELECT a.registro_id, coalesce(a.datos_despues->>'Remision_Id', a.datos_antes->>'Remision_Id')
        FROM public.audit_log a
       WHERE a.tabla = 'RemisionesExternasItems'
         AND coalesce(a.datos_despues->>'Remision_Id', a.datos_antes->>'Remision_Id') IN (SELECT rid FROM rem)
    ), evr AS (
      SELECT a.id, a.created_at, a.usuario_id, a.usuario_email, a.tabla, a.accion,
             a.registro_id, a.datos_antes, a.datos_despues,
             CASE WHEN a.tabla = 'RemisionesExternas' THEN a.registro_id
                  ELSE (SELECT m.remid FROM itm m WHERE m.rid = a.registro_id LIMIT 1) END AS remid,
             row_number() OVER (ORDER BY a.created_at, a.id) AS rn
        FROM public.audit_log a
       WHERE (a.tabla = 'RemisionesExternas'      AND a.registro_id IN (SELECT rid FROM rem))
          OR (a.tabla = 'RemisionesExternasItems' AND a.registro_id IN (SELECT rid FROM itm))
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id',       q.remid::bigint,
             'existe',   (cur.id IS NOT NULL),
             'remision', coalesce(cur."Remision", q.cod_audit),
             'tipo',     cur."Tipo",
             'planta',   cur."Planta",
             'eventos',  q.eventos) ORDER BY q.primero, q.remid::bigint), '[]'::jsonb),
           coalesce(sum(jsonb_array_length(q.eventos)), 0)::int,
           (SELECT coalesce(max(e.rn), 0) > 3000 FROM evr e)
      INTO v_rems, v_n_rem, v_trunc_rem
      FROM (
        SELECT e.remid, min(e.created_at) AS primero,
               (SELECT coalesce(x.datos_despues->>'Remision', x.datos_antes->>'Remision')
                  FROM public.audit_log x
                 WHERE x.tabla = 'RemisionesExternas' AND x.registro_id = e.remid
                   AND coalesce(x.datos_despues->>'Remision', x.datos_antes->>'Remision') IS NOT NULL
                 ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS cod_audit,
               jsonb_agg(jsonb_build_object(
                 'audit_id',    e.id,
                 'cuando',      e.created_at,
                 'usuario',     coalesce(nullif(btrim(u.nombre), ''), e.usuario_email),
                 'email',       e.usuario_email,
                 'tabla',       e.tabla,
                 'accion',      e.accion,
                 'registro_id', e.registro_id,
                 'antes',       e.datos_antes,
                 'despues',     e.datos_despues) ORDER BY e.created_at, e.id) AS eventos
          FROM evr e
          LEFT JOIN public.usuarios u ON u.id = e.usuario_id
         WHERE e.remid IS NOT NULL AND e.rn <= 3000
         GROUP BY e.remid
        HAVING bool_or(e.created_at >= p_desde AND e.created_at <= v_hasta)
      ) q
      LEFT JOIN public."RemisionesExternas" cur ON cur.id::text = q.remid;

    v_total  := v_total + v_n_ev + v_n_rem;
    v_vistas := v_vistas + 1;
    v_registros := v_registros || jsonb_build_array(jsonb_build_object(
      'id',          v_id,
      'consecutivo', v_cons,
      'existe',      v_existe,
      'actual',      v_actual,
      'truncado',    v_trunc OR v_trunc_rem,
      'eventos',     v_eventos,
      'remisiones',  v_rems));
  END LOOP;

  RETURN jsonb_build_object('generado', now(), 'desde', p_desde, 'hasta', v_hasta,
                            'fecha_desde', p_fecha_desde, 'fecha_hasta', p_fecha_hasta,
                            'candidatas', array_length(v_ids, 1),
                            'omitidas_visibilidad', v_omitidas, 'omitidas_tope', v_tope,
                            'registros', v_registros);
END;
$$;

REVOKE ALL ON FUNCTION public.get_cambios_legalizacion_gastos(timestamptz, timestamptz, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cambios_legalizacion_gastos(timestamptz, timestamptz, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- REVERSIÓN (no hay datos que deshacer; solo se quita la función):
--   DROP FUNCTION IF EXISTS public.get_cambios_legalizacion_gastos(timestamptz, timestamptz, date, date);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
