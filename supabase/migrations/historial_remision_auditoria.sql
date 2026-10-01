-- ============================================================
-- Historial de remisión (panel Auditoría → pestaña "Historial de remisión")
--
-- get_historial_remision(p_remision): dado un número de remisión, devuelve del
-- audit_log quién la tocó, cuándo, en qué módulo y qué cambió.
--
--   · Una remisión no es una tabla propia: es un campo dentro de Pedidos
--     (Remisiones = "num|cant|fecha,num|cant|fecha"), EntregasPedido, Ingresos,
--     OrdenesCompra, Devoluciones, CambiosMercancia, Reenvases, KardexNC,
--     SolicitudMuestras, RemisionesAnuladas, apartados_*, etc. Se buscan TODAS
--     las columnas cuyo nombre contenga "remision" (salvo Remision_Id, que es
--     una llave interna y no un número).
--   · fn_audit_log guarda en los UPDATE solo las columnas que cambiaron. Un
--     cambio de Cantidad en una devolución NO trae la remisión en el JSON. Por
--     eso, además de las filas que mencionan el número ("menciona" = true), se
--     devuelve el resto del historial de los mismos registros (tabla +
--     registro_id) con "menciona" = false: así no se pierde quién editó otra
--     parte del mismo documento.
--   · El número se compara con límites (no se confunde 0044 con 00441) y sin
--     distinguir mayúsculas. Mínimo 3 caracteres.
--   · SECURITY DEFINER + guarda de admin: audit_log solo lo lee un admin por RLS
--     (mismo criterio de get_audit_history, fix_get_audit_history_guard.sql).
--     Se usa IS DISTINCT FROM para que un rol NULL tampoco pase la guarda.
--   · Devuelve como máximo c_max filas (las más recientes); "total" trae el
--     conteo completo y "truncado" avisa si se recortó.
--
-- Devuelve: { remision, total, truncado, filas: [ { id, created_at, tabla, accion,
--   registro_id, usuario_email, usuario_nombre, menciona, datos_antes, datos_despues } ] }
-- (filas de la más reciente a la más antigua)
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_historial_remision(p_remision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max   constant int := 1500;
  v_txt   text := btrim(coalesce(p_remision, ''));
  v_re    text;
  v_total int;
  v_filas jsonb;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF length(v_txt) < 3 THEN
    RAISE EXCEPTION 'Escriba al menos 3 caracteres de la remisión';
  END IF;

  -- Número escapado y rodeado de límites: no debe estar pegado a otro
  -- carácter alfanumérico (0044 no coincide con 00441 ni con A0044).
  v_re := '(^|[^A-Za-z0-9])'
          || regexp_replace(v_txt, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g')
          || '([^A-Za-z0-9]|$)';

  WITH m AS (
    SELECT a.id, a.tabla, a.registro_id,
           (EXISTS (SELECT 1
                      FROM jsonb_each_text(COALESCE(a.datos_antes, '{}'::jsonb)) e
                     WHERE e.key ILIKE '%remision%' AND e.key <> 'Remision_Id'
                       AND e.value ~* v_re)
            OR EXISTS (SELECT 1
                         FROM jsonb_each_text(COALESCE(a.datos_despues, '{}'::jsonb)) e
                        WHERE e.key ILIKE '%remision%' AND e.key <> 'Remision_Id'
                          AND e.value ~* v_re)) AS menciona
      FROM public.audit_log a
  ), rel AS (
    SELECT DISTINCT tabla, registro_id FROM m WHERE menciona
  ), sel AS (
    SELECT a.id, a.created_at, a.tabla, a.accion, a.registro_id,
           a.usuario_email, u.nombre AS usuario_nombre, m.menciona,
           a.datos_antes, a.datos_despues
      FROM public.audit_log a
      JOIN m   ON m.id = a.id
      JOIN rel ON rel.tabla = a.tabla
              AND rel.registro_id IS NOT DISTINCT FROM a.registro_id
      LEFT JOIN public.usuarios u ON u.id = a.usuario_id
  ), top AS (
    SELECT s.*, count(*) OVER () AS tot
      FROM sel s
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT c_max
  )
  SELECT COALESCE(max(tot), 0)::int,
         COALESCE(jsonb_agg(jsonb_build_object(
           'id',             top.id,
           'created_at',     top.created_at,
           'tabla',          top.tabla,
           'accion',         top.accion,
           'registro_id',    top.registro_id,
           'usuario_email',  top.usuario_email,
           'usuario_nombre', top.usuario_nombre,
           'menciona',       top.menciona,
           'datos_antes',    top.datos_antes,
           'datos_despues',  top.datos_despues
         ) ORDER BY top.created_at DESC, top.id DESC), '[]'::jsonb)
    INTO v_total, v_filas
    FROM top;

  RETURN jsonb_build_object(
    'remision', v_txt,
    'total',    v_total,
    'truncado', v_total > c_max,
    'filas',    v_filas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_historial_remision(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_historial_remision(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
