-- ─────────────────────────────────────────────────────────────────────────────
-- CambiosMercancia: trámite PARCIAL de ingreso y salida
--
-- Antes, «Gestionar cambio» registraba cada lado (ingreso / salida) de una sola
-- vez y por la Cantidad completa de la línea, con UNA remisión por lado. Pero a
-- veces no llega todo lo que devuelve el cliente, o no se puede entregar todo lo
-- que sale. Ahora cada lado se puede tramitar en varias pasadas, con la cantidad
-- real de cada línea y su propia remisión; lo que falta queda pendiente.
--
-- Modelo (una pasada = un elemento en el arreglo de la línea):
--   Movs_Ingreso  jsonb  [{rem, cant, fecha, bodega}]  líneas CAMBIAR (lo que devuelve el cliente)
--   Movs_Salida   jsonb  [{rem, cant, fecha, bodega}]  líneas ENTREGAR, o CAMBIAR si el cambio
--                                                      no tiene ENTREGAR (mismo producto)
-- Las filas anteriores no los tienen (arreglo vacío): su Remision_Ingreso /
-- Remision_Salida cubre TODA la Cantidad, como siempre. Las columnas heredadas
-- (Remision_*, Bodega_*, Fecha_*) se siguen llenando en las filas con movimientos
-- (remisiones separadas por coma / bodega y fecha de la última pasada) solo para
-- búsquedas y exportes; el stock se calcula de los arreglos.
--
--   Cierre_Con_Faltante  true cuando se cerró dejando cantidades sin recibir/entregar
--                        (con Observacion_Cierre obligatoria); lo pendiente no mueve inventario.
--
-- Lectores del inventario que cambian con esto (mismo criterio en todos):
--   · SQL: _kx_movs (la usan get_saldos_holding y get_movs_holding_otras)
--   · JS : js/shared.js (camEventosLinea) → existencias.js, kardex.js, legalizacion-prorrateo.js,
--          reportes.js, despachos-devcam.js
-- Además: get_prorrateo_legalizacion_datos/fuentes devuelven los arreglos, y
-- liberar_remision los considera (una remisión dentro de un arreglo ya está usada).
--
-- tramitar_cambio(jsonb): registra una pasada (o el cierre) de forma ATÓMICA y con las
-- filas del cambio bloqueadas; valida cantidades contra lo pendiente. SECURITY INVOKER:
-- aplican las políticas RLS de CambiosMercancia.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Columnas ──
ALTER TABLE public."CambiosMercancia"
  ADD COLUMN IF NOT EXISTS "Movs_Ingreso"        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "Movs_Salida"         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "Cierre_Con_Faltante" boolean DEFAULT false;


-- ── 2. Helpers ──

-- Cantidad ya tramitada de un lado de una línea: suma del arreglo; si no hay
-- arreglo y la fila tiene remisión (dato anterior), toda la Cantidad.
CREATE OR REPLACE FUNCTION public._cam_cant_hecha(p_movs jsonb, p_rem text, p_cant numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_movs) = 'array' AND jsonb_array_length(p_movs) > 0
      THEN (SELECT coalesce(sum((e->>'cant')::numeric), 0) FROM jsonb_array_elements(p_movs) e)
    WHEN btrim(coalesce(p_rem, '')) <> '' THEN coalesce(p_cant, 0)
    ELSE 0
  END
$$;

-- Movimientos de un lado de una línea (mismo criterio que camEventosLinea en shared.js):
-- los del arreglo, o —en filas anteriores— uno solo por toda la Cantidad con la
-- remisión/bodega/fecha de la fila.
CREATE OR REPLACE FUNCTION public._kx_cam_eventos(p_movs jsonb, p_rem text, p_bodega text, p_fecha text, p_cant numeric)
RETURNS TABLE(rem text, cant numeric, fecha text, bodega text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT _kx_trim(e->>'rem'),
         _kx_num(e->>'cant'),
         coalesce(e->>'fecha', ''),
         coalesce(nullif(_kx_trim(e->>'bodega'), ''), 'Productos Buenos')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_movs) = 'array' THEN p_movs ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT _kx_trim(p_rem),
         coalesce(p_cant, 0),
         coalesce(p_fecha, ''),
         coalesce(nullif(_kx_trim(p_bodega), ''), 'Productos Buenos')
   WHERE (p_movs IS NULL OR jsonb_typeof(p_movs) <> 'array' OR jsonb_array_length(p_movs) = 0)
     AND _kx_trim(p_rem) <> ''
$$;

REVOKE ALL ON FUNCTION public._kx_cam_eventos(jsonb, text, text, text, numeric) FROM public, anon, authenticated;


-- ── 3. Candado: movimientos bien formados y nunca por encima de la Cantidad ──
-- Rechazo duro, pero una fila ya inconsistente de antes se puede seguir corrigiendo.
CREATE OR REPLACE FUNCTION public.fn_cambios_movs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lado text;
  v_arr  jsonb;
  v_el   jsonb;
  v_sum  numeric;
  v_old_sum numeric;
BEGIN
  FOREACH v_lado IN ARRAY ARRAY['Movs_Ingreso', 'Movs_Salida'] LOOP
    v_arr := to_jsonb(NEW) -> v_lado;
    IF v_arr IS NULL OR jsonb_typeof(v_arr) <> 'array' THEN
      RAISE EXCEPTION '% debe ser un arreglo JSON', v_lado USING ERRCODE = 'check_violation';
    END IF;
    v_sum := 0;
    FOR v_el IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
      IF jsonb_typeof(v_el) <> 'object'
         OR btrim(coalesce(v_el->>'rem', '')) = ''
         OR _kx_num(v_el->>'cant') <= 0 THEN
        RAISE EXCEPTION '% tiene un movimiento sin remisión o con cantidad no válida', v_lado
          USING ERRCODE = 'check_violation';
      END IF;
      v_sum := v_sum + _kx_num(v_el->>'cant');
    END LOOP;

    IF v_sum > coalesce(NEW."Cantidad", 0) + 0.001 THEN
      v_old_sum := 0;
      IF TG_OP = 'UPDATE' THEN
        SELECT coalesce(sum(_kx_num(e->>'cant')), 0) INTO v_old_sum
          FROM jsonb_array_elements(coalesce(to_jsonb(OLD) -> v_lado, '[]'::jsonb)) e;
      END IF;
      IF TG_OP = 'INSERT' OR NOT (v_old_sum > coalesce(OLD."Cantidad", 0) + 0.001) THEN
        RAISE EXCEPTION 'La línea % (%) quedaría con % uds. tramitadas sobre % solicitadas (%)',
          NEW.id, coalesce(NEW."Producto", '?'), v_sum, coalesce(NEW."Cantidad", 0), v_lado
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cambios_movs_guard ON public."CambiosMercancia";
CREATE TRIGGER trg_cambios_movs_guard
  BEFORE INSERT OR UPDATE OF "Movs_Ingreso", "Movs_Salida", "Cantidad" ON public."CambiosMercancia"
  FOR EACH ROW EXECUTE FUNCTION public.fn_cambios_movs_guard();


-- ── 4. _kx_movs: los movimientos de Cambios salen de los arreglos ──
-- Idéntica a la anterior salvo los dos bloques «Cambios». Sin movimientos nuevos
-- devuelve exactamente las mismas filas que antes.
CREATE OR REPLACE FUNCTION public._kx_movs(p_nc_retorno_desde text DEFAULT '2026-09-01'::text)
 RETURNS TABLE(empresa text, producto text, presentacion text, signo integer, cantidad numeric, fecha text, modulo text, remision text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  anuladas AS (
    SELECT DISTINCT _kx_trim("Remision") AS rem
    FROM "RemisionesAnuladas"
    WHERE _kx_trim("Remision") <> ''
  ),

  cambios_te AS (
    SELECT coalesce("Empresa", '') || '||' || coalesce(nullif("Consecutivo", ''), id::text) AS gk,
           bool_or("Tipo_Linea" = 'ENTREGAR') AS te
    FROM "CambiosMercancia"
    GROUP BY 1
  ),

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

  movs AS (
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
    SELECT coalesce(p."Nombre_Empresa", ''), _kx_norm_prod(p."Producto"), coalesce(p."Presentacion", ''), -1,
           p."Cant_Entregada",
           coalesce(nullif(p."Fecha_Ult_Entrega", ''), nullif(p."Fecha_Pedido", ''), ''),
           'Pedidos', _kx_trim(p."Remisiones")
    FROM ped p
    WHERE position('|' in _kx_trim(p."Remisiones")) = 0

    UNION ALL
    SELECT i."Empresa_Destino", _kx_norm_prod(i."Producto"), coalesce(i."Presentacion", ''), 1, i."Cantidad",
           coalesce(i."Fecha", ''), 'Ingresos', coalesce(i."Remision_Destino", '')
    FROM ing i
    WHERE coalesce(i."Empresa_Destino", '') <> ''

    UNION ALL
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
    SELECT coalesce(d."Empresa", ''), _kx_norm_prod(d."Producto"), coalesce(d."Presentacion", ''), 1, d.cant,
           coalesce(nullif(d."Fecha_Devolucion", ''), nullif(d."Fecha", ''), ''),
           'Devoluciones',
           coalesce(nullif(d."Remision", ''), nullif(d."Remision_Ingreso", ''), '')
    FROM dev d
    WHERE d.cant > 0
      AND _kx_trim(d."Bodega_Ingreso") <> 'Producto No Conforme'

    UNION ALL
    SELECT coalesce(d."Empresa", ''), _kx_norm_prod(d."Producto"), coalesce(d."Presentacion", ''), -1, d.cant,
           coalesce(nullif(d."Fecha_Salida", ''), nullif(d."Fecha_Devolucion", ''), nullif(d."Fecha", ''), ''),
           'Devoluciones', _kx_trim(d."Remision_Salida")
    FROM dev d
    WHERE d.cant > 0
      AND _kx_trim(d."Remision_Salida") <> ''
      AND _kx_trim(d."Bodega_Salida") IN ('Productos Buenos', 'Producto Terminado')

    UNION ALL
    -- Cambios: ENTRADA (línea CAMBIAR a bodega buena), un movimiento por pasada de ingreso
    SELECT coalesce(c."Empresa", ''), _kx_norm_prod(c."Producto"), '', 1, ev.cant,
           coalesce(nullif(ev.fecha, ''), nullif(c."Fecha_Solicitud", ''), ''),
           'Cambios', ev.rem
    FROM camb c
    CROSS JOIN LATERAL _kx_cam_eventos(c."Movs_Ingreso", c."Remision_Ingreso", c."Bodega_Ingreso", c."Fecha_Ingreso", c."Cantidad") ev
    WHERE c."Tipo_Linea" = 'CAMBIAR'
      AND ev.cant > 0
      AND ev.bodega IN ('Productos Buenos', 'Producto Terminado')
      AND ev.rem <> ''

    UNION ALL
    -- Cambios: SALIDA (ENTREGAR; o CAMBIAR si el grupo no tiene ENTREGAR), un movimiento por pasada de salida
    SELECT coalesce(c."Empresa", ''), _kx_norm_prod(c."Producto"), '', -1, ev.cant,
           coalesce(nullif(ev.fecha, ''), nullif(c."Fecha_Solicitud", ''), ''),
           'Cambios', ev.rem
    FROM camb c
    CROSS JOIN LATERAL _kx_cam_eventos(c."Movs_Salida", c."Remision_Salida", c."Bodega_Salida", c."Fecha_Salida", c."Cantidad") ev
    WHERE ((c.te AND c."Tipo_Linea" = 'ENTREGAR') OR (NOT c.te AND c."Tipo_Linea" = 'CAMBIAR'))
      AND ev.cant > 0
      AND ev.bodega IN ('Productos Buenos', 'Producto Terminado')
      AND ev.rem <> ''

    UNION ALL
    SELECT oc."Empresa_Destino", _kx_norm_prod(oc."Producto"), coalesce(oc."Presentacion", ''), 1, oc."Cantidad",
           coalesce(oc."Fecha", ''), 'Órdenes de Compra', _kx_trim(oc."Remision")
    FROM "OrdenesCompra" oc
    WHERE coalesce(oc."Cantidad", 0) > 0
      AND _kx_trim(oc."Remision") <> ''
      AND coalesce(oc."Empresa_Destino", '') <> ''

    UNION ALL
    SELECT oc."Empresa_Origen", _kx_norm_prod(oc."Producto"), coalesce(oc."Presentacion", ''), -1, oc."Cantidad",
           coalesce(oc."Fecha", ''), 'Órdenes de Compra', _kx_trim(oc."Remision")
    FROM "OrdenesCompra" oc
    WHERE coalesce(oc."Cantidad", 0) > 0
      AND _kx_trim(oc."Remision") <> ''
      AND coalesce(oc."Empresa_Origen", '') <> ''
      AND oc."Empresa_Origen" IS DISTINCT FROM oc."Empresa_Destino"

    UNION ALL
    SELECT coalesce(m."Empresa", ''), _kx_norm_prod(m."Producto"), coalesce(m."Presentacion", ''), -1, m."Cant_Entregada",
           coalesce(nullif(m."Fecha_Despacho", ''), nullif(m."Fecha_Entrega", ''), nullif(m."Fecha_Solicitud", ''), ''),
           'Muestras', _kx_trim(m."Remision")
    FROM "SolicitudMuestras" m
    WHERE m."Historico" IS DISTINCT FROM true
      AND coalesce(nullif(m."Tipo_Solicitud", ''), 'Despacho') <> 'Produccion'
      AND coalesce(m."Cant_Entregada", 0) > 0
      AND _kx_trim(m."Remision") <> ''

    UNION ALL
    SELECT coalesce(r."Empresa", ''), _kx_norm_prod(r."Producto"), coalesce(r."Presentacion", ''), -1, r."Cantidad",
           coalesce(r."Fecha", ''),
           CASE WHEN coalesce(r."Empresa_Destino", '') <> '' THEN 'Traslado' ELSE 'Producción' END,
           _kx_trim(r."Remision")
    FROM reen r

    UNION ALL
    SELECT r."Empresa_Destino", _kx_norm_prod(r."Producto"), coalesce(r."Presentacion", ''), 1, r."Cantidad",
           coalesce(r."Fecha", ''), 'Traslado',
           coalesce(nullif(_kx_trim(r."Remision_Destino"), ''), _kx_trim(r."Remision"))
    FROM reen r
    WHERE coalesce(r."Empresa_Destino", '') <> ''

    UNION ALL
    SELECT coalesce(n."Empresa", ''), _kx_norm_prod(n."Producto"), coalesce(n."Presentacion", ''), -1, n."Cantidad",
           coalesce(n."Fecha", ''), 'Bodega NC', coalesce(n."Remision", '')
    FROM nc n
    WHERE n."Tipo" = 'Ingreso_NC'
      AND coalesce(n."Motivo", '') NOT IN ('Devolucion_cliente', 'Retorno_conforme', 'Traslado_NC')

    UNION ALL
    SELECT coalesce(n."Empresa", ''), _kx_norm_prod(n."Producto"), coalesce(n."Presentacion", ''), 1, n."Cantidad",
           coalesce(n."Fecha", ''), 'Bodega NC', coalesce(n."Remision", '')
    FROM nc n
    WHERE n."Tipo" = 'Salida_NC'
      AND regexp_replace(_kx_unaccent(lower(_kx_trim(n."Motivo"))), '[^a-z0-9]', '', 'g')
          IN ('reacondicionamiento', 'retornoconforme', 'retornoabodegaconforme')
      AND NOT (coalesce(p_nc_retorno_desde, '') <> '' AND (coalesce(n."Fecha", '') COLLATE "C") < (p_nc_retorno_desde COLLATE "C"))

    UNION ALL
    SELECT coalesce(a."Empresa", ''), _kx_norm_prod(a."Producto"), coalesce(a."Presentacion", ''),
           CASE WHEN a."Tipo" = 'Ajuste_Faltante' THEN -1 ELSE 1 END,
           a."Cantidad", coalesce(a."Fecha", ''),
           CASE WHEN a."Tipo" = 'Saldo_Inicial' THEN 'Saldo Inicial' ELSE 'Ajuste' END,
           ''
    FROM "KardexAjustes" a
    WHERE coalesce(a."Cantidad", 0) > 0
      AND a."Tipo" IN ('Saldo_Inicial', 'Ajuste_Sobrante', 'Ajuste_Faltante')
  )

  SELECT m.empresa, m.producto, m.presentacion, m.signo, m.cantidad, m.fecha, m.modulo, m.remision
  FROM movs m
  WHERE (m.modulo = 'Saldo Inicial' OR _kx_trim(m.remision) <> '')
    AND NOT EXISTS (SELECT 1 FROM anuladas a WHERE a.rem = _kx_trim(m.remision))
$function$;


-- ── 5. Prorrateo de legalización: devuelven también los arreglos de movimientos ──
CREATE OR REPLACE FUNCTION public.get_prorrateo_legalizacion_datos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.user_has_module('legalizacion_gastos')
          OR public.user_has_module('legalizacion_gastos_aprobar')) THEN
    RAISE EXCEPTION 'Sin permiso para consultar el prorrateo de legalizaciones';
  END IF;
  IF public.legalizacion_empresa_restringida() IS NULL THEN
    RAISE EXCEPTION 'Solo para usuarios de una sola empresa';
  END IF;

  RETURN jsonb_build_object(
    'legalizaciones', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Consecutivo", "Fecha", "Tipo", "Estado_Conciliacion", "Remisiones_Relacionadas"
          FROM "LegalizacionGastos") t),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Legalizacion_Id", "Concepto", "Valor"
          FROM "LegalizacionGastosItems") t),
    'empresas', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Legalizacion_Id", "Empresa", "Monto"
          FROM "LegalizacionGastosEmpresas") t),
    'pedidos', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id,
               CASE WHEN public.user_has_company("Nombre_Empresa") THEN "Cliente" ELSE '' END AS "Cliente",
               "Remisiones", "Estado_2", "Producto", "Presentacion", "Nombre_Empresa"
          FROM "Pedidos") t),
    'ingresos', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Producto", "Presentacion", "Cantidad", "Remision_Destino", "Remision_Origen",
               "Empresa_Destino", "Empresa_Origen"
          FROM "Ingresos") t),
    'muestras', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision", "Empresa", "Producto", "Presentacion", "Cantidad", "Cant_Entregada", "Tipo_Solicitud"
          FROM "SolicitudMuestras") t),
    'devoluciones', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision", "Remision_Ingreso", "Remision_Salida", "Empresa", "Producto", "Presentacion",
               "Cantidad", "Cant_Entregada", "Estado"
          FROM "Devoluciones") t),
    'cambios', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Tipo_Linea", "Cantidad", "Estado", "Remision_Salida", "Remision_Ingreso", "Movs_Ingreso", "Movs_Salida",
               "Consecutivo", "Empresa", "Producto"
          FROM "CambiosMercancia") t),
    'ext', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision", "Fecha", "Tipo", "Proveedor", "Planta"
          FROM "RemisionesExternas") t),
    'extItems', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision_Id", "Producto", "Presentacion", "Cantidad", "Unidad"
          FROM "RemisionesExternasItems") t)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_prorrateo_legalizacion_fuentes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar')) THEN
    RAISE EXCEPTION 'Sin permiso para el módulo de Legalización de gastos' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'pedidos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remisiones', p."Remisiones", 'Estado_2', p."Estado_2", 'Producto', p."Producto",
               'Presentacion', p."Presentacion", 'Nombre_Empresa', p."Nombre_Empresa") ORDER BY p.id), '[]'::jsonb)
        FROM "Pedidos" p
       WHERE p."Remisiones" LIKE '%|%'
    ),
    'ingresos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Producto', i."Producto", 'Presentacion', i."Presentacion", 'Cantidad', i."Cantidad",
               'Remision_Destino', i."Remision_Destino", 'Remision_Origen', i."Remision_Origen",
               'Empresa_Destino', i."Empresa_Destino", 'Empresa_Origen', i."Empresa_Origen") ORDER BY i.id), '[]'::jsonb)
        FROM "Ingresos" i
       WHERE COALESCE(TRIM(i."Remision_Destino"), '') <> '' OR COALESCE(TRIM(i."Remision_Origen"), '') <> ''
    ),
    'muestras', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remision', m."Remision", 'Empresa', m."Empresa", 'Producto', m."Producto",
               'Presentacion', m."Presentacion", 'Cantidad', m."Cantidad", 'Cant_Entregada', m."Cant_Entregada",
               'Tipo_Solicitud', m."Tipo_Solicitud") ORDER BY m.id), '[]'::jsonb)
        FROM "SolicitudMuestras" m
       WHERE COALESCE(TRIM(m."Remision"), '') <> ''
    ),
    'devoluciones', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remision', d."Remision", 'Remision_Ingreso', d."Remision_Ingreso", 'Remision_Salida', d."Remision_Salida",
               'Empresa', d."Empresa", 'Producto', d."Producto", 'Presentacion', d."Presentacion",
               'Cantidad', d."Cantidad", 'Cant_Entregada', d."Cant_Entregada", 'Estado', d."Estado") ORDER BY d.id), '[]'::jsonb)
        FROM "Devoluciones" d
       WHERE COALESCE(TRIM(d."Remision"), '') <> '' OR COALESCE(TRIM(d."Remision_Ingreso"), '') <> ''
          OR COALESCE(TRIM(d."Remision_Salida"), '') <> ''
    ),
    'cambios', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id, 'Tipo_Linea', c."Tipo_Linea", 'Cantidad', c."Cantidad", 'Estado', c."Estado",
               'Remision_Salida', c."Remision_Salida", 'Remision_Ingreso', c."Remision_Ingreso",
               'Movs_Ingreso', c."Movs_Ingreso", 'Movs_Salida', c."Movs_Salida",
               'Consecutivo', c."Consecutivo", 'Empresa', c."Empresa", 'Producto', c."Producto") ORDER BY c.id), '[]'::jsonb)
        FROM "CambiosMercancia" c
    ),
    'legalizaciones', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', l.id, 'Consecutivo', l."Consecutivo", 'Fecha', l."Fecha", 'Tipo', l."Tipo",
               'Estado_Conciliacion', l."Estado_Conciliacion", 'Remisiones_Relacionadas', l."Remisiones_Relacionadas") ORDER BY l.id), '[]'::jsonb)
        FROM "LegalizacionGastos" l
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', it.id, 'Legalizacion_Id', it."Legalizacion_Id", 'Concepto', it."Concepto", 'Valor', it."Valor") ORDER BY it.id), '[]'::jsonb)
        FROM "LegalizacionGastosItems" it
    ),
    'empresas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', e.id, 'Legalizacion_Id', e."Legalizacion_Id", 'Empresa', e."Empresa", 'Monto', e."Monto") ORDER BY e.id), '[]'::jsonb)
        FROM "LegalizacionGastosEmpresas" e
    )
  );
END;
$function$;


-- ── 6. liberar_remision: una remisión dentro de un arreglo de movimientos ya está usada ──
CREATE OR REPLACE FUNCTION public.liberar_remision(p_empresa_nombre text, p_tipo text, p_remision text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text;
  v_num int;
  v_rem text := TRIM(COALESCE(p_remision, ''));
  v_referenciada boolean;
  v_liberada boolean := false;
BEGIN
  IF NOT (public.user_has_company(p_empresa_nombre)
          AND public.get_user_role() = ANY (ARRAY['admin','editor','despachador','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_rem = '' OR p_tipo NOT IN ('ENTRADA','SALIDA') THEN
    RETURN false;
  END IF;

  v_sigla := CASE
    WHEN TRIM(p_empresa_nombre) ILIKE '%PARCELAR%' THEN 'PARCELAR'
    WHEN TRIM(p_empresa_nombre) ILIKE '%GREEN%'    THEN 'GREEN'
    WHEN TRIM(p_empresa_nombre) ILIKE '%RESO%'     THEN 'RESO'
    WHEN TRIM(p_empresa_nombre) ILIKE '%INSUMOS AGROPECUARIOS SOSTENIBLES%' THEN 'IASO'
    WHEN TRIM(p_empresa_nombre) ILIKE '%INSUMOS AGROPECUARIOS DE LA SABANA%' THEN 'IAS'
    WHEN TRIM(p_empresa_nombre) = 'PARCELAR' THEN 'PARCELAR'
    WHEN TRIM(p_empresa_nombre) = 'GREEN'    THEN 'GREEN'
    WHEN TRIM(p_empresa_nombre) = 'RESO'     THEN 'RESO'
    WHEN TRIM(p_empresa_nombre) = 'IASO'     THEN 'IASO'
    WHEN TRIM(p_empresa_nombre) = 'IAS'      THEN 'IAS'
    WHEN UPPER(TRIM(p_empresa_nombre)) = 'GRANEL' THEN 'GRANEL'
    ELSE NULL
  END;
  IF v_sigla IS NULL THEN
    RETURN false;
  END IF;

  v_num := NULLIF(regexp_replace(v_rem, '\D', '', 'g'), '')::int;
  IF v_num IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
              SELECT 1 FROM "Pedidos"            WHERE "Remisiones"       LIKE '%' || v_rem || '%'
    UNION ALL SELECT 1 FROM "EntregasPedido"     WHERE "remision"         = v_rem
    UNION ALL SELECT 1 FROM "Ingresos"           WHERE "Remision_Origen"  = v_rem OR "Remision_Destino" = v_rem
    UNION ALL SELECT 1 FROM "OrdenesCompra"      WHERE "Remision"         = v_rem OR "Remision_Origen"  = v_rem
    UNION ALL SELECT 1 FROM "SolicitudMuestras"  WHERE "Remision"         = v_rem
    UNION ALL SELECT 1 FROM "Reenvases"          WHERE "Remision"         = v_rem OR "Remision_Destino" = v_rem
    UNION ALL SELECT 1 FROM "Devoluciones"       WHERE "Remision"         = v_rem OR "Remision_Ingreso" = v_rem OR "Remision_Salida" = v_rem
    UNION ALL SELECT 1 FROM "CambiosMercancia"   WHERE "Remision_Ingreso" = v_rem OR "Remision_Salida"  = v_rem
                                                    OR "Movs_Ingreso"::text LIKE '%"' || v_rem || '"%'
                                                    OR "Movs_Salida"::text  LIKE '%"' || v_rem || '"%'
    UNION ALL SELECT 1 FROM "KardexNC"           WHERE "Remision"         = v_rem
    UNION ALL SELECT 1 FROM "RemisionesAnuladas" WHERE "Remision"         = v_rem
  ) INTO v_referenciada;

  IF v_referenciada THEN
    RETURN false;
  END IF;

  UPDATE "consecutivos_remisiones"
  SET ultimo_numero = ultimo_numero - 1
  WHERE empresa = v_sigla AND tipo = p_tipo AND ultimo_numero = v_num
  RETURNING true INTO v_liberada;

  RETURN COALESCE(v_liberada, false);
END;
$function$;


-- ── 7. tramitar_cambio(): una pasada de ingreso y/o salida, o el cierre ──
-- p_payload:
--   ids          [bigint]  TODAS las líneas del cambio (se valida que sean exactamente el grupo)
--   lados        'ambos' | 'ingreso' | 'salida' | 'faltante' | 'sinrecepcion'
--   ingreso      {rem, bodega, fecha, lineas:[{id, cant}]}                  (lados ambos/ingreso)
--   salida       {rem, bodega, fecha, lineas:[{id, cant, directa?}]}        (lados ambos/salida)
--                directa = parte de cant surtida con inventario propio (suma a Cant_Entregada)
--   observacion  text  (≥ 10 car.; obligatoria en 'faltante' y 'sinrecepcion')
-- Estado resultante: Cerrado si no queda nada pendiente en ningún lado; si no, Parcial.
--   faltante      cierra dejando lo pendiente sin mover inventario (exige algún movimiento previo)
--   sinrecepcion  cierra sin haber recibido nada (exige que no haya ingreso)
-- Devuelve {ok, estado, remision_ingreso, remision_salida, pend_ing, pend_sal}.
CREATE OR REPLACE FUNCTION public.tramitar_cambio(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_lados    text := coalesce(p_payload->>'lados', '');
  v_obs      text := btrim(coalesce(p_payload->>'observacion', ''));
  v_ing      jsonb := p_payload->'ingreso';
  v_sal      jsonb := p_payload->'salida';
  v_ids      bigint[];
  v_key      text;
  v_grupo    bigint[];
  v_te       boolean;
  v_do_ing   boolean;
  v_do_sal   boolean;
  v_rem_ing  text := '';
  v_rem_sal  text := '';
  v_bod_ing  text;
  v_bod_sal  text;
  v_algo_ing boolean := false;
  v_algo_sal boolean := false;
  v_hay_ing  boolean;
  v_hay_sal  boolean;
  v_pend_ing numeric;
  v_pend_sal numeric;
  v_estado   text;
  l          jsonb;
  r          "CambiosMercancia"%ROWTYPE;
  v_id       bigint;
  v_cant     numeric;
  v_directa  numeric;
  v_pend     numeric;
  v_nuevo    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_lados NOT IN ('ambos', 'ingreso', 'salida', 'faltante', 'sinrecepcion') THEN
    RAISE EXCEPTION 'Modo de trámite no válido: %', v_lados;
  END IF;

  SELECT coalesce(array_agg(DISTINCT x::bigint), '{}') INTO v_ids
    FROM jsonb_array_elements_text(coalesce(p_payload->'ids', '[]'::jsonb)) x;
  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Faltan las líneas del cambio';
  END IF;

  -- El grupo (empresa + consecutivo) de la primera línea, bloqueado, debe ser exactamente ids.
  SELECT coalesce(c."Empresa", '') || '||' || coalesce(nullif(c."Consecutivo", ''), c.id::text)
    INTO v_key FROM "CambiosMercancia" c WHERE c.id = v_ids[1];
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Cambio no encontrado';
  END IF;
  SELECT array_agg(g.id ORDER BY g.id) INTO v_grupo FROM (
    SELECT c.id FROM "CambiosMercancia" c
     WHERE coalesce(c."Empresa", '') || '||' || coalesce(nullif(c."Consecutivo", ''), c.id::text) = v_key
     ORDER BY c.id FOR UPDATE
  ) g;
  IF v_grupo IS DISTINCT FROM (SELECT array_agg(i ORDER BY i) FROM unnest(v_ids) i) THEN
    RAISE EXCEPTION 'Las líneas no corresponden al cambio completo (pudo cambiar): recarga e intenta de nuevo';
  END IF;
  IF EXISTS (SELECT 1 FROM "CambiosMercancia" WHERE id = ANY(v_ids) AND "Historico" IS TRUE) THEN
    RAISE EXCEPTION 'Los cambios de carga histórica no se tramitan';
  END IF;
  IF EXISTS (SELECT 1 FROM "CambiosMercancia" WHERE id = ANY(v_ids)
              AND lower(coalesce("Estado", '')) IN ('cerrado', 'cerrada', 'completado', 'anulado')) THEN
    RAISE EXCEPTION 'Este cambio ya está cerrado: no admite más trámites';
  END IF;

  SELECT coalesce(bool_or("Tipo_Linea" = 'ENTREGAR'), false) INTO v_te
    FROM "CambiosMercancia" WHERE id = ANY(v_ids);
  v_do_ing := v_lados IN ('ambos', 'ingreso');
  v_do_sal := v_lados IN ('ambos', 'salida');

  -- ── Ingreso ──
  IF v_do_ing THEN
    IF v_ing IS NULL OR btrim(coalesce(v_ing->>'rem', '')) = '' THEN
      RAISE EXCEPTION 'Falta la remisión de ingreso';
    END IF;
    IF btrim(coalesce(v_ing->>'fecha', '')) = '' THEN
      RAISE EXCEPTION 'Falta la fecha de ingreso';
    END IF;
    v_rem_ing := btrim(v_ing->>'rem');
    v_bod_ing := coalesce(nullif(btrim(v_ing->>'bodega'), ''), 'Productos Buenos');
    FOR l IN SELECT * FROM jsonb_array_elements(coalesce(v_ing->'lineas', '[]'::jsonb)) LOOP
      v_id := (l->>'id')::bigint;
      v_cant := coalesce((l->>'cant')::numeric, 0);
      CONTINUE WHEN v_cant = 0;
      IF v_cant < 0 OR v_cant <> trunc(v_cant) THEN
        RAISE EXCEPTION 'Cantidad de ingreso no válida';
      END IF;
      SELECT * INTO r FROM "CambiosMercancia" WHERE id = v_id AND id = ANY(v_ids);
      IF NOT FOUND OR r."Tipo_Linea" <> 'CAMBIAR' THEN
        RAISE EXCEPTION 'La línea % no admite ingreso', v_id;
      END IF;
      v_pend := coalesce(r."Cantidad", 0) - _cam_cant_hecha(r."Movs_Ingreso", r."Remision_Ingreso", r."Cantidad");
      IF v_cant > v_pend THEN
        RAISE EXCEPTION 'Ingreso de % uds. de «%» supera lo pendiente (%)', v_cant, r."Producto", v_pend;
      END IF;
      v_nuevo := coalesce(r."Movs_Ingreso", '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rem', v_rem_ing, 'cant', v_cant, 'fecha', btrim(v_ing->>'fecha'), 'bodega', v_bod_ing));
      UPDATE "CambiosMercancia" SET
        "Movs_Ingreso"     = v_nuevo,
        "Remision_Ingreso" = (SELECT string_agg(DISTINCT e->>'rem', ', ') FROM jsonb_array_elements(v_nuevo) e),
        "Bodega_Ingreso"   = v_bod_ing,
        "Fecha_Ingreso"    = btrim(v_ing->>'fecha'),
        modificado_por     = v_uid
       WHERE id = v_id;
      v_algo_ing := true;
    END LOOP;
    IF NOT v_algo_ing THEN
      RAISE EXCEPTION 'Indica al menos una cantidad a ingresar';
    END IF;
  END IF;

  -- ── Salida ──
  IF v_do_sal THEN
    IF v_sal IS NULL OR btrim(coalesce(v_sal->>'rem', '')) = '' THEN
      RAISE EXCEPTION 'Falta la remisión de salida';
    END IF;
    IF btrim(coalesce(v_sal->>'fecha', '')) = '' THEN
      RAISE EXCEPTION 'Falta la fecha de salida';
    END IF;
    v_rem_sal := btrim(v_sal->>'rem');
    v_bod_sal := coalesce(nullif(btrim(v_sal->>'bodega'), ''), 'Productos Buenos');
    FOR l IN SELECT * FROM jsonb_array_elements(coalesce(v_sal->'lineas', '[]'::jsonb)) LOOP
      v_id := (l->>'id')::bigint;
      v_cant := coalesce((l->>'cant')::numeric, 0);
      CONTINUE WHEN v_cant = 0;
      IF v_cant < 0 OR v_cant <> trunc(v_cant) THEN
        RAISE EXCEPTION 'Cantidad de salida no válida';
      END IF;
      v_directa := coalesce((l->>'directa')::numeric, 0);
      IF v_directa < 0 OR v_directa > v_cant THEN
        RAISE EXCEPTION 'La entrega directa no puede superar la cantidad de salida';
      END IF;
      SELECT * INTO r FROM "CambiosMercancia" WHERE id = v_id AND id = ANY(v_ids);
      IF NOT FOUND OR NOT ((v_te AND r."Tipo_Linea" = 'ENTREGAR') OR (NOT v_te AND r."Tipo_Linea" = 'CAMBIAR')) THEN
        RAISE EXCEPTION 'La línea % no admite salida', v_id;
      END IF;
      v_pend := coalesce(r."Cantidad", 0) - _cam_cant_hecha(r."Movs_Salida", r."Remision_Salida", r."Cantidad");
      IF v_cant > v_pend THEN
        RAISE EXCEPTION 'Salida de % uds. de «%» supera lo pendiente (%)', v_cant, r."Producto", v_pend;
      END IF;
      v_nuevo := coalesce(r."Movs_Salida", '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rem', v_rem_sal, 'cant', v_cant, 'fecha', btrim(v_sal->>'fecha'), 'bodega', v_bod_sal));
      UPDATE "CambiosMercancia" SET
        "Movs_Salida"     = v_nuevo,
        "Remision_Salida" = (SELECT string_agg(DISTINCT e->>'rem', ', ') FROM jsonb_array_elements(v_nuevo) e),
        "Bodega_Salida"   = v_bod_sal,
        "Fecha_Salida"    = btrim(v_sal->>'fecha'),
        "Cant_Entregada"  = coalesce("Cant_Entregada", 0) + v_directa,
        modificado_por    = v_uid
       WHERE id = v_id;
      v_algo_sal := true;
    END LOOP;
    IF NOT v_algo_sal THEN
      RAISE EXCEPTION 'Indica al menos una cantidad a entregar';
    END IF;
  END IF;

  -- ── Lo que queda pendiente / lo que ya se movió, tras esta pasada ──
  SELECT
    coalesce(sum(CASE WHEN c."Tipo_Linea" = 'CAMBIAR'
                      THEN greatest(0, coalesce(c."Cantidad", 0) - _cam_cant_hecha(c."Movs_Ingreso", c."Remision_Ingreso", c."Cantidad"))
                      ELSE 0 END), 0),
    coalesce(sum(CASE WHEN (v_te AND c."Tipo_Linea" = 'ENTREGAR') OR (NOT v_te AND c."Tipo_Linea" = 'CAMBIAR')
                      THEN greatest(0, coalesce(c."Cantidad", 0) - _cam_cant_hecha(c."Movs_Salida", c."Remision_Salida", c."Cantidad"))
                      ELSE 0 END), 0),
    coalesce(bool_or(c."Tipo_Linea" = 'CAMBIAR'
                     AND _cam_cant_hecha(c."Movs_Ingreso", c."Remision_Ingreso", c."Cantidad") > 0), false),
    coalesce(bool_or(((v_te AND c."Tipo_Linea" = 'ENTREGAR') OR (NOT v_te AND c."Tipo_Linea" = 'CAMBIAR'))
                     AND _cam_cant_hecha(c."Movs_Salida", c."Remision_Salida", c."Cantidad") > 0), false)
    INTO v_pend_ing, v_pend_sal, v_hay_ing, v_hay_sal
    FROM "CambiosMercancia" c WHERE c.id = ANY(v_ids);

  -- ── Estado del cambio ──
  IF v_lados = 'sinrecepcion' THEN
    IF length(v_obs) < 10 THEN
      RAISE EXCEPTION 'Escribe la observación que justifica cerrar sin recibir el producto (mínimo 10 caracteres)';
    END IF;
    IF v_hay_ing THEN
      RAISE EXCEPTION 'Este cambio ya tiene ingreso registrado: usa «Cerrar con faltante»';
    END IF;
    v_estado := 'Cerrado';
    UPDATE "CambiosMercancia"
       SET "Estado" = v_estado, "Cierre_Sin_Recepcion" = true, "Observacion_Cierre" = v_obs, modificado_por = v_uid
     WHERE id = ANY(v_ids);
  ELSIF v_lados = 'faltante' THEN
    IF length(v_obs) < 10 THEN
      RAISE EXCEPTION 'Escribe la observación que justifica cerrar con faltante (mínimo 10 caracteres)';
    END IF;
    IF NOT (v_hay_ing OR v_hay_sal) THEN
      RAISE EXCEPTION 'No hay ingresos ni salidas registrados: usa «Cerrar sin recibir producto»';
    END IF;
    IF v_pend_ing + v_pend_sal = 0 THEN
      RAISE EXCEPTION 'No hay faltante: todo lo solicitado ya se tramitó';
    END IF;
    v_estado := 'Cerrado';
    UPDATE "CambiosMercancia"
       SET "Estado" = v_estado, "Cierre_Con_Faltante" = true, "Observacion_Cierre" = v_obs, modificado_por = v_uid
     WHERE id = ANY(v_ids);
  ELSE
    v_estado := CASE WHEN v_pend_ing = 0 AND v_pend_sal = 0 THEN 'Cerrado' ELSE 'Parcial' END;
    UPDATE "CambiosMercancia" SET "Estado" = v_estado, modificado_por = v_uid WHERE id = ANY(v_ids);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'estado', v_estado,
    'remision_ingreso', v_rem_ing, 'remision_salida', v_rem_sal,
    'pend_ing', v_pend_ing, 'pend_sal', v_pend_sal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tramitar_cambio(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tramitar_cambio(jsonb) TO authenticated;

-- Refrescar el schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
