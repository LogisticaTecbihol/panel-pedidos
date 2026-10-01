-- ============================================================
-- Auditoría para el rol 'contabilidad', limitada a los documentos de SUS empresas
--
-- Hasta ahora audit_log (y todo el panel Auditoría) era solo para 'admin':
-- mezcla las 5 empresas y su RLS es admin-only. Para abrirlo a contabilidad sin
-- tocar ese RLS, la lectura se hace por RPC SECURITY DEFINER que filtra en el
-- servidor; el navegador nunca recibe filas de otras empresas.
--
-- Regla de alcance ("cualquier extremo"):
--   Un movimiento del audit_log es visible para un usuario de contabilidad si
--   (a) su tabla es documental (ver audit_tablas_documentales) Y
--   (b) alguna de las empresas del documento es una de las asignadas al usuario
--       en usuario_empresas (se compara por sigla o nombre completo).
--   Empresas de cada documento: Pedidos.Nombre_Empresa; OrdenesCompra e Ingresos
--   Empresa_Origen + Empresa_Destino; Reenvases Empresa + Empresa_Destino;
--   EntregasPedido empresa_pedido + empresa_stock; el resto, Empresa.
--
--   · Un UPDATE solo guarda las columnas que cambiaron y casi nunca trae la
--     empresa; por eso la empresa del documento se toma de (1) su fila viva,
--     (2) si ya no existe, de su foto de creación/eliminación en el audit_log,
--     y (3) además del propio JSON del movimiento.
--   · Si no se puede determinar la empresa, el movimiento se OCULTA (a
--     diferencia de user_has_company(), que trata la empresa vacía como visible
--     para todos; aquí eso sería una fuga).
--   · NO se exponen: usuarios, ClientesUnicos, Legalización de gastos, CRM,
--     catálogos, apartados_*, remisiones externas (no son documentos de empresa).
--   · admin ve todo (mismo comportamiento de siempre).
--
-- Funciones:
--   audit_empresas_de_fila(tabla, jsonb)  → text[] de empresas de un documento
--   audit_ids_visibles()                  → ids de audit_log visibles al usuario
--   get_audit_log_empresa(p_limit)        → filas para la pestaña "Cambios"
--   get_historial_remision(p_remision)    → ahora admin + contabilidad (con alcance)
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

-- ── 1. Tablas documentales expuestas a contabilidad ──
CREATE OR REPLACE FUNCTION public.audit_tablas_documentales()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['Pedidos','EntregasPedido','Ingresos','OrdenesCompra','Devoluciones',
               'CambiosMercancia','SolicitudMuestras','Reenvases','KardexNC',
               'KardexAjustes','RemisionesAnuladas']::text[];
$$;

-- ── 2. Empresas que intervienen en un documento ──
CREATE OR REPLACE FUNCTION public.audit_empresas_de_fila(p_tabla text, p_datos jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_datos IS NULL THEN NULL
    WHEN p_tabla = 'Pedidos'
      THEN ARRAY[p_datos->>'Nombre_Empresa']
    WHEN p_tabla IN ('OrdenesCompra','Ingresos')
      THEN ARRAY[p_datos->>'Empresa_Origen', p_datos->>'Empresa_Destino']
    WHEN p_tabla = 'Reenvases'
      THEN ARRAY[p_datos->>'Empresa', p_datos->>'Empresa_Destino']
    WHEN p_tabla = 'EntregasPedido'
      THEN ARRAY[p_datos->>'empresa_pedido', p_datos->>'empresa_stock']
    WHEN p_tabla IN ('SolicitudMuestras','Devoluciones','CambiosMercancia',
                     'KardexNC','KardexAjustes','RemisionesAnuladas')
      THEN ARRAY[p_datos->>'Empresa']
    ELSE NULL
  END;
$$;

-- ── 3. Ids del audit_log que el usuario actual puede ver ──
CREATE OR REPLACE FUNCTION public.audit_ids_visibles()
RETURNS SETOF bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol text := public.get_user_role();
  v_mis text[];
BEGIN
  IF v_rol = 'admin' THEN
    RETURN QUERY SELECT a.id FROM public.audit_log a;
    RETURN;
  END IF;

  IF v_rol IS DISTINCT FROM 'contabilidad' THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Empresas del usuario, por sigla y por nombre completo (las tablas guardan el nombre).
  SELECT COALESCE(array_agg(DISTINCT n), '{}'::text[]) INTO v_mis
    FROM (
      SELECT e.sigla AS n
        FROM public.usuario_empresas ue JOIN public.empresas e ON e.sigla = ue.empresa_sigla
       WHERE ue.usuario_id = auth.uid()
      UNION
      SELECT e.nombre_completo
        FROM public.usuario_empresas ue JOIN public.empresas e ON e.sigla = ue.empresa_sigla
       WHERE ue.usuario_id = auth.uid()
    ) q;

  IF cardinality(v_mis) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH rec AS (
    -- Empresas de cada documento según su fila viva...
              SELECT 'Pedidos'::text AS tabla, r.id::text AS registro_id, public.audit_empresas_de_fila('Pedidos', to_jsonb(r)) AS emp FROM public."Pedidos" r
    UNION ALL SELECT 'EntregasPedido',    r.id::text, public.audit_empresas_de_fila('EntregasPedido',    to_jsonb(r)) FROM public."EntregasPedido" r
    UNION ALL SELECT 'Ingresos',          r.id::text, public.audit_empresas_de_fila('Ingresos',          to_jsonb(r)) FROM public."Ingresos" r
    UNION ALL SELECT 'OrdenesCompra',     r.id::text, public.audit_empresas_de_fila('OrdenesCompra',     to_jsonb(r)) FROM public."OrdenesCompra" r
    UNION ALL SELECT 'Devoluciones',      r.id::text, public.audit_empresas_de_fila('Devoluciones',      to_jsonb(r)) FROM public."Devoluciones" r
    UNION ALL SELECT 'CambiosMercancia',  r.id::text, public.audit_empresas_de_fila('CambiosMercancia',  to_jsonb(r)) FROM public."CambiosMercancia" r
    UNION ALL SELECT 'SolicitudMuestras', r.id::text, public.audit_empresas_de_fila('SolicitudMuestras', to_jsonb(r)) FROM public."SolicitudMuestras" r
    UNION ALL SELECT 'Reenvases',         r.id::text, public.audit_empresas_de_fila('Reenvases',         to_jsonb(r)) FROM public."Reenvases" r
    UNION ALL SELECT 'KardexNC',          r.id::text, public.audit_empresas_de_fila('KardexNC',          to_jsonb(r)) FROM public."KardexNC" r
    UNION ALL SELECT 'KardexAjustes',     r.id::text, public.audit_empresas_de_fila('KardexAjustes',     to_jsonb(r)) FROM public."KardexAjustes" r
    UNION ALL SELECT 'RemisionesAnuladas',r.id::text, public.audit_empresas_de_fila('RemisionesAnuladas',to_jsonb(r)) FROM public."RemisionesAnuladas" r
    -- ...y, para los que ya no existen, según su foto de creación/eliminación.
    UNION ALL
    SELECT s.tabla, s.registro_id, public.audit_empresas_de_fila(s.tabla, COALESCE(s.datos_despues, s.datos_antes))
      FROM (
        SELECT DISTINCT ON (a.tabla, a.registro_id) a.tabla, a.registro_id, a.datos_antes, a.datos_despues
          FROM public.audit_log a
         WHERE a.accion IN ('INSERT','DELETE')
           AND a.tabla = ANY (public.audit_tablas_documentales())
         ORDER BY a.tabla, a.registro_id, a.created_at DESC
      ) s
  ), rec2 AS (
    SELECT r.tabla, r.registro_id, array_agg(DISTINCT x) AS emp
      FROM rec r, LATERAL unnest(r.emp) AS x
     GROUP BY r.tabla, r.registro_id
  )
  SELECT a.id
    FROM public.audit_log a
    LEFT JOIN rec2 ON rec2.tabla = a.tabla AND rec2.registro_id = a.registro_id
   WHERE a.tabla = ANY (public.audit_tablas_documentales())
     AND (COALESCE(rec2.emp, '{}'::text[])
          || COALESCE(public.audit_empresas_de_fila(a.tabla, a.datos_antes),   '{}'::text[])
          || COALESCE(public.audit_empresas_de_fila(a.tabla, a.datos_despues), '{}'::text[])
         ) && v_mis;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_ids_visibles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_ids_visibles() TO authenticated;

-- ── 4. Pestaña "Cambios": mismas columnas que audit_log (sin ip_address) ──
CREATE OR REPLACE FUNCTION public.get_audit_log_empresa(p_limit integer DEFAULT 5000)
RETURNS TABLE(
  id            bigint,
  tabla         text,
  accion        text,
  registro_id   text,
  usuario_id    uuid,
  usuario_email text,
  datos_antes   jsonb,
  datos_despues jsonb,
  created_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.tabla, a.accion, a.registro_id, a.usuario_id, a.usuario_email,
         a.datos_antes, a.datos_despues, a.created_at
    FROM public.audit_ids_visibles() v(vid)
    JOIN public.audit_log a ON a.id = v.vid
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
$$;

REVOKE ALL ON FUNCTION public.get_audit_log_empresa(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_log_empresa(integer) TO authenticated;

-- ── 5. Historial de remisión: ahora admin + contabilidad (con alcance) ──
-- Misma función de historial_remision_auditoria.sql; cambia la guarda y que
-- solo se consideran los movimientos visibles al usuario (audit_ids_visibles).
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
  IF COALESCE(public.get_user_role(), '') NOT IN ('admin', 'contabilidad') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF length(v_txt) < 3 THEN
    RAISE EXCEPTION 'Escriba al menos 3 caracteres de la remisión';
  END IF;

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
      JOIN public.audit_ids_visibles() v(vid) ON v.vid = a.id
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
