-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite / consignación — PARTE 3 de 5: núcleo (fase 1)
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere: bodega_satelite_tablas.sql y bodega_satelite_avisos.sql.
--
-- QUÉ HACE: las funciones que usa la app de bodega (bodega-satelite.html). TODO lo que escribe
-- el libro Bodega* pasa por aquí: las tablas no tienen políticas de escritura. No escribe NADA
-- en tablas de la principal; solo LEE Pedidos / RemisionesAnuladas / maestro_productos.
--
-- Todas SECURITY DEFINER con search_path fijo, guarda de bodega asignada dentro del cuerpo
-- (_bodega_acceso) y pg_advisory_xact_lock por bodega (consecutivos sin repetir, sin saldo negativo).
-- Permisos: las `bodega_*` ejecutables por `authenticated`; las `_bodega_*` internas, por nadie.
--
-- RPC públicas (jsonb):
--   bodega_mi_contexto()                      bodegas del usuario (config, código, corte, conteo inicial)
--   bodega_productos()                        productos del maestro (la bodega no lee esa tabla)
--   bodega_existencias(bodega)                saldos + «en tránsito» hacia otras bodegas
--   bodega_traslados_pendientes(bodega)       remisiones de la principal por recibir (sin cliente ni precios) + alertas
--   bodega_recibir_traslado(bodega, rem, lineas, obs)   ENTRADA_TRASLADO con lo realmente recibido
--   bodega_registrar_salida(bodega, destinatario, lineas, obs, fecha)   SALIDA_DESPACHO + serie BOD-<COD>-RS-n
--   bodega_guardar_conteo / bodega_conteos / bodega_aplicar_conteo      conteo inicial y periódicos
--   bodega_anular_documento / bodega_anular_movimiento                   anulación con motivo
--   bodega_kardex(bodega, producto, desde, hasta, incluir_anulados)     movimientos con saldo corrido
--
-- REGLAS (revisión del plan, 2026-11-17):
--   • Los traslados de la principal se leen con EXACTAMENTE el mismo criterio que _kx_movs
--     (Pedidos.Remisiones = «REMISION|cant|fecha» separadas por coma; Historico ≠ true;
--     Estado_2 ≠ 'Anulado'; Cant_Entregada > 0; remisión fuera de RemisionesAnuladas). Así la
--     satélite y el Kardex de la principal nunca discrepan sobre lo que salió. Solo cuentan las
--     remisiones con fecha POSTERIOR a la fecha de corte (las anteriores se asumen en el conteo).
--   • Clave del saldo: (bodega, producto normalizado sin mayúsculas). Cantidades ENTERAS.
--   • Las salidas se bloquean hasta que exista el conteo inicial aplicado.
--   • Saldo negativo imposible. Nada se borra: se anula con motivo (mín. 5 caracteres).
--   • No se anulan: SALDO_INICIAL, ENTRADA_TRASLADO ni movimientos con traslado entre bodegas
--     (se corrigen con un conteo/ajuste o, en tránsito, con «Cancelar traslado»).
--   • Recibir con diferencia exige observación y avisa a la principal (campanita).
--
-- Idempotente. Rollback: bodega_satelite_nucleo_rollback.sql.
-- Aplicar con apply_migration del MCP ANTES de publicar el código.
-- Fecha: 2026-11-17
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════ HELPERS INTERNOS ════════════════

CREATE OR REPLACE FUNCTION public._bodega_hoy()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT (now() AT TIME ZONE 'America/Bogota')::date $function$;

-- Suma (+1) o resta (-1) según el tipo de movimiento.
CREATE OR REPLACE FUNCTION public._bodega_signo(p_tipo text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_tipo IN ('SALDO_INICIAL', 'ENTRADA_TRASLADO', 'ENTRADA_TRASLADO_BODEGA', 'AJUSTE_SOBRANTE')
              THEN 1 ELSE -1 END
$function$;

-- Presentación = lo que va después del primer « X » del nombre («NUTRICEL K50 X GALON» → GALON).
-- Mismo criterio que usa el PDF de remisión.
CREATE OR REPLACE FUNCTION public._bodega_presentacion(p_producto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(btrim((regexp_match(btrim(COALESCE(p_producto, '')), '^.*?\s+[xX]\s+(.+)$'))[1]), '')
$function$;

-- Fecha «YYYY-MM-DD…» → date, o NULL si no se puede leer (nunca lanza error).
CREATE OR REPLACE FUNCTION public._bodega_fecha_segura(p_txt text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  IF p_txt IS NULL OR p_txt !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN left(p_txt, 10)::date;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- Nombre del producto tal como está en el maestro (mismo texto para todos); si no está, el normalizado.
-- Evita que el mismo producto se vea con mayúsculas/minúsculas distintas según quién lo escribió.
CREATE OR REPLACE FUNCTION public._bodega_nombre_canonico(p_producto text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT public._kx_norm_prod(mp."Producto") FROM maestro_productos mp
      WHERE upper(public._kx_norm_prod(mp."Producto")) = upper(public._kx_norm_prod(p_producto))
      ORDER BY mp.id LIMIT 1),
    public._kx_norm_prod(p_producto))
$function$;

CREATE OR REPLACE FUNCTION public._bodega_actor_nombre()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT u.nombre FROM "BodegaUsuarios" u WHERE u.usuario_id = auth.uid() $function$;

-- Guarda de acceso: el usuario debe estar activo, asignado a la bodega y la bodega habilitada y activa.
CREATE OR REPLACE FUNCTION public._bodega_acceso(p_bodega bigint)
 RETURNS public."BodegaConfig"
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no válida.'; END IF;
  SELECT c.* INTO v_cfg
    FROM "BodegaConfig" c
    JOIN "BodegaUsuarioBodegas" ub ON ub.bodega_id = c.bodega_id AND ub.usuario_id = auth.uid()
    JOIN "BodegaUsuarios" u ON u.usuario_id = ub.usuario_id AND u.activo
    JOIN "BodegasConsignacion" b ON b.id = c.bodega_id
   WHERE c.bodega_id = p_bodega AND c.habilitada AND COALESCE(b."Activo", true);
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes acceso a esta bodega.'; END IF;
  RETURN v_cfg;
END;
$function$;

CREATE OR REPLACE FUNCTION public._bodega_tiene_inicial(p_bodega bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM "BodegaConteos" c WHERE c.bodega_id = p_bodega AND c.tipo = 'INICIAL' AND c.estado = 'Aplicado')
$function$;

-- Existencia (entradas − salidas, solo movimientos Activos) de UN producto.
CREATE OR REPLACE FUNCTION public._bodega_saldo_de(p_bodega bigint, p_producto text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(public._bodega_signo(m.tipo) * m.cantidad), 0)
    FROM "BodegaMovimientos" m
   WHERE m.bodega_id = p_bodega AND m.estado = 'Activo'
     AND upper(m.producto) = upper(public._kx_norm_prod(p_producto))
$function$;

-- Existencia de TODOS los productos de la bodega (clave: producto sin mayúsculas).
CREATE OR REPLACE FUNCTION public._bodega_saldos(p_bodega bigint)
 RETURNS TABLE(producto text, presentacion text, existencia numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._bodega_nombre_canonico((array_agg(m.producto ORDER BY m.id DESC))[1]),
         (array_agg(m.presentacion ORDER BY m.id DESC))[1],
         SUM(public._bodega_signo(m.tipo) * m.cantidad)
    FROM "BodegaMovimientos" m
   WHERE m.bodega_id = p_bodega AND m.estado = 'Activo'
   GROUP BY upper(m.producto)
$function$;

-- Siguiente número de una serie (BOD-<COD>-<tipo>-n). El llamador ya tiene el lock de la bodega.
CREATE OR REPLACE FUNCTION public._bodega_siguiente(p_bodega bigint, p_tipo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO "BodegaConsecutivos" (bodega_id, tipo, ultimo) VALUES (p_bodega, p_tipo, 1)
  ON CONFLICT (bodega_id, tipo) DO UPDATE SET ultimo = "BodegaConsecutivos".ultimo + 1
  RETURNING ultimo INTO v_n;
  RETURN v_n;
END;
$function$;

-- Valida y normaliza las líneas [{producto, presentacion?, cantidad}]: producto normalizado,
-- cantidad ENTERA (> 0, o ≥ 0 si p_cero), una fila por producto (suma los repetidos).
CREATE OR REPLACE FUNCTION public._bodega_lineas(p_lineas jsonb, p_cero boolean DEFAULT false)
 RETURNS TABLE(producto text, presentacion text, cantidad numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  e        jsonb;
  v_prod   text;
  v_txt    text;
  v_cant   numeric;
BEGIN
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto.';
  END IF;
  IF jsonb_array_length(p_lineas) > 300 THEN RAISE EXCEPTION 'Demasiadas líneas (máximo 300).'; END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_prod := public._kx_norm_prod(e->>'producto');
    IF v_prod IS NULL OR v_prod = '' THEN RAISE EXCEPTION 'Hay una línea sin producto.'; END IF;
    v_txt := btrim(COALESCE(e->>'cantidad', ''));
    IF v_txt !~ '^[0-9]{1,9}(\.0+)?$' THEN
      RAISE EXCEPTION 'Cantidad no válida para %: debe ser un número entero.', v_prod;
    END IF;
    v_cant := v_txt::numeric;
    IF v_cant <= 0 AND NOT p_cero THEN RAISE EXCEPTION 'La cantidad de % debe ser mayor que 0.', v_prod; END IF;
  END LOOP;

  RETURN QUERY
  SELECT public._bodega_nombre_canonico(min(q.pn)),
         COALESCE(NULLIF(max(q.pr), ''), public._bodega_presentacion(public._bodega_nombre_canonico(min(q.pn)))),
         sum(q.ct)
    FROM (
      SELECT public._kx_norm_prod(x->>'producto')                    AS pn,
             btrim(COALESCE(x->>'presentacion', ''))                 AS pr,
             (btrim(x->>'cantidad'))::numeric                        AS ct
        FROM jsonb_array_elements(p_lineas) x
    ) q
   GROUP BY upper(q.pn)
   ORDER BY min(q.pn);
END;
$function$;

-- Remisiones de la principal pendientes de recibir en la bodega (una fila por remisión+producto).
-- MISMO criterio que _kx_movs; sin cliente ni precios.
CREATE OR REPLACE FUNCTION public._bodega_pendientes(p_bodega bigint)
 RETURNS TABLE(remision text, fecha date, producto text, presentacion text, cantidad numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT c.fecha_corte AS corte, btrim(b."Nombre_Empresa") AS emp
      FROM "BodegaConfig" c
      JOIN "BodegasConsignacion" b ON b.id = c.bodega_id
     WHERE c.bodega_id = p_bodega
  ),
  anuladas AS (
    SELECT DISTINCT _kx_trim("Remision") AS rem FROM "RemisionesAnuladas" WHERE _kx_trim("Remision") <> ''
  ),
  ped AS (
    SELECT p.*
      FROM "Pedidos" p, cfg
     WHERE p."Bodega_Consignacion_Id" = p_bodega
       AND btrim(p."Nombre_Empresa") = cfg.emp
       AND p."Historico" IS DISTINCT FROM true
       AND COALESCE(p."Cant_Entregada", 0) > 0
       AND _kx_trim(p."Estado_2") <> 'Anulado'
       AND _kx_trim(p."Remisiones") <> ''
  ),
  segs AS (
    SELECT _kx_norm_prod(p."Producto")                        AS prod,
           COALESCE(p."Presentacion", '')                     AS pres,
           _kx_trim(split_part(s.seg, '|', 1))                AS rem,
           _kx_num(split_part(s.seg, '|', 2))                 AS cant,
           COALESCE(NULLIF(split_part(s.seg, '|', 3), ''), NULLIF(p."Fecha_Ult_Entrega", ''), NULLIF(p."Fecha_Pedido", ''), '') AS f
      FROM ped p
     CROSS JOIN LATERAL (
       SELECT _kx_trim(x) AS seg FROM regexp_split_to_table(_kx_trim(p."Remisiones"), ',') AS x
     ) s
     WHERE position('|' IN _kx_trim(p."Remisiones")) > 0
       AND s.seg <> ''
       AND _kx_trim(split_part(s.seg, '|', 1)) <> ''
       AND _kx_num(split_part(s.seg, '|', 2)) > 0
    UNION ALL
    SELECT _kx_norm_prod(p."Producto"), COALESCE(p."Presentacion", ''), _kx_trim(p."Remisiones"), p."Cant_Entregada",
           COALESCE(NULLIF(p."Fecha_Ult_Entrega", ''), NULLIF(p."Fecha_Pedido", ''), '')
      FROM ped p
     WHERE position('|' IN _kx_trim(p."Remisiones")) = 0
  ),
  agr AS (
    SELECT s.rem,
           min(public._bodega_fecha_segura(s.f)) AS f,
           min(s.prod)                           AS prod,
           upper(s.prod)                         AS k,
           max(s.pres)                           AS pres,
           sum(s.cant)                           AS cant
      FROM segs s
     WHERE s.rem <> '' AND NOT EXISTS (SELECT 1 FROM anuladas a WHERE a.rem = s.rem)
     GROUP BY s.rem, upper(s.prod)
  )
  SELECT a.rem, a.f, a.prod, a.pres, a.cant
    FROM agr a, cfg
   WHERE (a.f IS NULL OR a.f > cfg.corte)
     AND NOT EXISTS (
       SELECT 1 FROM "BodegaMovimientos" m
        WHERE m.bodega_id = p_bodega AND m.tipo = 'ENTRADA_TRASLADO' AND m.estado = 'Activo'
          AND m.origen_remision = a.rem AND upper(m.producto) = a.k
     )
$function$;

-- Recibidos cuya remisión se anuló DESPUÉS en la principal (alerta; no hay reversa automática).
CREATE OR REPLACE FUNCTION public._bodega_alertas(p_bodega bigint)
 RETURNS TABLE(remision text, producto text, cantidad numeric, fecha date)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.origen_remision, m.producto, m.cantidad, m.fecha
    FROM "BodegaMovimientos" m
   WHERE m.bodega_id = p_bodega AND m.tipo = 'ENTRADA_TRASLADO' AND m.estado = 'Activo'
     AND EXISTS (SELECT 1 FROM "RemisionesAnuladas" ra WHERE _kx_trim(ra."Remision") = _kx_trim(m.origen_remision))
$function$;


-- ════════════════ RPC PÚBLICAS ════════════════

-- ── Contexto: ¿quién soy y qué bodegas tengo? ──
-- Para un usuario que NO es de bodega devuelve usuario = null (la app lo manda a «sin acceso»).
CREATE OR REPLACE FUNCTION public.bodega_mi_contexto()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_u record;
  v_b jsonb;
BEGIN
  SELECT u.usuario_id, u.nombre, u.email INTO v_u
    FROM "BodegaUsuarios" u WHERE u.usuario_id = auth.uid() AND u.activo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('usuario', NULL, 'bodegas', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bodega_id', c.bodega_id, 'codigo', c.codigo, 'nombre', b."Nombre",
           'municipio', b."Municipio", 'departamento', b."Departamento", 'empresa', b."Nombre_Empresa",
           'fecha_corte', c.fecha_corte, 'inicial_aplicado', public._bodega_tiene_inicial(c.bodega_id)
         ) ORDER BY b."Nombre", b."Municipio", c.bodega_id), '[]'::jsonb)
    INTO v_b
    FROM "BodegaUsuarioBodegas" ub
    JOIN "BodegaConfig" c ON c.bodega_id = ub.bodega_id AND c.habilitada
    JOIN "BodegasConsignacion" b ON b.id = c.bodega_id AND COALESCE(b."Activo", true)
   WHERE ub.usuario_id = v_u.usuario_id;

  RETURN jsonb_build_object(
    'usuario', jsonb_build_object('id', v_u.usuario_id, 'nombre', v_u.nombre, 'email', v_u.email),
    'bodegas', v_b);
END;
$function$;

-- ── Catálogo de productos (nombre del maestro + presentación derivada) ──
CREATE OR REPLACE FUNCTION public.bodega_productos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BodegaUsuarios" u WHERE u.usuario_id = auth.uid() AND u.activo) THEN
    RAISE EXCEPTION 'No tienes acceso.';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('producto', q.p, 'presentacion', public._bodega_presentacion(q.p)) ORDER BY q.p), '[]'::jsonb)
      FROM (SELECT DISTINCT public._kx_norm_prod(mp."Producto") AS p
              FROM maestro_productos mp WHERE btrim(COALESCE(mp."Producto", '')) <> '') q
  );
END;
$function$;

-- ── Existencias (solo producto terminado bueno; sin apartados) ──
CREATE OR REPLACE FUNCTION public.bodega_existencias(p_bodega bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('producto', s.producto, 'presentacion', s.presentacion, 'existencia', s.existencia)
                       ORDER BY s.producto)
        FROM public._bodega_saldos(p_bodega) s WHERE s.existencia <> 0), '[]'::jsonb),
    'en_transito_salida', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'traslado_id', t.id, 'consecutivo', t.consecutivo,
               'destino', bd."Nombre" || COALESCE(' · ' || NULLIF(bd."Municipio", ''), ''),
               'producto', m.producto, 'presentacion', m.presentacion, 'cantidad', m.cantidad)
             ORDER BY t.id, m.producto)
        FROM "BodegaTraslados" t
        JOIN "BodegaMovimientos" m ON m.traslado_id = t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
        JOIN "BodegasConsignacion" bd ON bd.id = t.bodega_destino
       WHERE t.bodega_origen = p_bodega AND t.estado = 'En tránsito'), '[]'::jsonb),
    'por_recibir_bodega', (SELECT count(*) FROM "BodegaTraslados" t WHERE t.bodega_destino = p_bodega AND t.estado = 'En tránsito'),
    'inicial_aplicado', public._bodega_tiene_inicial(p_bodega));
END;
$function$;

-- ── Por recibir de la principal ──
CREATE OR REPLACE FUNCTION public.bodega_traslados_pendientes(p_bodega bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  RETURN jsonb_build_object(
    'remisiones', COALESCE((
      SELECT jsonb_agg(q.r ORDER BY q.r->>'fecha', q.r->>'remision')
        FROM (
          SELECT jsonb_build_object(
                   'remision', p.remision,
                   'fecha', min(p.fecha),
                   'lineas', jsonb_agg(jsonb_build_object('producto', p.producto, 'presentacion', p.presentacion, 'cantidad', p.cantidad)
                                       ORDER BY p.producto)) AS r
            FROM public._bodega_pendientes(p_bodega) p
           GROUP BY p.remision
        ) q), '[]'::jsonb),
    'alertas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('remision', a.remision, 'producto', a.producto, 'cantidad', a.cantidad, 'fecha', a.fecha)
                       ORDER BY a.remision, a.producto)
        FROM public._bodega_alertas(p_bodega) a), '[]'::jsonb),
    'fecha_corte', v_cfg.fecha_corte);
END;
$function$;

-- ── Recibir una remisión de la principal (con lo REALMENTE recibido) ──
-- p_lineas = [{producto, cantidad}] y debe cubrir TODAS las líneas pendientes de esa remisión
-- (cantidad 0 = no llegó). Más de lo despachado, imposible. Con diferencia: observación obligatoria + aviso.
CREATE OR REPLACE FUNCTION public.bodega_recibir_traslado(p_bodega bigint, p_remision text, p_lineas jsonb, p_obs text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_rem    text := public._kx_trim(p_remision);
  v_obs    text := btrim(COALESCE(p_obs, ''));
  v_nombre text := public._bodega_actor_nombre();
  v_bnom   text;
  r        record;
  v_dif    boolean;
  v_det    text := '';
  v_n      integer := 0;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  PERFORM pg_advisory_xact_lock(74201, p_bodega::integer);
  IF v_rem = '' THEN RAISE EXCEPTION 'Falta la remisión.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public._bodega_pendientes(p_bodega) p WHERE p.remision = v_rem) THEN
    RAISE EXCEPTION 'La remisión % no está disponible para recibir (ya se recibió, se anuló o es anterior a la fecha de corte).', v_rem;
  END IF;

  IF EXISTS (SELECT 1 FROM public._bodega_lineas(p_lineas, true) ln
              WHERE NOT EXISTS (SELECT 1 FROM public._bodega_pendientes(p_bodega) p
                                 WHERE p.remision = v_rem AND upper(p.producto) = upper(ln.producto))) THEN
    RAISE EXCEPTION 'Hay productos que no pertenecen a la remisión %.', v_rem;
  END IF;

  FOR r IN
    SELECT p.producto, p.presentacion, p.cantidad AS desp, ln.cantidad AS rec
      FROM public._bodega_pendientes(p_bodega) p
      LEFT JOIN public._bodega_lineas(p_lineas, true) ln ON upper(ln.producto) = upper(p.producto)
     WHERE p.remision = v_rem
  LOOP
    IF r.rec IS NULL THEN RAISE EXCEPTION 'Falta indicar la cantidad recibida de %.', r.producto; END IF;
    IF r.rec > r.desp THEN
      RAISE EXCEPTION 'No puedes recibir más de lo despachado de % (despachado %, indicado %).', r.producto, r.desp, r.rec;
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM public._bodega_pendientes(p_bodega) p
      JOIN public._bodega_lineas(p_lineas, true) ln ON upper(ln.producto) = upper(p.producto)
     WHERE p.remision = v_rem AND ln.cantidad <> p.cantidad) INTO v_dif;
  IF v_dif AND length(v_obs) < 5 THEN
    RAISE EXCEPTION 'Hay diferencias con lo despachado: escribe una observación (mínimo 5 caracteres).';
  END IF;

  FOR r IN
    SELECT p.producto, p.presentacion, p.cantidad AS desp, ln.cantidad AS rec
      FROM public._bodega_pendientes(p_bodega) p
      JOIN public._bodega_lineas(p_lineas, true) ln ON upper(ln.producto) = upper(p.producto)
     WHERE p.remision = v_rem
     ORDER BY p.producto
  LOOP
    INSERT INTO "BodegaMovimientos"
      (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, origen_remision, cant_despachada,
       contraparte, observaciones, creado_por_nombre)
    VALUES
      (p_bodega, public._bodega_hoy(), 'ENTRADA_TRASLADO', public._bodega_nombre_canonico(r.producto), r.presentacion, r.rec, v_rem, v_rem, r.desp,
       'Principal', v_obs, v_nombre);
    v_n := v_n + 1;
    IF r.rec <> r.desp THEN
      v_det := v_det || CASE WHEN v_det = '' THEN '' ELSE '; ' END || r.producto || ' (despachado ' || r.desp || ', recibido ' || r.rec || ')';
    END IF;
  END LOOP;

  IF v_dif THEN
    SELECT b."Nombre" || COALESCE(' · ' || NULLIF(b."Municipio", ''), '') INTO v_bnom FROM "BodegasConsignacion" b WHERE b.id = p_bodega;
    PERFORM public._bodega_avisar(
      p_bodega,
      '⚠️ Recepción con diferencia: ' || v_cfg.codigo || ' · ' || v_rem,
      v_bnom || ' recibió la remisión ' || v_rem || ' con diferencias: ' || v_det || ' · Obs: ' || v_obs,
      v_rem);
  END IF;

  RETURN jsonb_build_object('remision', v_rem, 'lineas', v_n, 'con_diferencia', v_dif);
END;
$function$;

-- ── Salida / despacho desde la bodega (documento propio BOD-<COD>-RS-n) ──
-- Devuelve todo lo que el PDF necesita.
CREATE OR REPLACE FUNCTION public.bodega_registrar_salida(
  p_bodega bigint, p_destinatario text, p_lineas jsonb, p_obs text DEFAULT '', p_fecha date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_dest   text := btrim(COALESCE(p_destinatario, ''));
  v_obs    text := btrim(COALESCE(p_obs, ''));
  v_nombre text := public._bodega_actor_nombre();
  v_fecha  date;
  v_n      integer;
  v_doc    text;
  r        record;
  v_saldo  numeric;
  v_b      record;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  PERFORM pg_advisory_xact_lock(74201, p_bodega::integer);

  IF NOT public._bodega_tiene_inicial(p_bodega) THEN
    RAISE EXCEPTION 'Antes de registrar salidas la bodega debe aplicar su conteo inicial.';
  END IF;
  IF length(v_dest) < 3 THEN RAISE EXCEPTION 'Escribe el destinatario (mínimo 3 caracteres).'; END IF;
  v_fecha := COALESCE(p_fecha, public._bodega_hoy());
  IF v_fecha > public._bodega_hoy() THEN RAISE EXCEPTION 'La fecha de la salida no puede ser futura.'; END IF;
  IF v_fecha < v_cfg.fecha_corte THEN
    RAISE EXCEPTION 'La fecha de la salida no puede ser anterior a la fecha de corte (%).', to_char(v_cfg.fecha_corte, 'DD/MM/YYYY');
  END IF;

  FOR r IN SELECT * FROM public._bodega_lineas(p_lineas) LOOP
    v_saldo := public._bodega_saldo_de(p_bodega, r.producto);
    IF r.cantidad > v_saldo THEN
      RAISE EXCEPTION 'Existencia insuficiente de %: hay %, se piden %.', r.producto, v_saldo, r.cantidad;
    END IF;
  END LOOP;

  v_n   := public._bodega_siguiente(p_bodega, 'RS');
  v_doc := 'BOD-' || v_cfg.codigo || '-RS-' || lpad(v_n::text, 4, '0');

  INSERT INTO "BodegaMovimientos"
    (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, contraparte, observaciones, creado_por_nombre)
  SELECT p_bodega, v_fecha, 'SALIDA_DESPACHO', ln.producto,
         COALESCE((SELECT s.presentacion FROM public._bodega_saldos(p_bodega) s WHERE upper(s.producto) = upper(ln.producto) LIMIT 1), ln.presentacion),
         ln.cantidad, v_doc, v_dest, v_obs, v_nombre
    FROM public._bodega_lineas(p_lineas) ln;

  SELECT b."Nombre", b."Municipio", b."Departamento", b."Nombre_Empresa" INTO v_b
    FROM "BodegasConsignacion" b WHERE b.id = p_bodega;

  RETURN jsonb_build_object(
    'documento', v_doc, 'fecha', v_fecha, 'empresa', v_b."Nombre_Empresa",
    'bodega', jsonb_build_object('id', p_bodega, 'codigo', v_cfg.codigo, 'nombre', v_b."Nombre",
                                 'municipio', v_b."Municipio", 'departamento', v_b."Departamento"),
    'destinatario', v_dest, 'observaciones', v_obs, 'usuario', v_nombre,
    'lineas', (SELECT jsonb_agg(jsonb_build_object('producto', m.producto, 'presentacion', m.presentacion, 'cantidad', m.cantidad) ORDER BY m.id)
                 FROM "BodegaMovimientos" m WHERE m.bodega_id = p_bodega AND m.documento = v_doc AND m.tipo = 'SALIDA_DESPACHO'));
END;
$function$;

-- ── Conteos: guardar borrador (crea o reemplaza las líneas) ──
-- INICIAL: debe tener la fecha de corte de la bodega y solo hay uno aplicado.
-- PERIODICO: exige el inicial aplicado; los productos NO listados no se tocan.
CREATE OR REPLACE FUNCTION public.bodega_guardar_conteo(
  p_bodega bigint, p_conteo_id bigint, p_tipo text, p_fecha date, p_lineas jsonb, p_obs text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_c      public."BodegaConteos"%ROWTYPE;
  v_tipo   text := upper(btrim(COALESCE(p_tipo, '')));
  v_obs    text := btrim(COALESCE(p_obs, ''));
  v_nombre text := public._bodega_actor_nombre();
  v_id     bigint;
  r        record;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  PERFORM pg_advisory_xact_lock(74201, p_bodega::integer);

  IF v_tipo NOT IN ('INICIAL', 'PERIODICO') THEN RAISE EXCEPTION 'Tipo de conteo no válido.'; END IF;
  IF p_fecha IS NULL OR p_fecha > public._bodega_hoy() THEN RAISE EXCEPTION 'La fecha del conteo no puede ser futura.'; END IF;

  IF v_tipo = 'INICIAL' THEN
    IF public._bodega_tiene_inicial(p_bodega) THEN RAISE EXCEPTION 'Esta bodega ya tiene su conteo inicial aplicado.'; END IF;
    IF p_fecha <> v_cfg.fecha_corte THEN
      RAISE EXCEPTION 'El conteo inicial debe tener la fecha de corte de la bodega (%).', to_char(v_cfg.fecha_corte, 'DD/MM/YYYY');
    END IF;
  ELSE
    IF NOT public._bodega_tiene_inicial(p_bodega) THEN RAISE EXCEPTION 'Primero se debe aplicar el conteo inicial.'; END IF;
    IF p_fecha < v_cfg.fecha_corte THEN RAISE EXCEPTION 'La fecha del conteo no puede ser anterior a la fecha de corte.'; END IF;
  END IF;

  FOR r IN SELECT * FROM public._bodega_lineas(p_lineas, true) LOOP
    IF NOT EXISTS (SELECT 1 FROM maestro_productos mp WHERE upper(public._kx_norm_prod(mp."Producto")) = upper(r.producto)) THEN
      RAISE EXCEPTION 'El producto % no existe en el maestro de productos.', r.producto;
    END IF;
  END LOOP;

  IF p_conteo_id IS NULL THEN
    INSERT INTO "BodegaConteos" (bodega_id, fecha, tipo, observaciones, creado_por_nombre)
    VALUES (p_bodega, p_fecha, v_tipo, v_obs, v_nombre) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_c FROM "BodegaConteos" WHERE id = p_conteo_id AND bodega_id = p_bodega FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado.'; END IF;
    IF v_c.estado <> 'Borrador' THEN RAISE EXCEPTION 'Un conteo aplicado no se edita.'; END IF;
    IF v_c.tipo <> v_tipo THEN RAISE EXCEPTION 'No se puede cambiar el tipo de un conteo.'; END IF;
    UPDATE "BodegaConteos" SET fecha = p_fecha, observaciones = v_obs WHERE id = p_conteo_id;
    DELETE FROM "BodegaConteoLineas" WHERE conteo_id = p_conteo_id;
    v_id := p_conteo_id;
  END IF;

  INSERT INTO "BodegaConteoLineas" (conteo_id, producto, presentacion, cant_sistema, cant_fisica, creado_por_nombre)
  SELECT v_id, ln.producto, ln.presentacion,
         CASE WHEN v_tipo = 'PERIODICO' THEN public._bodega_saldo_de(p_bodega, ln.producto) ELSE 0 END,
         ln.cantidad, v_nombre
    FROM public._bodega_lineas(p_lineas, true) ln;

  RETURN jsonb_build_object('conteo_id', v_id);
END;
$function$;

-- ── Conteos: lista (sin p_conteo_id) o detalle de uno ──
CREATE OR REPLACE FUNCTION public.bodega_conteos(p_bodega bigint, p_conteo_id bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
  v_c   public."BodegaConteos"%ROWTYPE;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);

  IF p_conteo_id IS NULL THEN
    RETURN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'fecha', c.fecha, 'tipo', c.tipo, 'estado', c.estado, 'observaciones', c.observaciones,
               'creado_por_nombre', c.creado_por_nombre, 'aplicado_en', c.aplicado_en,
               'lineas', (SELECT count(*) FROM "BodegaConteoLineas" l WHERE l.conteo_id = c.id),
               'diferencias', (SELECT count(*) FROM "BodegaConteoLineas" l WHERE l.conteo_id = c.id AND l.diferencia <> 0 AND c.tipo = 'PERIODICO'))
             ORDER BY c.id DESC)
        FROM (SELECT * FROM "BodegaConteos" WHERE bodega_id = p_bodega ORDER BY id DESC LIMIT 60) c), '[]'::jsonb);
  END IF;

  SELECT * INTO v_c FROM "BodegaConteos" WHERE id = p_conteo_id AND bodega_id = p_bodega;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado.'; END IF;
  RETURN jsonb_build_object(
    'conteo', jsonb_build_object('id', v_c.id, 'fecha', v_c.fecha, 'tipo', v_c.tipo, 'estado', v_c.estado,
                                 'observaciones', v_c.observaciones, 'aplicado_en', v_c.aplicado_en),
    'lineas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'producto', l.producto, 'presentacion', l.presentacion, 'cant_fisica', l.cant_fisica,
               'cant_sistema', CASE WHEN v_c.estado = 'Borrador' AND v_c.tipo = 'PERIODICO'
                                    THEN public._bodega_saldo_de(p_bodega, l.producto) ELSE l.cant_sistema END)
             ORDER BY l.producto)
        FROM "BodegaConteoLineas" l WHERE l.conteo_id = v_c.id), '[]'::jsonb));
END;
$function$;

-- ── Conteos: aplicar (INICIAL → SALDO_INICIAL; PERIODICO → ajustes por la diferencia vs el sistema actual) ──
CREATE OR REPLACE FUNCTION public.bodega_aplicar_conteo(p_conteo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c      public."BodegaConteos"%ROWTYPE;
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_nombre text := public._bodega_actor_nombre();
  r        record;
  v_sis    numeric;
  v_dif    numeric;
  v_mov    integer := 0;
  v_sob    integer := 0;
  v_fal    integer := 0;
BEGIN
  SELECT * INTO v_c FROM "BodegaConteos" WHERE id = p_conteo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado.'; END IF;
  v_cfg := public._bodega_acceso(v_c.bodega_id);
  PERFORM pg_advisory_xact_lock(74201, v_c.bodega_id::integer);

  IF v_c.estado <> 'Borrador' THEN RAISE EXCEPTION 'Este conteo ya fue aplicado.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "BodegaConteoLineas" l WHERE l.conteo_id = v_c.id) THEN
    RAISE EXCEPTION 'El conteo no tiene líneas.';
  END IF;

  IF v_c.tipo = 'INICIAL' THEN
    IF public._bodega_tiene_inicial(v_c.bodega_id) THEN RAISE EXCEPTION 'Esta bodega ya tiene su conteo inicial aplicado.'; END IF;
    IF v_c.fecha <> v_cfg.fecha_corte THEN
      RAISE EXCEPTION 'La fecha del conteo (%) ya no coincide con la fecha de corte de la bodega (%).',
        to_char(v_c.fecha, 'DD/MM/YYYY'), to_char(v_cfg.fecha_corte, 'DD/MM/YYYY');
    END IF;
    INSERT INTO "BodegaMovimientos"
      (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, contraparte, conteo_id, creado_por_nombre)
    SELECT v_c.bodega_id, v_c.fecha, 'SALDO_INICIAL', l.producto, l.presentacion, l.cant_fisica,
           'CONTEO-' || v_c.id, 'Conteo inicial', v_c.id, v_nombre
      FROM "BodegaConteoLineas" l WHERE l.conteo_id = v_c.id AND l.cant_fisica > 0;
    GET DIAGNOSTICS v_mov = ROW_COUNT;
  ELSE
    IF NOT public._bodega_tiene_inicial(v_c.bodega_id) THEN RAISE EXCEPTION 'Primero se debe aplicar el conteo inicial.'; END IF;
    FOR r IN SELECT * FROM "BodegaConteoLineas" WHERE conteo_id = v_c.id ORDER BY id LOOP
      v_sis := public._bodega_saldo_de(v_c.bodega_id, r.producto);
      UPDATE "BodegaConteoLineas" SET cant_sistema = v_sis WHERE id = r.id;
      v_dif := r.cant_fisica - v_sis;
      IF v_dif <> 0 THEN
        INSERT INTO "BodegaMovimientos"
          (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, contraparte, observaciones, conteo_id, creado_por_nombre)
        VALUES
          (v_c.bodega_id, v_c.fecha, CASE WHEN v_dif > 0 THEN 'AJUSTE_SOBRANTE' ELSE 'AJUSTE_FALTANTE' END,
           r.producto, r.presentacion, abs(v_dif), 'CONTEO-' || v_c.id, 'Conteo periódico',
           'Sistema ' || v_sis || ' · físico ' || r.cant_fisica, v_c.id, v_nombre);
        v_mov := v_mov + 1;
        IF v_dif > 0 THEN v_sob := v_sob + 1; ELSE v_fal := v_fal + 1; END IF;
      END IF;
    END LOOP;
  END IF;

  UPDATE "BodegaConteos"
     SET estado = 'Aplicado', aplicado_por = auth.uid(), aplicado_por_nombre = v_nombre, aplicado_en = now()
   WHERE id = v_c.id;

  RETURN jsonb_build_object('conteo_id', v_c.id, 'tipo', v_c.tipo, 'movimientos', v_mov, 'sobrantes', v_sob, 'faltantes', v_fal);
END;
$function$;

-- ── Anular un documento de salida completo (todas sus líneas) ──
CREATE OR REPLACE FUNCTION public.bodega_anular_documento(p_bodega bigint, p_documento text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_mot    text := btrim(COALESCE(p_motivo, ''));
  v_nombre text := public._bodega_actor_nombre();
  v_n      integer;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  PERFORM pg_advisory_xact_lock(74201, p_bodega::integer);
  IF length(v_mot) < 5 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación (mínimo 5 caracteres).'; END IF;

  UPDATE "BodegaMovimientos"
     SET estado = 'Anulado', motivo_anulacion = v_mot, anulado_por = auth.uid(), anulado_por_nombre = v_nombre, anulado_en = now()
   WHERE bodega_id = p_bodega AND documento = btrim(p_documento) AND tipo = 'SALIDA_DESPACHO' AND estado = 'Activo';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'No hay una salida activa con el documento %.', p_documento; END IF;
  RETURN jsonb_build_object('documento', btrim(p_documento), 'lineas_anuladas', v_n);
END;
$function$;

-- ── Anular un ajuste (los demás movimientos se corrigen con conteo/ajuste o cancelando el traslado) ──
CREATE OR REPLACE FUNCTION public.bodega_anular_movimiento(p_id bigint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m      public."BodegaMovimientos"%ROWTYPE;
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_mot    text := btrim(COALESCE(p_motivo, ''));
  v_nombre text := public._bodega_actor_nombre();
BEGIN
  SELECT * INTO v_m FROM "BodegaMovimientos" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado.'; END IF;
  v_cfg := public._bodega_acceso(v_m.bodega_id);
  PERFORM pg_advisory_xact_lock(74201, v_m.bodega_id::integer);

  IF length(v_mot) < 5 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación (mínimo 5 caracteres).'; END IF;
  IF v_m.estado <> 'Activo' THEN RAISE EXCEPTION 'El movimiento ya está anulado.'; END IF;
  IF v_m.tipo NOT IN ('AJUSTE_SOBRANTE', 'AJUSTE_FALTANTE') THEN
    RAISE EXCEPTION 'Este tipo de movimiento no se anula (%). Las salidas se anulan por documento; lo demás se corrige con un conteo o ajuste.', v_m.tipo;
  END IF;
  IF v_m.tipo = 'AJUSTE_SOBRANTE' AND public._bodega_saldo_de(v_m.bodega_id, v_m.producto) < v_m.cantidad THEN
    RAISE EXCEPTION 'No se puede anular: la existencia de % quedaría negativa.', v_m.producto;
  END IF;

  UPDATE "BodegaMovimientos"
     SET estado = 'Anulado', motivo_anulacion = v_mot, anulado_por = auth.uid(), anulado_por_nombre = v_nombre, anulado_en = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$function$;

-- ── Kardex: movimientos con saldo corrido por producto ──
CREATE OR REPLACE FUNCTION public.bodega_kardex(
  p_bodega bigint, p_producto text DEFAULT NULL, p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL,
  p_incluir_anulados boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.fecha, x.id)
      FROM (
        SELECT y.* FROM (
          SELECT m.id, m.fecha, m.tipo, m.producto, m.presentacion, m.cantidad, m.documento, m.origen_remision,
                 m.cant_despachada, m.contraparte, m.observaciones, m.estado, m.motivo_anulacion,
                 m.traslado_id, m.conteo_id, m.creado_por_nombre,
                 public._bodega_signo(m.tipo) AS signo,
                 SUM(CASE WHEN m.estado = 'Activo' THEN public._bodega_signo(m.tipo) * m.cantidad ELSE 0 END)
                   OVER (PARTITION BY upper(m.producto) ORDER BY m.fecha, m.id ROWS UNBOUNDED PRECEDING) AS saldo
            FROM "BodegaMovimientos" m
           WHERE m.bodega_id = p_bodega
        ) y
        WHERE (p_producto IS NULL OR upper(y.producto) = upper(public._kx_norm_prod(p_producto)))
          AND (p_desde IS NULL OR y.fecha >= p_desde)
          AND (p_hasta IS NULL OR y.fecha <= p_hasta)
          AND (p_incluir_anulados OR y.estado = 'Activo')
      ) x), '[]'::jsonb);
END;
$function$;


-- ════════════════ PERMISOS ════════════════
-- Las bodega_* las ejecuta cualquier sesión (la guarda está dentro del cuerpo); las _bodega_* nadie.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.proname LIKE 'bodega\_%' OR p.proname LIKE '\_bodega\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF left(r.proname, 1) = '_' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END
$$;
