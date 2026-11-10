-- ============================================================
-- Migración: el candado «una remisión = una orden» detecta VARIANTES de escritura
--
-- Contexto: remision_unica_por_orden_pedidos (2026-11-04) compara el número tal
-- cual, sin distinguir mayúsculas ni espacios. «IASO-RS-171» o «iaso rs 0171» no
-- coinciden con «IASO-RS-0171» y se colarían. En Pedidos.Remisiones conviven
-- 371 números de formato estándar (SIGLA-RS/RE-0000, desde 2026-08-19) y 441
-- números sueltos históricos («1002», «0515»…), así que mezclar notaciones es real.
--
-- Esta migración compara por una CLAVE CANÓNICA (fn_remision_clave):
--   · Formato estándar (SIGLA + RS/RE + dígitos, con cualquier separador y con o sin
--     ceros a la izquierda):  «IASO-RS-0171», «iaso rs 171», «IASO_RS_171»,
--     «IASORS171»  →  «IASO-RS-171».  RS (salida) y RE (entrada) NO se mezclan.
--   · Número suelto (solo dígitos): sin ceros a la izquierda:  «0090» = «90».
--   · Cualquier otro texto: tal cual, con los espacios compactados.
--   · Un número suelto NUNCA se iguala a uno estándar («171» ≠ «IASO-RS-171»): hay 441
--     números sueltos históricos que chocarían por casualidad con los que genera el
--     contador (p. ej. el «175» histórico contra IASO-RS-0175) y bloquearían guardados
--     normales con «Auto».
--
-- Con los datos de hoy la clave no cambia nada: los repetidos siguen siendo los mismos
-- 6 números sueltos históricos (no hay ninguna variante ya repetida, ni falsos positivos).
-- El mensaje de rechazo añade «(allí figura como X)» cuando la otra orden lo escribió distinto.
--
-- Solo se reemplaza fn_pedidos_remision_unica_por_orden (el trigger ya está enlazado) y se
-- agregan dos funciones auxiliares. Idempotente. Aplicar con apply_migration del MCP de
-- Supabase DESPUÉS de remision_unica_por_orden_pedidos. Fecha: 2026-11-04.
-- ============================================================


-- ── Clave canónica de UN número de remisión ──
CREATE OR REPLACE FUNCTION public.fn_remision_clave(p_cod text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s text := upper(btrim(COALESCE(p_cod, '')));
  m text[];
BEGIN
  IF s = '' THEN
    RETURN '';
  END IF;

  -- Formato estándar: SIGLA + RS/RE + dígitos, con cualquier separador.
  m := regexp_match(regexp_replace(s, '[^A-Z0-9]', '', 'g'), '^([A-Z]+?)(RS|RE)([0-9]+)$');
  IF m IS NOT NULL THEN
    RETURN m[1] || '-' || m[2] || '-' || COALESCE(NULLIF(ltrim(m[3], '0'), ''), '0');
  END IF;

  -- Número suelto (histórico): sin ceros a la izquierda.
  IF s ~ '^[0-9]+$' THEN
    RETURN COALESCE(NULLIF(ltrim(s, '0'), ''), '0');
  END IF;

  -- Cualquier otro texto: tal cual, con los espacios compactados.
  RETURN regexp_replace(s, '\s+', ' ', 'g');
END;
$function$;


-- ── Claves canónicas de un valor de Pedidos.Remisiones ──
CREATE OR REPLACE FUNCTION public.fn_pedidos_claves_remision(p_remisiones text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT public.fn_remision_clave(c)) FILTER (WHERE public.fn_remision_clave(c) <> ''), ARRAY[]::text[])
  FROM unnest(public.fn_pedidos_codigos_remision(p_remisiones)) AS c;
$function$;


-- ── "Pedidos": una remisión nueva no puede estar ya en otra orden (por clave canónica) ──
CREATE OR REPLACE FUNCTION public.fn_pedidos_remision_unica_por_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cod   text;
  v_clave text;
  v_dig   text;
  v_otro  record;
BEGIN
  -- Solo los números que esta línea AGREGA (su clave no estaba ya en la línea).
  FOR v_cod IN
    SELECT c
    FROM unnest(public.fn_pedidos_codigos_remision(NEW."Remisiones")) AS c
    WHERE NOT (public.fn_remision_clave(c) = ANY (public.fn_pedidos_claves_remision(OLD."Remisiones")))
  LOOP
    v_clave := public.fn_remision_clave(v_cod);

    -- Prefiltro barato (sin esto cada evaluación calcula la clave de TODAS las órdenes, ~180 ms):
    -- el número sin ceros a la izquierda tiene que aparecer en el texto de la otra orden
    -- («168» está en «IASO-RS-0168», en «iaso rs 168» y en «0168»). En claves de otro tipo no se prefiltra.
    v_dig := CASE
               WHEN v_clave ~ '^[A-Z]+-R[SE]-[0-9]+$' THEN substring(v_clave from '([0-9]+)$')
               WHEN v_clave ~ '^[0-9]+$'              THEN v_clave
               ELSE NULL
             END;

    PERFORM pg_advisory_xact_lock(
      hashtext('pedidos_remision:' || COALESCE(NEW."Nombre_Empresa", '') || ':' || v_clave)
    );

    SELECT o."Consecutivo" AS consecutivo,
           o."Cliente"     AS cliente,
           (SELECT c2
              FROM unnest(public.fn_pedidos_codigos_remision(o."Remisiones")) AS c2
             WHERE public.fn_remision_clave(c2) = v_clave
             LIMIT 1)      AS cod_otro
      INTO v_otro
    FROM public."Pedidos" o
    WHERE o.id <> NEW.id
      AND o."Nombre_Empresa" IS NOT DISTINCT FROM NEW."Nombre_Empresa"
      AND COALESCE(o."Remisiones", '') <> ''
      AND (v_dig IS NULL OR strpos(o."Remisiones", v_dig) > 0)
      AND v_clave = ANY (public.fn_pedidos_claves_remision(o."Remisiones"))
      AND NOT (
        o."Consecutivo" IS NOT DISTINCT FROM NEW."Consecutivo"
        AND lower(btrim(COALESCE(o."Cliente", ''))) IN (
          lower(btrim(COALESCE(NEW."Cliente", ''))),
          lower(btrim(COALESCE(OLD."Cliente", '')))
        )
      )
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'La remisión % ya pertenece a la orden % (cliente %) de esta empresa%. Una remisión corresponde a una sola orden: deje «Auto» para generar un número nuevo o escriba otro.',
        v_cod,
        COALESCE(v_otro.consecutivo, '?'),
        COALESCE(NULLIF(btrim(v_otro.cliente), ''), '?'),
        CASE WHEN upper(btrim(COALESCE(v_otro.cod_otro, ''))) <> v_cod
             THEN ' (allí figura como ' || v_otro.cod_otro || ')' ELSE '' END
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_remision_clave(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_pedidos_claves_remision(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_pedidos_remision_unica_por_orden() FROM public, anon, authenticated;


-- Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración remision_unica_por_orden_pedidos_variantes
-- ============================================================
