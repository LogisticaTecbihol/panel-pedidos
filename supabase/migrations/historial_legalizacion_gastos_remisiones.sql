-- ============================================================
-- Historial de Legalización de Gastos: cambios de las remisiones externas relacionadas
--
-- Amplía get_historial_legalizacion_gastos (historial_legalizacion_gastos.sql,
-- aplicada como migración 20261028150506) con un arreglo `remisiones` por
-- registro: el historial completo, desde audit_log, de las remisiones EXTERNAS
-- (RemisionesExternas + RemisionesExternasItems: materia prima «MP-…», Chia Abago…)
-- que la legalización lleva o llevó en «Remisiones relacionadas».
--
-- Por qué: el reparto entre empresas de una legalización se calcula con la planta
-- y las líneas de esas remisiones. Cuando alguien corrige una remisión externa
-- (p. ej. cambia su Planta de CACHIPAY a MOSQUERA) y re-guarda la legalización,
-- la causa quedaba en el historial de la remisión y no en el de la legalización.
--
-- Cambios respecto a la versión aplicada:
--   · Cada registro trae además
--       remisiones: [ { id, existe, remision, tipo, planta,
--                       eventos: [ { audit_id, cuando, usuario, email, tabla,
--                                    accion, registro_id, antes, despues } ] } ]
--     (más antigua primero; mismos campos que `eventos` de la legalización).
--   · «Llevó»: se leen los códigos de la columna actual y de todos los valores
--     anteriores que dejó el audit_log (p. ej. MP-9770 antes de pasar a MP-9770-2).
--     Se cruzan con RemisionesExternas.Remision (sin distinguir mayúsculas) y,
--     para las eliminadas o renombradas, con los códigos que dejó el audit_log.
--   · Las líneas (RemisionesExternasItems) se buscan por el id de la fila, no por
--     Remision_Id, porque un UPDATE del audit_log solo guarda lo que cambió.
--   · Solo remisiones externas: las remisiones del sistema (IASO-RS-…, GREEN-RS-…)
--     viven en Pedidos/Ingresos/etc. y no entran aquí.
--   · Se incluyen todos los eventos de esas remisiones (también los anteriores a la
--     legalización, p. ej. su creación). Tope compartido de 3000 eventos de
--     remisiones por registro; `truncado` pasa a true si se pasa.
--   · Compatibilidad: el navegador que no conozca `remisiones` la ignora.
--
-- Mismo permiso y mismo filtro por empresa que la versión anterior; las remisiones
-- externas ya las puede leer quien tenga legalizacion_gastos o su aprobación.
-- Solo lee; no cambia datos.
--
-- Reversión: volver a aplicar la función de historial_legalizacion_gastos.sql
-- (CREATE OR REPLACE con la misma firma).
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
  v_rems      jsonb;
  v_trunc_rem boolean;
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

    -- Remisiones externas que la legalización lleva o llevó, con su historial.
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
           (SELECT coalesce(max(e.rn), 0) > 3000 FROM evr e)
      INTO v_rems, v_trunc_rem
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
      ) q
      LEFT JOIN public."RemisionesExternas" cur ON cur.id::text = q.remid;

    v_registros := v_registros || jsonb_build_array(jsonb_build_object(
      'id',         v_id,
      'existe',     v_existe,
      'actual',     v_actual,
      'truncado',   v_trunc OR v_trunc_rem,
      'eventos',    v_eventos,
      'remisiones', v_rems));
  END LOOP;

  RETURN jsonb_build_object('generado', now(), 'consecutivo', v_cons, 'registros', v_registros);
END;
$$;

REVOKE ALL ON FUNCTION public.get_historial_legalizacion_gastos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_historial_legalizacion_gastos(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
