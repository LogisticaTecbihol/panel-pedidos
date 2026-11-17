-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite / consignación — PARTE 4 de 5: traslados ENTRE bodegas satélite (fase 1b)
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere: bodega_satelite_tablas / avisos / nucleo.
--
-- QUÉ HACE: pasar mercancía de una bodega satélite a otra de la MISMA empresa, dentro del libro
-- Bodega*; no pasa por Pedidos ni por OrdenesCompra y no toca nada de la principal.
--   • Van EN TRÁNSITO: al enviar baja el origen (SALIDA_TRASLADO_BODEGA); el usuario del destino
--     confirma lo realmente recibido y solo entonces suma (ENTRADA_TRASLADO_BODEGA).
--   • Lo que está en tránsito no está en ninguna existencia (se muestra aparte, informativo).
--   • Recibir con diferencia: observación obligatoria, el traslado queda «Recibido con diferencia»
--     y se avisa a la principal (campanita). Nada se reparte ni se reversa solo: lo corrige quien
--     corresponda con un ajuste tras investigar.
--   • Cancelar: solo el ORIGEN y solo EN TRÁNSITO; devuelve el stock al origen.
--   • Entre empresas distintas: rechazado (función y trigger de BodegaTraslados); eso sigue
--     haciéndose por la principal con una OC de traslado.
--   • Ambas bodegas deben tener el conteo inicial aplicado.
--   • Bloqueo de ambas bodegas en orden de id (dos traslados cruzados A→B y B→A no se interbloquean).
--
-- RPC: bodega_destinos, bodega_crear_traslado_bodega, bodega_recibir_traslado_bodega,
--      bodega_cancelar_traslado_bodega, bodega_traslados_bodega.
--
-- Idempotente. Rollback: bodega_satelite_traslados_bodega_rollback.sql.
-- Fecha: 2026-11-17
-- ════════════════════════════════════════════════════════════════════════════

-- Un traslado como jsonb (con sus líneas: lo enviado y lo recibido).
CREATE OR REPLACE FUNCTION public._bodega_traslado_json(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', t.id, 'consecutivo', t.consecutivo, 'fecha', t.fecha, 'estado', t.estado, 'observaciones', t.observaciones,
    'origen',  jsonb_build_object('id', t.bodega_origen,  'codigo', co.codigo, 'nombre', bo."Nombre", 'municipio', bo."Municipio", 'departamento', bo."Departamento"),
    'destino', jsonb_build_object('id', t.bodega_destino, 'codigo', cd.codigo, 'nombre', bd."Nombre", 'municipio', bd."Municipio", 'departamento', bd."Departamento"),
    'empresa', bo."Nombre_Empresa",
    'enviado_por_nombre', t.enviado_por_nombre, 'enviado_en', t.enviado_en,
    'recibido_por_nombre', t.recibido_por_nombre, 'recibido_en', t.recibido_en, 'obs_recepcion', t.obs_recepcion,
    'cancelado_por_nombre', t.cancelado_por_nombre, 'cancelado_en', t.cancelado_en, 'motivo_cancelacion', t.motivo_cancelacion,
    'lineas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('producto', x.producto, 'presentacion', x.presentacion,
                                          'enviada', x.enviada, 'recibida', x.recibida) ORDER BY x.producto)
        FROM (
          SELECT public._bodega_nombre_canonico(min(m.producto)) AS producto, min(m.presentacion) AS presentacion,
                 COALESCE(sum(m.cantidad) FILTER (WHERE m.tipo = 'SALIDA_TRASLADO_BODEGA'), 0) AS enviada,
                 COALESCE(sum(m.cantidad) FILTER (WHERE m.tipo = 'ENTRADA_TRASLADO_BODEGA' AND m.estado = 'Activo'), 0) AS recibida
            FROM "BodegaMovimientos" m
           WHERE m.traslado_id = t.id
           GROUP BY upper(m.producto)
        ) x), '[]'::jsonb))
    FROM "BodegaTraslados" t
    JOIN "BodegaConfig" co ON co.bodega_id = t.bodega_origen
    JOIN "BodegasConsignacion" bo ON bo.id = t.bodega_origen
    JOIN "BodegaConfig" cd ON cd.bodega_id = t.bodega_destino
    JOIN "BodegasConsignacion" bd ON bd.id = t.bodega_destino
   WHERE t.id = p_id
$function$;

-- Bodegas a las que esta bodega puede trasladar (habilitadas, activas y de la MISMA empresa).
CREATE OR REPLACE FUNCTION public.bodega_destinos(p_bodega bigint)
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
    SELECT jsonb_agg(jsonb_build_object('bodega_id', c.bodega_id, 'codigo', c.codigo, 'nombre', b."Nombre",
                                        'municipio', b."Municipio", 'inicial_aplicado', public._bodega_tiene_inicial(c.bodega_id))
                     ORDER BY b."Nombre", b."Municipio", c.bodega_id)
      FROM "BodegaConfig" c
      JOIN "BodegasConsignacion" b  ON b.id = c.bodega_id AND COALESCE(b."Activo", true)
      JOIN "BodegasConsignacion" bo ON bo.id = p_bodega
     WHERE c.habilitada AND c.bodega_id <> p_bodega AND btrim(b."Nombre_Empresa") = btrim(bo."Nombre_Empresa")), '[]'::jsonb);
END;
$function$;

-- Enviar: baja el origen y deja el traslado EN TRÁNSITO. Devuelve los datos para el PDF.
CREATE OR REPLACE FUNCTION public.bodega_crear_traslado_bodega(
  p_origen bigint, p_destino bigint, p_lineas jsonb, p_obs text DEFAULT '', p_fecha date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o      public."BodegaConfig"%ROWTYPE;
  v_d      public."BodegaConfig"%ROWTYPE;
  v_obs    text := btrim(COALESCE(p_obs, ''));
  v_nombre text := public._bodega_actor_nombre();
  v_fecha  date;
  v_n      integer;
  v_cons   text;
  v_id     bigint;
  v_dnom   text;
  v_emp_o  text;
  v_emp_d  text;
  r        record;
  v_saldo  numeric;
BEGIN
  v_o := public._bodega_acceso(p_origen);
  IF p_destino IS NULL OR p_destino = p_origen THEN RAISE EXCEPTION 'Elige una bodega de destino distinta del origen.'; END IF;

  PERFORM pg_advisory_xact_lock(74201, LEAST(p_origen, p_destino)::integer);
  PERFORM pg_advisory_xact_lock(74201, GREATEST(p_origen, p_destino)::integer);

  SELECT c.* INTO v_d FROM "BodegaConfig" c JOIN "BodegasConsignacion" b ON b.id = c.bodega_id
   WHERE c.bodega_id = p_destino AND c.habilitada AND COALESCE(b."Activo", true);
  IF NOT FOUND THEN RAISE EXCEPTION 'La bodega de destino no está habilitada.'; END IF;

  SELECT btrim("Nombre_Empresa") INTO v_emp_o FROM "BodegasConsignacion" WHERE id = p_origen;
  SELECT btrim("Nombre_Empresa"), "Nombre" || COALESCE(' · ' || NULLIF("Municipio", ''), '') INTO v_emp_d, v_dnom
    FROM "BodegasConsignacion" WHERE id = p_destino;
  IF v_emp_o IS DISTINCT FROM v_emp_d THEN
    RAISE EXCEPTION 'Solo se puede trasladar entre bodegas de la misma empresa. Para pasar mercancía a otra empresa usa la principal (orden de compra de traslado).';
  END IF;

  IF NOT public._bodega_tiene_inicial(p_origen)  THEN RAISE EXCEPTION 'La bodega de origen debe aplicar primero su conteo inicial.'; END IF;
  IF NOT public._bodega_tiene_inicial(p_destino) THEN RAISE EXCEPTION 'La bodega de destino todavía no tiene su conteo inicial aplicado.'; END IF;

  v_fecha := COALESCE(p_fecha, public._bodega_hoy());
  IF v_fecha > public._bodega_hoy() THEN RAISE EXCEPTION 'La fecha del traslado no puede ser futura.'; END IF;
  IF v_fecha < v_o.fecha_corte THEN
    RAISE EXCEPTION 'La fecha del traslado no puede ser anterior a la fecha de corte (%).', to_char(v_o.fecha_corte, 'DD/MM/YYYY');
  END IF;

  FOR r IN SELECT * FROM public._bodega_lineas(p_lineas) LOOP
    v_saldo := public._bodega_saldo_de(p_origen, r.producto);
    IF r.cantidad > v_saldo THEN
      RAISE EXCEPTION 'Existencia insuficiente de %: hay %, se piden %.', r.producto, v_saldo, r.cantidad;
    END IF;
  END LOOP;

  v_n    := public._bodega_siguiente(p_origen, 'TR');
  v_cons := 'BOD-' || v_o.codigo || '-TR-' || lpad(v_n::text, 4, '0');

  INSERT INTO "BodegaTraslados"
    (consecutivo, bodega_origen, bodega_destino, fecha, observaciones, enviado_por, enviado_por_nombre, creado_por_nombre)
  VALUES (v_cons, p_origen, p_destino, v_fecha, v_obs, auth.uid(), v_nombre, v_nombre)
  RETURNING id INTO v_id;

  INSERT INTO "BodegaMovimientos"
    (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, contraparte, observaciones, traslado_id, creado_por_nombre)
  SELECT p_origen, v_fecha, 'SALIDA_TRASLADO_BODEGA', ln.producto,
         COALESCE((SELECT s.presentacion FROM public._bodega_saldos(p_origen) s WHERE upper(s.producto) = upper(ln.producto) LIMIT 1), ln.presentacion),
         ln.cantidad, v_cons, v_dnom, v_obs, v_id, v_nombre
    FROM public._bodega_lineas(p_lineas) ln;

  RETURN public._bodega_traslado_json(v_id) || jsonb_build_object('usuario', v_nombre);
END;
$function$;

-- Recibir: solo usuarios del DESTINO, solo si sigue en tránsito, con lo realmente recibido
-- (p_lineas = [{producto, cantidad}] para TODAS las líneas; 0 = no llegó; más de lo enviado, imposible).
CREATE OR REPLACE FUNCTION public.bodega_recibir_traslado_bodega(p_traslado_id bigint, p_lineas jsonb, p_obs text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t      public."BodegaTraslados"%ROWTYPE;
  v_d      public."BodegaConfig"%ROWTYPE;
  v_obs    text := btrim(COALESCE(p_obs, ''));
  v_nombre text := public._bodega_actor_nombre();
  r        record;
  v_dif    boolean;
  v_det    text := '';
  v_onom   text;
  v_dnom   text;
BEGIN
  SELECT * INTO v_t FROM "BodegaTraslados" WHERE id = p_traslado_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traslado no encontrado.'; END IF;
  v_d := public._bodega_acceso(v_t.bodega_destino);
  PERFORM pg_advisory_xact_lock(74201, LEAST(v_t.bodega_origen, v_t.bodega_destino)::integer);
  PERFORM pg_advisory_xact_lock(74201, GREATEST(v_t.bodega_origen, v_t.bodega_destino)::integer);

  IF v_t.estado <> 'En tránsito' THEN
    RAISE EXCEPTION 'El traslado % ya está en estado «%»: no se puede recibir.', v_t.consecutivo, v_t.estado;
  END IF;

  IF EXISTS (SELECT 1 FROM public._bodega_lineas(p_lineas, true) ln
              WHERE NOT EXISTS (SELECT 1 FROM "BodegaMovimientos" m
                                 WHERE m.traslado_id = v_t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
                                   AND upper(m.producto) = upper(ln.producto))) THEN
    RAISE EXCEPTION 'Hay productos que no pertenecen al traslado %.', v_t.consecutivo;
  END IF;

  FOR r IN
    SELECT public._bodega_nombre_canonico(min(m.producto)) AS producto, min(m.presentacion) AS presentacion,
           sum(m.cantidad) AS enviada, max(ln.cantidad) AS rec
      FROM "BodegaMovimientos" m
      LEFT JOIN public._bodega_lineas(p_lineas, true) ln ON upper(ln.producto) = upper(m.producto)
     WHERE m.traslado_id = v_t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
     GROUP BY upper(m.producto)
  LOOP
    IF r.rec IS NULL THEN RAISE EXCEPTION 'Falta indicar la cantidad recibida de %.', r.producto; END IF;
    IF r.rec > r.enviada THEN
      RAISE EXCEPTION 'No puedes recibir más de lo enviado de % (enviado %, indicado %).', r.producto, r.enviada, r.rec;
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM (SELECT upper(m.producto) AS k, sum(m.cantidad) AS enviada
                     FROM "BodegaMovimientos" m
                    WHERE m.traslado_id = v_t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
                    GROUP BY upper(m.producto)) e
      JOIN public._bodega_lineas(p_lineas, true) ln ON upper(ln.producto) = e.k
     WHERE ln.cantidad <> e.enviada) INTO v_dif;
  IF v_dif AND length(v_obs) < 5 THEN
    RAISE EXCEPTION 'Hay diferencias con lo enviado: escribe una observación (mínimo 5 caracteres).';
  END IF;

  SELECT bo."Nombre" || COALESCE(' · ' || NULLIF(bo."Municipio", ''), ''), bd."Nombre" || COALESCE(' · ' || NULLIF(bd."Municipio", ''), '')
    INTO v_onom, v_dnom
    FROM "BodegasConsignacion" bo, "BodegasConsignacion" bd WHERE bo.id = v_t.bodega_origen AND bd.id = v_t.bodega_destino;

  FOR r IN
    SELECT public._bodega_nombre_canonico(min(m.producto)) AS producto, min(m.presentacion) AS presentacion,
           sum(m.cantidad) AS enviada, max(ln.cantidad) AS rec
      FROM "BodegaMovimientos" m
      JOIN public._bodega_lineas(p_lineas, true) ln ON upper(ln.producto) = upper(m.producto)
     WHERE m.traslado_id = v_t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
     GROUP BY upper(m.producto)
     ORDER BY 1
  LOOP
    INSERT INTO "BodegaMovimientos"
      (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, cant_despachada, contraparte, observaciones,
       traslado_id, creado_por_nombre)
    VALUES
      (v_t.bodega_destino, public._bodega_hoy(), 'ENTRADA_TRASLADO_BODEGA', r.producto, r.presentacion, r.rec,
       v_t.consecutivo, r.enviada, v_onom, v_obs, v_t.id, v_nombre);
    IF r.rec <> r.enviada THEN
      v_det := v_det || CASE WHEN v_det = '' THEN '' ELSE '; ' END || r.producto || ' (enviado ' || r.enviada || ', recibido ' || r.rec || ')';
    END IF;
  END LOOP;

  UPDATE "BodegaTraslados"
     SET estado = CASE WHEN v_dif THEN 'Recibido con diferencia' ELSE 'Recibido' END,
         recibido_por = auth.uid(), recibido_por_nombre = v_nombre, recibido_en = now(),
         obs_recepcion = NULLIF(v_obs, '')
   WHERE id = v_t.id;

  IF v_dif THEN
    PERFORM public._bodega_avisar(
      v_t.bodega_destino,
      '⚠️ Traslado entre bodegas con diferencia: ' || v_t.consecutivo,
      v_dnom || ' recibió de ' || v_onom || ' el traslado ' || v_t.consecutivo || ' con diferencias: ' || v_det || ' · Obs: ' || v_obs,
      v_t.consecutivo);
  END IF;

  RETURN public._bodega_traslado_json(v_t.id) || jsonb_build_object('con_diferencia', v_dif);
END;
$function$;

-- Cancelar: solo el ORIGEN y solo EN TRÁNSITO. Anula las salidas y el stock vuelve al origen.
CREATE OR REPLACE FUNCTION public.bodega_cancelar_traslado_bodega(p_traslado_id bigint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t      public."BodegaTraslados"%ROWTYPE;
  v_o      public."BodegaConfig"%ROWTYPE;
  v_mot    text := btrim(COALESCE(p_motivo, ''));
  v_nombre text := public._bodega_actor_nombre();
BEGIN
  SELECT * INTO v_t FROM "BodegaTraslados" WHERE id = p_traslado_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traslado no encontrado.'; END IF;
  v_o := public._bodega_acceso(v_t.bodega_origen);
  PERFORM pg_advisory_xact_lock(74201, LEAST(v_t.bodega_origen, v_t.bodega_destino)::integer);
  PERFORM pg_advisory_xact_lock(74201, GREATEST(v_t.bodega_origen, v_t.bodega_destino)::integer);

  IF v_t.estado <> 'En tránsito' THEN
    RAISE EXCEPTION 'El traslado % ya está en estado «%»: no se puede cancelar.', v_t.consecutivo, v_t.estado;
  END IF;
  IF length(v_mot) < 5 THEN RAISE EXCEPTION 'Escribe el motivo de la cancelación (mínimo 5 caracteres).'; END IF;

  UPDATE "BodegaMovimientos"
     SET estado = 'Anulado', motivo_anulacion = 'Traslado cancelado: ' || v_mot,
         anulado_por = auth.uid(), anulado_por_nombre = v_nombre, anulado_en = now()
   WHERE traslado_id = v_t.id AND tipo = 'SALIDA_TRASLADO_BODEGA' AND estado = 'Activo';

  UPDATE "BodegaTraslados"
     SET estado = 'Cancelado', cancelado_por = auth.uid(), cancelado_por_nombre = v_nombre, cancelado_en = now(),
         motivo_cancelacion = v_mot
   WHERE id = v_t.id;

  RETURN public._bodega_traslado_json(v_t.id);
END;
$function$;

-- Lista: lo que esta bodega ENVIÓ y lo que le ENVIARON (últimos 100 de cada lado).
CREATE OR REPLACE FUNCTION public.bodega_traslados_bodega(p_bodega bigint)
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
    'enviados', COALESCE((
      SELECT jsonb_agg(public._bodega_traslado_json(q.id) ORDER BY q.id DESC)
        FROM (SELECT id FROM "BodegaTraslados" WHERE bodega_origen = p_bodega ORDER BY id DESC LIMIT 100) q), '[]'::jsonb),
    'recibidos', COALESCE((
      SELECT jsonb_agg(public._bodega_traslado_json(q.id) ORDER BY q.id DESC)
        FROM (SELECT id FROM "BodegaTraslados" WHERE bodega_destino = p_bodega ORDER BY id DESC LIMIT 100) q), '[]'::jsonb));
END;
$function$;


-- ════════════════ PERMISOS ════════════════
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
