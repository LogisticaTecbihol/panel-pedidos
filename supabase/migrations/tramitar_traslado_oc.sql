-- ════════════════════════════════════════════════════════════════════════════
-- OC de traslado «DIFERIDAS» (parte 2 de 3): RPC que las tramita al remisionar el pedido.
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere oc_traslado_diferido.sql (columnas y candados). Inerte hasta que alguna OC tenga
-- Traslado_Diferido = true y el frontend lo llame.
--
-- Funciones:
--   _remision_siguiente(empresa, tipo)  → consecutivo RE/RS SIN el guard de empresa de
--        generar_remision (que exige user_has_company del origen: un editor de una sola empresa no
--        podría remisionar con una OC de otra empresa). Mismo cuerpo, mismo contador. Interna.
--   _oc_avisar_tramite(...)             → aviso «📦 OC legalizada … · <RE>» a contabilidad de las
--        dos empresas, uno por pasada (el título lleva el RE, así el dedupe no lo confunde). Interna.
--   tramitar_traslado_oc(jsonb)         → interna (solo la llama guardar_pedido_con_traslados).
--        Payload {fecha:'YYYY-MM-DD', remision_pedido:'<n.º>', lineas:[{pedido_id, cantidad}]}.
--        Por línea de pedido reparte la cantidad entre sus OC diferidas APROBADAS y pendientes
--        (FIFO por id) y, por cada (Consecutivo, origen, destino) tocado, genera UN par RE/RS.
--        Si la cantidad toma toda la fila, la actualiza en sitio (Remision, Remision_Origen,
--        Fecha = día de la remisión del pedido, Estado='Cerrada'); si no, baja la Cantidad del
--        remanente (que sigue Abierto y apartando) e inserta una PIEZA Cerrada con las
--        remisiones, copiando aprobación/creador/bonificado, con Traslado_Padre_Id.
--        Atómica y con las filas bloqueadas (advisory lock por línea + FOR UPDATE ORDER BY id,
--        mismo orden que la cascada del pedido). Valida rol, empresa, estado del pedido,
--        cantidades enteras y ≤ lo pendiente de la línea y ≤ lo entregable por las OC.
--        Devuelve {pares:[{consecutivo,origen,destino,re,rs,cantidad,ref}],
--                  piezas:[{oc_id,pedido_id,cantidad,consecutivo,remision_re,remision_rs}],
--                  por_linea:{"<pedido_id>":[{oc_id,cantidad,remision_re,remision_rs}]}}.
--   guardar_pedido_con_traslados(p_header, p_lineas, p_delete_ids, p_tramite) → es lo que llama
--        el navegador (editarPedido): tramita y luego escribe el pedido con editar_pedido_completo,
--        TODO en una transacción (si falla algo se revierten también los consecutivos RE/RS).
--        Comprueba que el pedido registró de verdad la entrega (Cant_Entregada subió al menos lo
--        tramitado): un traslado jamás se mueve sin remisión del pedido. Con p_tramite vacío es
--        igual a editar_pedido_completo. Devuelve su resultado más la clave «tramite».
--
-- Se separa el envoltorio y no se añade un parámetro a editar_pedido_completo porque una
-- sobrecarga con un parámetro con default quedaría ambigua en PostgREST.
--
-- Idempotente. Rollback: tramitar_traslado_oc_rollback.sql.
-- Aplicar con apply_migration del MCP de Supabase ANTES de publicar el código.
-- Fecha: 2026-11-11
-- ════════════════════════════════════════════════════════════════════════════

-- ── _remision_siguiente ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._remision_siguiente(p_empresa_nombre text, p_tipo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla TEXT;
  v_nuevo_numero INT;
  v_sufijo TEXT;
BEGIN
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
    RAISE EXCEPTION 'Empresa no reconocida: %', p_empresa_nombre;
  END IF;

  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo invalido: %. Debe ser ENTRADA o SALIDA', p_tipo;
  END IF;

  v_sufijo := CASE WHEN p_tipo = 'ENTRADA' THEN 'RE' ELSE 'RS' END;

  UPDATE "consecutivos_remisiones"
  SET ultimo_numero = ultimo_numero + 1
  WHERE empresa = v_sigla AND tipo = p_tipo
  RETURNING ultimo_numero INTO v_nuevo_numero;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consecutivo no encontrado para empresa=%, tipo=%', v_sigla, p_tipo;
  END IF;

  RETURN v_sigla || '-' || v_sufijo || '-' || LPAD(v_nuevo_numero::TEXT, 4, '0');
END;
$function$;

-- ── _oc_avisar_tramite ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._oc_avisar_tramite(
  p_destino text, p_origen text, p_consecutivo text, p_re text, p_rs text,
  p_cantidad numeric, p_ref text, p_remision_pedido text, p_actor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sd     text;
  v_so     text;
  v_titulo text;
  v_msg    text;
  v_ins    integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_consecutivo, '')), '') IS NULL THEN RETURN 0; END IF;

  v_sd := COALESCE((SELECT sigla FROM empresas WHERE nombre_completo = p_destino OR sigla = p_destino LIMIT 1), p_destino, '?');
  v_so := COALESCE((SELECT sigla FROM empresas WHERE nombre_completo = p_origen  OR sigla = p_origen  LIMIT 1), p_origen,  '?');

  v_titulo := '📦 OC legalizada: ' || v_sd || ' ← ' || v_so || ' #' || p_consecutivo || ' · ' || COALESCE(p_re, '');
  v_msg    := p_cantidad || ' ud' ||
              COALESCE(' · Ref: ' || NULLIF(btrim(COALESCE(p_ref, '')), ''), '') ||
              COALESCE(' · Remisión entrada: ' || NULLIF(p_re, ''), '') ||
              COALESCE(' · Remisión salida: ' || NULLIF(p_rs, ''), '') ||
              ' · Se legalizó sola al remisionar el pedido' ||
              COALESCE(' (' || NULLIF(btrim(COALESCE(p_remision_pedido, '')), '') || ')', '');

  INSERT INTO notificaciones (para_usuario_id, de_usuario_id, modulo, referencia, titulo, mensaje, storage_path)
  SELECT d.usuario_id,
         (SELECT u.id FROM usuarios u WHERE u.id = p_actor),
         'ordenes', p_consecutivo, v_titulo, v_msg, NULL
    FROM public._oc_contabilidad_destinatarios(p_destino, p_origen) d
   WHERE d.usuario_id IS DISTINCT FROM p_actor;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN v_ins;
END;
$function$;

-- ── tramitar_traslado_oc ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tramitar_traslado_oc(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_role     text := public.get_user_role();
  v_fecha    text;
  v_remped   text;
  v_lin      record;
  v_ped      record;
  v_oc       record;
  v_need     numeric;
  v_take     numeric;
  v_key      text;
  v_re       text;
  v_rs       text;
  v_obs      text;
  v_piece_id bigint;
  v_pares    jsonb := '{}'::jsonb;
  v_piezas   jsonb := '[]'::jsonb;
  v_porlinea jsonb := '{}'::jsonb;
  v_par      record;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL
     OR NOT (v_role = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- ── Payload ──
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'tramitar_traslado_oc: el payload debe ser un objeto';
  END IF;
  v_fecha := p->>'fecha';
  IF v_fecha IS NULL OR v_fecha !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'tramitar_traslado_oc: fecha inválida (se espera YYYY-MM-DD)';
  END IF;
  PERFORM v_fecha::date;  -- falla si no es una fecha real
  v_remped := COALESCE(NULLIF(btrim(p->>'remision_pedido'), ''), '');
  IF jsonb_typeof(p->'lineas') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lineas') = 0 THEN
    RAISE EXCEPTION 'tramitar_traslado_oc: faltan las líneas del pedido';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p->'lineas') e
     WHERE jsonb_typeof(e) <> 'object'
        OR (e->>'pedido_id') IS NULL OR (e->>'pedido_id') !~ '^\d+$'
        OR (e->>'cantidad')  IS NULL OR (e->>'cantidad')  !~ '^\d+$'
        OR (e->>'cantidad')::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'tramitar_traslado_oc: cada línea necesita pedido_id y una cantidad entera mayor que cero';
  END IF;

  -- ── Candados: primero un advisory lock por línea (mismo nombre que reservar_stock_oc_traslado), en orden ──
  FOR v_lin IN
    SELECT (e->>'pedido_id')::bigint AS pid
      FROM jsonb_array_elements(p->'lineas') e
     GROUP BY 1 ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('reservar_oc_pedido_' || v_lin.pid::text, 0));
  END LOOP;

  -- A partir de aquí las escrituras sobre OC diferidas están permitidas (lo ve fn_oc_diferida_guard).
  PERFORM set_config('app.oc_tramite', 'on', true);

  FOR v_lin IN
    SELECT (e->>'pedido_id')::bigint AS pid, SUM((e->>'cantidad')::numeric) AS cant
      FROM jsonb_array_elements(p->'lineas') e
     GROUP BY 1 ORDER BY 1
  LOOP
    SELECT "id","Nombre_Empresa","Consecutivo","Cliente","Cantidad","Cant_Entregada","Estado_2"
      INTO v_ped
      FROM "Pedidos" WHERE "id" = v_lin.pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La línea % del pedido no existe', v_lin.pid;
    END IF;
    IF NOT public.user_has_company(v_ped."Nombre_Empresa") THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
    IF COALESCE(v_ped."Estado_2",'') IN ('Anulado','Cerrado','Pendiente de aprobación') THEN
      RAISE EXCEPTION 'La línea % del pedido está en estado «%»: no se puede tramitar el traslado', v_lin.pid, v_ped."Estado_2";
    END IF;
    IF UPPER(TRIM(COALESCE(v_ped."Nombre_Empresa",''))) = 'GRANEL' THEN
      RAISE EXCEPTION 'La línea % es de GRANEL: no tiene OC de traslado', v_lin.pid;
    END IF;
    IF v_lin.cant > COALESCE(v_ped."Cantidad",0) - COALESCE(v_ped."Cant_Entregada",0) THEN
      RAISE EXCEPTION 'La línea % solo tiene % ud por entregar y se intentaron % ud',
        v_lin.pid, COALESCE(v_ped."Cantidad",0) - COALESCE(v_ped."Cant_Entregada",0), v_lin.cant;
    END IF;

    v_need := v_lin.cant;
    FOR v_oc IN
      SELECT * FROM "OrdenesCompra"
       WHERE "pedido_id" = v_lin.pid
         AND "Tipo" = 'Traslado'
         AND COALESCE("Traslado_Diferido", false)
         AND COALESCE("Estado",'') = 'Abierta'
         AND "Estado_Aprobacion" = 'Aprobada'
         AND COALESCE(btrim("Remision"),'') = ''
         AND COALESCE(btrim("Remision_Origen"),'') = ''
         AND TRIM(COALESCE("Empresa_Destino",'')) = TRIM(COALESCE(v_ped."Nombre_Empresa",''))
         AND COALESCE("Cantidad",0) > 0
       ORDER BY "id"
         FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_oc."Cantidad");

      -- Un par RE/RS por (Consecutivo, origen, destino) y por pasada.
      v_key := COALESCE(v_oc."Consecutivo",'') || '|' || COALESCE(v_oc."Empresa_Origen",'') || '|' || COALESCE(v_oc."Empresa_Destino",'');
      IF NOT (v_pares ? v_key) THEN
        v_re := public._remision_siguiente(TRIM(v_oc."Empresa_Destino"), 'ENTRADA');
        v_rs := CASE
                  WHEN COALESCE(TRIM(v_oc."Empresa_Origen"),'') <> ''
                   AND TRIM(v_oc."Empresa_Origen") IS DISTINCT FROM TRIM(v_oc."Empresa_Destino")
                  THEN public._remision_siguiente(TRIM(v_oc."Empresa_Origen"), 'SALIDA')
                  ELSE ''
                END;
        v_pares := v_pares || jsonb_build_object(v_key, jsonb_build_object(
          'consecutivo', v_oc."Consecutivo", 'origen', v_oc."Empresa_Origen", 'destino', v_oc."Empresa_Destino",
          're', v_re, 'rs', v_rs, 'cantidad', 0, 'ref', COALESCE(v_oc."Ref_Pedido",'')));
      ELSE
        v_re := v_pares->v_key->>'re';
        v_rs := v_pares->v_key->>'rs';
      END IF;
      v_pares := jsonb_set(v_pares, ARRAY[v_key, 'cantidad'],
                           to_jsonb(COALESCE((v_pares->v_key->>'cantidad')::numeric, 0) + v_take));

      v_obs := CASE WHEN COALESCE(btrim(v_oc."Observaciones"),'') = '' THEN '' ELSE v_oc."Observaciones" || ' | ' END
               || 'Tramitada al remisionar el pedido' || CASE WHEN v_remped <> '' THEN ' ' || v_remped ELSE '' END
               || ' (' || v_take || ' ud)';

      IF v_take >= v_oc."Cantidad" THEN
        -- La remisión del pedido cubre toda la fila: se actualiza en sitio.
        UPDATE "OrdenesCompra"
           SET "Fecha"           = v_fecha,
               "Remision"        = v_re,
               "Remision_Origen" = v_rs,
               "Estado"          = 'Cerrada',
               "Observaciones"   = v_obs
         WHERE "id" = v_oc."id";
        v_piece_id := v_oc."id";
      ELSE
        -- Parcial: el remanente sigue Abierto (y apartando en el origen); la parte despachada es una pieza Cerrada.
        UPDATE "OrdenesCompra"
           SET "Cantidad" = "Cantidad" - v_take
         WHERE "id" = v_oc."id";
        INSERT INTO "OrdenesCompra" (
          "Fecha","Fecha_Registro","Empresa_Origen","Empresa_Destino","Consecutivo","Tipo","Ref_Pedido","pedido_id",
          "Producto","Presentacion","Cantidad","Valor_Unitario","Valor_Total","Total_Orden",
          "Estado","Estado_Aprobacion","Aprobada_Por","Fecha_Aprobacion","Remision","Remision_Origen",
          "Bodega","Bonificado","Observaciones","Direccion","Municipio","creado_por","creado_por_nombre",
          "Traslado_Diferido","Traslado_Padre_Id"
        ) VALUES (
          v_fecha, v_oc."Fecha_Registro", v_oc."Empresa_Origen", v_oc."Empresa_Destino", v_oc."Consecutivo", v_oc."Tipo", v_oc."Ref_Pedido", v_oc."pedido_id",
          v_oc."Producto", v_oc."Presentacion", v_take, v_oc."Valor_Unitario", COALESCE(v_oc."Valor_Unitario",0) * v_take, COALESCE(v_oc."Valor_Unitario",0) * v_take,
          'Cerrada', v_oc."Estado_Aprobacion", v_oc."Aprobada_Por", v_oc."Fecha_Aprobacion", v_re, v_rs,
          v_oc."Bodega", v_oc."Bonificado", v_obs, v_oc."Direccion", v_oc."Municipio", v_oc."creado_por", v_oc."creado_por_nombre",
          true, v_oc."id"
        ) RETURNING "id" INTO v_piece_id;
      END IF;

      v_piezas := v_piezas || jsonb_build_array(jsonb_build_object(
        'oc_id', v_piece_id, 'pedido_id', v_lin.pid, 'cantidad', v_take,
        'consecutivo', v_oc."Consecutivo", 'remision_re', v_re, 'remision_rs', v_rs));
      v_porlinea := jsonb_set(v_porlinea, ARRAY[v_lin.pid::text],
        COALESCE(v_porlinea->(v_lin.pid::text), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'oc_id', v_piece_id, 'cantidad', v_take, 'remision_re', v_re, 'remision_rs', v_rs)), true);

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION 'La línea % (pedido %, %) solo tiene % ud en OC de traslado aprobadas y pendientes; se intentaron % ud',
        v_lin.pid, v_ped."Consecutivo", COALESCE(v_ped."Cliente",''), v_lin.cant - v_need, v_lin.cant;
    END IF;
  END LOOP;

  -- Fin de las escrituras sobre OC: cierra la excepción del candado para el resto de la transacción.
  PERFORM set_config('app.oc_tramite', 'off', true);

  -- Avisos a contabilidad (uno por par; nunca bloquean).
  FOR v_par IN SELECT value AS v FROM jsonb_each(v_pares) LOOP
    BEGIN
      PERFORM public._oc_avisar_tramite(
        v_par.v->>'destino', v_par.v->>'origen', v_par.v->>'consecutivo',
        v_par.v->>'re', v_par.v->>'rs', (v_par.v->>'cantidad')::numeric,
        v_par.v->>'ref', v_remped, v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tramitar_traslado_oc: aviso a contabilidad (%): %', v_par.v->>'consecutivo', SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'pares',     COALESCE((SELECT jsonb_agg(value) FROM jsonb_each(v_pares)), '[]'::jsonb),
    'piezas',    v_piezas,
    'por_linea', v_porlinea
  );
END;
$function$;

-- ── guardar_pedido_con_traslados ───────────────────────────────────────────
-- DEFINER para poder llamar a tramitar_traslado_oc (que NO es ejecutable por clientes: sola, movería
-- inventario sin remisión del pedido). La identidad sigue siendo la del JWT (auth.uid()), y
-- editar_pedido_completo conserva sus propios chequeos de rol y empresa.
CREATE OR REPLACE FUNCTION public.guardar_pedido_con_traslados(
  p_header jsonb, p_lineas jsonb,
  p_delete_ids bigint[] DEFAULT '{}'::bigint[],
  p_tramite jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tr     jsonb := '{}'::jsonb;
  v_res    jsonb;
  v_antes  jsonb;
  v_lin    record;
  v_ahora  numeric;
BEGIN
  IF p_tramite IS NOT NULL AND jsonb_typeof(p_tramite->'lineas') = 'array'
     AND jsonb_array_length(p_tramite->'lineas') > 0 THEN
    v_tr := public.tramitar_traslado_oc(p_tramite);

    -- Cant_Entregada antes de escribir el pedido (tramitar_traslado_oc no la toca).
    SELECT COALESCE(jsonb_object_agg(id::text, COALESCE("Cant_Entregada",0)), '{}'::jsonb)
      INTO v_antes
      FROM "Pedidos"
     WHERE id IN (SELECT (e->>'pedido_id')::bigint FROM jsonb_array_elements(p_tramite->'lineas') e);

    v_res := public.editar_pedido_completo(p_header, p_lineas, p_delete_ids);

    -- Un traslado no se mueve sin remisión del pedido: el pedido debe haber registrado la entrega.
    FOR v_lin IN
      SELECT (e->>'pedido_id')::bigint AS pid, SUM((e->>'cantidad')::numeric) AS cant
        FROM jsonb_array_elements(p_tramite->'lineas') e
       GROUP BY 1
    LOOP
      SELECT COALESCE("Cant_Entregada",0) INTO v_ahora FROM "Pedidos" WHERE id = v_lin.pid;
      IF v_ahora IS NULL OR v_ahora < COALESCE((v_antes->>(v_lin.pid::text))::numeric, 0) + v_lin.cant THEN
        RAISE EXCEPTION 'El pedido no registró la entrega de % ud de la línea %: no se tramitó el traslado de la OC',
          v_lin.cant, v_lin.pid;
      END IF;
    END LOOP;
  ELSE
    v_res := public.editar_pedido_completo(p_header, p_lineas, p_delete_ids);
  END IF;

  RETURN COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('tramite', v_tr);
END;
$function$;

-- ── Permisos ───────────────────────────────────────────────────────────────
-- Internas: ningún cliente las llama directo.
REVOKE ALL ON FUNCTION public._remision_siguiente(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._oc_avisar_tramite(text, text, text, text, text, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tramitar_traslado_oc(jsonb) FROM PUBLIC, anon, authenticated;
-- La que usa el navegador: solo usuarios con sesión.
REVOKE ALL ON FUNCTION public.guardar_pedido_con_traslados(jsonb, jsonb, bigint[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_pedido_con_traslados(jsonb, jsonb, bigint[], jsonb) TO authenticated;
