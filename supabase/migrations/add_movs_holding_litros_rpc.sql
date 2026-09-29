-- ============================================================
-- Balance de litros para usuarios con menos empresas que el holding
--
-- Problema: la pestaña "Balance de litros" (reportes.html) calcula los KPI de
-- arriba y la sección "Consolidado del holding" con el flujo de movimientos
-- del Kardex (existSnapshot.kxMovimientos), que se arma en el navegador con
-- filas ya filtradas por el RLS de empresa. Un usuario con menos empresas
-- (p. ej. solo PARCELAR) suma solo lo que su RLS deja pasar y ve totales
-- incompletos (Ingresos 19.086 L en vez de 30.224 L, etc.).
--
-- Solución:
--   1. _kx_movs(): el stream unificado de movimientos del Kardex (la lógica
--      SQL que ya usaba get_saldos_holding, extraída para reutilizarla, ahora
--      con la presentación). Interna: nadie la llama directo.
--   2. get_saldos_holding(): igual que antes, pero sobre _kx_movs().
--   3. get_movs_holding_otras(): devuelve los movimientos de las empresas que
--      el usuario NO ve, FUSIONADOS entre sí (sin nombre de empresa, sin
--      remisión) y agregados por (producto, presentación, módulo, tipo, día).
--      El cliente los suma a su propio stream (las empresas que sí ve) para
--      completar el consolidado del holding.
--
-- ⚠ ESPEJO de js/existencias.js (buildKxMovimientos), que replica
-- js/kardex.js:buildMovimientos. Si cambia una regla del Kardex, cambiarla
-- también en _kx_movs().
-- ============================================================


-- ── 1. Stream unificado de movimientos (ya con la regla "sin remisión solo
--       Saldo Inicial" y sin remisiones anuladas). Sin filtro de fecha de corte. ──
CREATE OR REPLACE FUNCTION public._kx_movs(p_nc_retorno_desde text DEFAULT '2026-09-01')
RETURNS TABLE (
  empresa      text,
  producto     text,
  presentacion text,
  signo        integer,
  cantidad     numeric,
  fecha        text,
  modulo       text,
  remision     text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH
  -- Remisiones anuladas: sus movimientos no cuentan
  anuladas AS (
    SELECT DISTINCT _kx_trim("Remision") AS rem
    FROM "RemisionesAnuladas"
    WHERE _kx_trim("Remision") <> ''
  ),

  -- Cambios: ¿el grupo (empresa, consecutivo) tiene líneas ENTREGAR?
  cambios_te AS (
    SELECT coalesce("Empresa", '') || '||' || coalesce(nullif("Consecutivo", ''), id::text) AS gk,
           bool_or("Tipo_Linea" = 'ENTREGAR') AS te
    FROM "CambiosMercancia"
    GROUP BY 1
  ),

  -- Pedidos con entregas: SALIDA por cada entrega de Remisiones
  ped AS (
    SELECT p.*
    FROM "Pedidos" p
    WHERE p."Historico" IS DISTINCT FROM true
      AND coalesce(p."Cant_Entregada", 0) > 0
      AND _kx_trim(p."Estado_2") <> 'Anulado'
      AND p."Nombre_Empresa" IS DISTINCT FROM 'Nombre_Empresa'
      AND _kx_trim(p."Remisiones") <> ''
  ),

  ing AS (
    SELECT i.*,
           lower(coalesce(i."Origen", '')) AS origen_lc
    FROM "Ingresos" i
    WHERE i."Historico" IS DISTINCT FROM true
      AND coalesce(i."Cantidad", 0) > 0
  ),

  dev AS (
    SELECT d.*,
           coalesce(CASE WHEN d."Cant_Entregada" IS NOT NULL THEN d."Cant_Entregada" ELSE d."Cantidad" END, 0) AS cant
    FROM "Devoluciones" d
    WHERE d."Historico" IS DISTINCT FROM true
      AND lower(coalesce(d."Estado", '')) NOT IN ('anulado', 'pendiente')
  ),

  camb AS (
    SELECT c.*, t.te
    FROM "CambiosMercancia" c
    JOIN cambios_te t
      ON t.gk = coalesce(c."Empresa", '') || '||' || coalesce(nullif(c."Consecutivo", ''), c.id::text)
    WHERE c."Historico" IS DISTINCT FROM true
      AND coalesce(c."Cantidad", 0) > 0
      AND lower(coalesce(c."Estado", '')) IN ('cerrado', 'cerrada', 'parcial')
  ),

  reen AS (
    SELECT r.*
    FROM "Reenvases" r
    WHERE r."Historico" IS DISTINCT FROM true
      AND coalesce(nullif(r."Bodega", ''), 'Productos Buenos') IN ('Productos Buenos', 'Producto Terminado')
      AND coalesce(r."Cantidad", 0) > 0
      AND _kx_trim(r."Remision") <> ''
  ),

  nc AS (
    SELECT n.*
    FROM "KardexNC" n
    WHERE n."Historico" IS DISTINCT FROM true
      AND coalesce(n."Cantidad", 0) > 0
  ),

  -- Stream unificado (empresa, producto, presentacion, signo, cantidad, fecha, modulo, remision)
  movs AS (
    -- Pedidos con remisiones estructuradas "REM|cant|fecha,REM|cant|fecha"
    SELECT coalesce(p."Nombre_Empresa", '') AS empresa,
           _kx_norm_prod(p."Producto") AS producto,
           coalesce(p."Presentacion", '') AS presentacion,
           -1 AS signo,
           _kx_num(split_part(s.seg, '|', 2)) AS cantidad,
           coalesce(nullif(split_part(s.seg, '|', 3), ''), nullif(p."Fecha_Ult_Entrega", ''), nullif(p."Fecha_Pedido", ''), '') AS fecha,
           'Pedidos' AS modulo,
           _kx_trim(split_part(s.seg, '|', 1)) AS remision
    FROM ped p
    CROSS JOIN LATERAL (
      SELECT _kx_trim(x) AS seg
      FROM regexp_split_to_table(_kx_trim(p."Remisiones"), ',') AS x
    ) s
    WHERE position('|' in _kx_trim(p."Remisiones")) > 0
      AND s.seg <> ''
      AND _kx_trim(split_part(s.seg, '|', 1)) <> ''
      AND _kx_num(split_part(s.seg, '|', 2)) > 0

    UNION ALL
    -- Pedidos con remisión simple (sin "|"): una sola salida por Cant_Entregada
    SELECT coalesce(p."Nombre_Empresa", ''), _kx_norm_prod(p."Producto"), coalesce(p."Presentacion", ''), -1,
           p."Cant_Entregada",
           coalesce(nullif(p."Fecha_Ult_Entrega", ''), nullif(p."Fecha_Pedido", ''), ''),
           'Pedidos', _kx_trim(p."Remisiones")
    FROM ped p
    WHERE position('|' in _kx_trim(p."Remisiones")) = 0

    UNION ALL
    -- Ingresos: ENTRADA en destino
    SELECT i."Empresa_Destino", _kx_norm_prod(i."Producto"), coalesce(i."Presentacion", ''), 1, i."Cantidad",
           coalesce(i."Fecha", ''), 'Ingresos', coalesce(i."Remision_Destino", '')
    FROM ing i
    WHERE coalesce(i."Empresa_Destino", '') <> ''

    UNION ALL
    -- Ingresos: SALIDA en origen (salvo Cachipay/proveedor, planta propia o misma empresa)
    SELECT i."Empresa_Origen", _kx_norm_prod(i."Producto"), coalesce(i."Presentacion", ''), -1, i."Cantidad",
           coalesce(i."Fecha", ''), 'Ingresos', coalesce(i."Remision_Origen", '')
    FROM ing i
    WHERE coalesce(i."Empresa_Origen", '') <> ''
      AND NOT (
        position('cachipay' in i.origen_lc) > 0
        OR position('proveedor' in i.origen_lc) > 0
        OR (
          _kx_trim(i."Empresa_Origen") IN ('GREEN AGROSOLUCIONES DE COLOMBIA SAS', 'GREEN', 'PARCELAR DE COLOMBIA SAS', 'PARCELAR')
          AND coalesce(i."Origen", '') ~* 'planta'
        )
      )
      AND i."Empresa_Origen" IS DISTINCT FROM i."Empresa_Destino"

    UNION ALL
    -- Devoluciones: ENTRADA (excluye bodega Producto No Conforme)
    SELECT coalesce(d."Empresa", ''), _kx_norm_prod(d."Producto"), coalesce(d."Presentacion", ''), 1, d.cant,
           coalesce(nullif(d."Fecha_Devolucion", ''), nullif(d."Fecha", ''), ''),
           'Devoluciones',
           coalesce(nullif(d."Remision", ''), nullif(d."Remision_Ingreso", ''), '')
    FROM dev d
    WHERE d.cant > 0
      AND _kx_trim(d."Bodega_Ingreso") <> 'Producto No Conforme'

    UNION ALL
    -- Devoluciones: SALIDA desde Productos Buenos (cuando hay remisión de salida)
    SELECT coalesce(d."Empresa", ''), _kx_norm_prod(d."Producto"), coalesce(d."Presentacion", ''), -1, d.cant,
           coalesce(nullif(d."Fecha_Salida", ''), nullif(d."Fecha_Devolucion", ''), nullif(d."Fecha", ''), ''),
           'Devoluciones', _kx_trim(d."Remision_Salida")
    FROM dev d
    WHERE d.cant > 0
      AND _kx_trim(d."Remision_Salida") <> ''
      AND _kx_trim(d."Bodega_Salida") IN ('Productos Buenos', 'Producto Terminado')

    UNION ALL
    -- Cambios: ENTRADA (línea CAMBIAR a bodega buena). CambiosMercancia no tiene
    -- columna Presentacion: queda vacía, igual que en el JS.
    SELECT coalesce(c."Empresa", ''), _kx_norm_prod(c."Producto"), '', 1, c."Cantidad",
           coalesce(nullif(c."Fecha_Ingreso", ''), nullif(c."Fecha_Solicitud", ''), ''),
           'Cambios', _kx_trim(c."Remision_Ingreso")
    FROM camb c
    WHERE c."Tipo_Linea" = 'CAMBIAR'
      AND _kx_trim(coalesce(nullif(c."Bodega_Ingreso", ''), 'Productos Buenos')) IN ('Productos Buenos', 'Producto Terminado')
      AND _kx_trim(c."Remision_Ingreso") <> ''

    UNION ALL
    -- Cambios: SALIDA (ENTREGAR; o CAMBIAR si el grupo no tiene ENTREGAR)
    SELECT coalesce(c."Empresa", ''), _kx_norm_prod(c."Producto"), '', -1, c."Cantidad",
           coalesce(nullif(c."Fecha_Salida", ''), nullif(c."Fecha_Solicitud", ''), ''),
           'Cambios', _kx_trim(c."Remision_Salida")
    FROM camb c
    WHERE ((c.te AND c."Tipo_Linea" = 'ENTREGAR') OR (NOT c.te AND c."Tipo_Linea" = 'CAMBIAR'))
      AND _kx_trim(coalesce(nullif(c."Bodega_Salida", ''), 'Productos Buenos')) IN ('Productos Buenos', 'Producto Terminado')
      AND _kx_trim(c."Remision_Salida") <> ''

    UNION ALL
    -- Órdenes de compra: ENTRADA en destino (requiere remisión)
    SELECT oc."Empresa_Destino", _kx_norm_prod(oc."Producto"), coalesce(oc."Presentacion", ''), 1, oc."Cantidad",
           coalesce(oc."Fecha", ''), 'Órdenes de Compra', _kx_trim(oc."Remision")
    FROM "OrdenesCompra" oc
    WHERE coalesce(oc."Cantidad", 0) > 0
      AND _kx_trim(oc."Remision") <> ''
      AND coalesce(oc."Empresa_Destino", '') <> ''

    UNION ALL
    -- Órdenes de compra: SALIDA en origen
    SELECT oc."Empresa_Origen", _kx_norm_prod(oc."Producto"), coalesce(oc."Presentacion", ''), -1, oc."Cantidad",
           coalesce(oc."Fecha", ''), 'Órdenes de Compra', _kx_trim(oc."Remision")
    FROM "OrdenesCompra" oc
    WHERE coalesce(oc."Cantidad", 0) > 0
      AND _kx_trim(oc."Remision") <> ''
      AND coalesce(oc."Empresa_Origen", '') <> ''
      AND oc."Empresa_Origen" IS DISTINCT FROM oc."Empresa_Destino"

    UNION ALL
    -- Muestras: SALIDA (las órdenes de producción de muestras no despachan)
    SELECT coalesce(m."Empresa", ''), _kx_norm_prod(m."Producto"), coalesce(m."Presentacion", ''), -1, m."Cant_Entregada",
           coalesce(nullif(m."Fecha_Despacho", ''), nullif(m."Fecha_Entrega", ''), nullif(m."Fecha_Solicitud", ''), ''),
           'Muestras', _kx_trim(m."Remision")
    FROM "SolicitudMuestras" m
    WHERE m."Historico" IS DISTINCT FROM true
      AND coalesce(nullif(m."Tipo_Solicitud", ''), 'Despacho') <> 'Produccion'
      AND coalesce(m."Cant_Entregada", 0) > 0
      AND _kx_trim(m."Remision") <> ''

    UNION ALL
    -- Reenvases: SALIDA (producción o traslado)
    SELECT coalesce(r."Empresa", ''), _kx_norm_prod(r."Producto"), coalesce(r."Presentacion", ''), -1, r."Cantidad",
           coalesce(r."Fecha", ''),
           CASE WHEN coalesce(r."Empresa_Destino", '') <> '' THEN 'Traslado' ELSE 'Producción' END,
           _kx_trim(r."Remision")
    FROM reen r

    UNION ALL
    -- Reenvases: ENTRADA en la empresa destino (traslado)
    SELECT r."Empresa_Destino", _kx_norm_prod(r."Producto"), coalesce(r."Presentacion", ''), 1, r."Cantidad",
           coalesce(r."Fecha", ''), 'Traslado',
           coalesce(nullif(_kx_trim(r."Remision_Destino"), ''), _kx_trim(r."Remision"))
    FROM reen r
    WHERE coalesce(r."Empresa_Destino", '') <> ''

    UNION ALL
    -- Ingresos a Bodega NC: SALIDA de buenos (excepto devoluciones de cliente / retornos / traslado NC)
    SELECT coalesce(n."Empresa", ''), _kx_norm_prod(n."Producto"), coalesce(n."Presentacion", ''), -1, n."Cantidad",
           coalesce(n."Fecha", ''), 'Bodega NC', coalesce(n."Remision", '')
    FROM nc n
    WHERE n."Tipo" = 'Ingreso_NC'
      AND coalesce(n."Motivo", '') NOT IN ('Devolucion_cliente', 'Retorno_conforme', 'Traslado_NC')

    UNION ALL
    -- Salidas de Bodega NC que retornan a Productos Buenos: ENTRADA (desde p_nc_retorno_desde)
    SELECT coalesce(n."Empresa", ''), _kx_norm_prod(n."Producto"), coalesce(n."Presentacion", ''), 1, n."Cantidad",
           coalesce(n."Fecha", ''), 'Bodega NC', coalesce(n."Remision", '')
    FROM nc n
    WHERE n."Tipo" = 'Salida_NC'
      AND regexp_replace(_kx_unaccent(lower(_kx_trim(n."Motivo"))), '[^a-z0-9]', '', 'g')
          IN ('reacondicionamiento', 'retornoconforme', 'retornoabodegaconforme')
      AND NOT (coalesce(p_nc_retorno_desde, '') <> '' AND (coalesce(n."Fecha", '') COLLATE "C") < (p_nc_retorno_desde COLLATE "C"))

    UNION ALL
    -- Saldos iniciales y ajustes manuales (sin remisión solo se admite Saldo Inicial)
    SELECT coalesce(a."Empresa", ''), _kx_norm_prod(a."Producto"), coalesce(a."Presentacion", ''),
           CASE WHEN a."Tipo" = 'Ajuste_Faltante' THEN -1 ELSE 1 END,
           a."Cantidad", coalesce(a."Fecha", ''),
           CASE WHEN a."Tipo" = 'Saldo_Inicial' THEN 'Saldo Inicial' ELSE 'Ajuste' END,
           ''
    FROM "KardexAjustes" a
    WHERE coalesce(a."Cantidad", 0) > 0
      AND a."Tipo" IN ('Saldo_Inicial', 'Ajuste_Sobrante', 'Ajuste_Faltante')
  )

  -- Regla global: sin remisión solo Saldo Inicial; fuera remisiones anuladas
  SELECT m.empresa, m.producto, m.presentacion, m.signo, m.cantidad, m.fecha, m.modulo, m.remision
  FROM movs m
  WHERE (m.modulo = 'Saldo Inicial' OR _kx_trim(m.remision) <> '')
    AND NOT EXISTS (SELECT 1 FROM anuladas a WHERE a.rem = _kx_trim(m.remision))
$function$;

REVOKE ALL ON FUNCTION public._kx_movs(text) FROM public, anon, authenticated;


-- ── 2. get_saldos_holding(): mismo resultado que antes, ahora sobre _kx_movs() ──
CREATE OR REPLACE FUNCTION public.get_saldos_holding(p_nc_retorno_desde text DEFAULT '2026-09-01')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text;
  v_res jsonb;
BEGIN
  v_rol := get_user_role();
  IF v_uid IS NULL OR v_rol IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_rol <> 'admin' AND NOT EXISTS (
    SELECT 1 FROM usuario_modulos WHERE usuario_id = v_uid AND modulo = 'reportes'
  ) THEN
    RAISE EXCEPTION 'Sin permiso para el modulo reportes' USING ERRCODE = '42501';
  END IF;

  WITH
  movs_ok AS (
    SELECT * FROM _kx_movs(p_nc_retorno_desde)
  ),

  -- Fecha de corte: Saldo Inicial más antiguo (GRANEL no mueve el corte del holding)
  corte AS (
    SELECT min(m.fecha COLLATE "C") AS f
    FROM movs_ok m
    WHERE m.modulo = 'Saldo Inicial'
      AND coalesce(m.fecha, '') <> ''
      AND upper(_kx_trim(m.empresa)) <> 'GRANEL'
  ),

  saldos AS (
    SELECT m.producto, m.empresa, sum(m.signo * m.cantidad) AS saldo
    FROM movs_ok m
    CROSS JOIN corte c
    WHERE m.producto <> ''
      AND m.empresa <> ''
      AND (c.f IS NULL OR (coalesce(m.fecha, '') COLLATE "C") >= c.f)
    GROUP BY m.producto, m.empresa
  ),

  por_prod AS (
    SELECT producto, jsonb_object_agg(empresa, saldo) AS por_emp
    FROM saldos
    GROUP BY producto
  )
  SELECT coalesce(jsonb_object_agg(producto, por_emp), '{}'::jsonb)
  INTO v_res
  FROM por_prod;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_saldos_holding(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_saldos_holding(text) TO authenticated;


-- ── 3. get_movs_holding_otras(): movimientos de las empresas que el usuario NO ve ──
-- Devuelve un array jsonb de { p: producto, r: presentación, m: módulo,
-- t: 'Entrada'|'Salida', f: día (YYYY-MM-DD), c: cantidad }, FUSIONADOS entre
-- todas las empresas no visibles (sin nombre de empresa ni remisión) y sin GRANEL
-- (la bodega GRANEL queda fuera del balance del holding). Incluye los Saldo
-- Inicial: el cliente los necesita para calcular la fecha de corte global.
-- "Visible" = user_has_company(), el mismo criterio del RLS.
-- Solo para quienes pueden ver el Balance de litros (admin, editor, gerente_iaso).
CREATE OR REPLACE FUNCTION public.get_movs_holding_otras(p_nc_retorno_desde text DEFAULT '2026-09-01')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text;
  v_res jsonb;
BEGIN
  v_rol := get_user_role();
  IF v_uid IS NULL OR v_rol IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_rol NOT IN ('admin', 'editor', 'gerente_iaso') THEN
    RAISE EXCEPTION 'Sin permiso para el Balance de litros' USING ERRCODE = '42501';
  END IF;
  IF v_rol <> 'admin' AND NOT EXISTS (
    SELECT 1 FROM usuario_modulos WHERE usuario_id = v_uid AND modulo = 'reportes'
  ) THEN
    RAISE EXCEPTION 'Sin permiso para el modulo reportes' USING ERRCODE = '42501';
  END IF;

  WITH
  m AS (
    SELECT * FROM _kx_movs(p_nc_retorno_desde)
    WHERE empresa <> '' AND upper(_kx_trim(empresa)) <> 'GRANEL'
  ),
  vis AS (
    SELECT e.empresa, user_has_company(e.empresa) AS visible
    FROM (SELECT DISTINCT empresa FROM m) e
  ),
  otras AS (
    SELECT m.producto, m.presentacion, m.modulo, m.signo, left(m.fecha, 10) AS dia, sum(m.cantidad) AS cant
    FROM m
    JOIN vis ON vis.empresa = m.empresa
    WHERE NOT vis.visible
    GROUP BY m.producto, m.presentacion, m.modulo, m.signo, left(m.fecha, 10)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'p', o.producto, 'r', o.presentacion, 'm', o.modulo,
           't', CASE WHEN o.signo > 0 THEN 'Entrada' ELSE 'Salida' END,
           'f', o.dia, 'c', o.cant)), '[]'::jsonb)
  INTO v_res
  FROM otras o;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_movs_holding_otras(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_movs_holding_otras(text) TO authenticated;


-- ── 4. Refrescar la cache de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migracion add_movs_holding_litros_rpc
-- ============================================================
