-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite / consignación — PARTE 5 de 5: administración (lado de la principal, solo admin)
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere: bodega_satelite_tablas / nucleo.
--
-- QUÉ HACE: las RPC que usa la pestaña «Gestión de bodegas» de bodegas-consignacion.html.
-- Las tablas Bodega* no tienen políticas de escritura, así que habilitar una bodega, crear un
-- usuario de bodega y asignarle bodegas pasa por aquí. Todas exigen get_user_role() = 'admin'.
--
--   bodega_admin_listar()                 catálogo con su configuración, existencias resumidas y usuarios
--   bodega_admin_guardar_bodega(...)      habilita/edita una bodega (código de la serie y fecha de corte)
--   bodega_admin_guardar_usuario(...)     vincula una cuenta de Auth como usuario de bodega y le asigna bodegas
--   bodega_admin_buscar_usuario(email)    ¿ya existe esa cuenta en Auth? (para reintentar/vincular)
--
-- La cuenta de Auth se crea con la Edge Function `create-user` (solo la llama el administrador y
-- solo crea el usuario de Auth, sin fila en public.usuarios). Después se llama a
-- bodega_admin_guardar_usuario. Regla que protege el aislamiento: una cuenta que ya es usuario de la
-- principal (fila en public.usuarios) NO puede ser usuario de bodega — con un rol vería la principal.
--
-- Reglas: el código de una bodega no cambia una vez emitidos documentos; la fecha de corte no
-- cambia una vez aplicado el conteo inicial; el código es único (ej. COATOL-CHICORAL, ESPINAL).
--
-- Idempotente. Rollback: bodega_satelite_admin_rollback.sql.
-- Fecha: 2026-11-17
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._bodega_exigir_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede gestionar las bodegas satélite.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bodega_admin_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bodega_exigir_admin();
  RETURN jsonb_build_object(
    'bodegas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'bodega_id', b.id, 'nombre', b."Nombre", 'municipio', b."Municipio", 'departamento', b."Departamento",
               'empresa', b."Nombre_Empresa", 'activo', COALESCE(b."Activo", true),
               'config', (SELECT jsonb_build_object(
                            'codigo', c.codigo, 'fecha_corte', c.fecha_corte, 'habilitada', c.habilitada,
                            'inicial_aplicado', public._bodega_tiene_inicial(c.bodega_id),
                            'productos', (SELECT count(*) FROM public._bodega_saldos(c.bodega_id) s WHERE s.existencia <> 0),
                            'unidades', COALESCE((SELECT sum(s.existencia) FROM public._bodega_saldos(c.bodega_id) s), 0),
                            'movimientos', (SELECT count(*) FROM "BodegaMovimientos" m WHERE m.bodega_id = c.bodega_id AND m.estado = 'Activo'),
                            'ultimo_movimiento', (SELECT max(m.fecha) FROM "BodegaMovimientos" m WHERE m.bodega_id = c.bodega_id AND m.estado = 'Activo'),
                            'traslados_en_transito', (SELECT count(*) FROM "BodegaTraslados" t
                                                       WHERE t.estado = 'En tránsito' AND c.bodega_id IN (t.bodega_origen, t.bodega_destino)))
                           FROM "BodegaConfig" c WHERE c.bodega_id = b.id))
             ORDER BY b."Nombre_Empresa", b."Nombre", b."Municipio", b.id)
        FROM "BodegasConsignacion" b), '[]'::jsonb),
    'usuarios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', u.usuario_id, 'nombre', u.nombre, 'email', u.email, 'activo', u.activo,
               'bodegas', COALESCE((SELECT jsonb_agg(ub.bodega_id ORDER BY ub.bodega_id) FROM "BodegaUsuarioBodegas" ub WHERE ub.usuario_id = u.usuario_id), '[]'::jsonb))
             ORDER BY u.nombre)
        FROM "BodegaUsuarios" u), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bodega_admin_guardar_bodega(
  p_bodega_id bigint, p_codigo text, p_fecha_corte date, p_habilitada boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cod text := upper(btrim(COALESCE(p_codigo, '')));
  v_c   public."BodegaConfig"%ROWTYPE;
BEGIN
  PERFORM public._bodega_exigir_admin();

  IF NOT EXISTS (SELECT 1 FROM "BodegasConsignacion" b WHERE b.id = p_bodega_id) THEN
    RAISE EXCEPTION 'La bodega no existe en el catálogo.';
  END IF;
  IF v_cod !~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{2,12})?$' THEN
    RAISE EXCEPTION 'Código no válido: usa letras mayúsculas y números, de 2 a 12 caracteres (puedes agregar un guion y un segundo bloque, ej. COATOL-CHICORAL).';
  END IF;
  IF p_fecha_corte IS NULL OR p_fecha_corte > public._bodega_hoy() THEN
    RAISE EXCEPTION 'La fecha de corte (la del conteo físico inicial) no puede estar vacía ni ser futura.';
  END IF;

  SELECT * INTO v_c FROM "BodegaConfig" WHERE bodega_id = p_bodega_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO "BodegaConfig" (bodega_id, codigo, fecha_corte, habilitada)
    VALUES (p_bodega_id, v_cod, p_fecha_corte, COALESCE(p_habilitada, true));
  ELSE
    IF v_c.codigo <> v_cod AND (EXISTS (SELECT 1 FROM "BodegaMovimientos" m WHERE m.bodega_id = p_bodega_id)
                                OR EXISTS (SELECT 1 FROM "BodegaConsecutivos" k WHERE k.bodega_id = p_bodega_id AND k.ultimo > 0)) THEN
      RAISE EXCEPTION 'El código no se puede cambiar: ya se emitieron documentos con %.', v_c.codigo;
    END IF;
    IF v_c.fecha_corte <> p_fecha_corte AND public._bodega_tiene_inicial(p_bodega_id) THEN
      RAISE EXCEPTION 'La fecha de corte no se puede cambiar: ya se aplicó el conteo inicial de esta bodega.';
    END IF;
    UPDATE "BodegaConfig" SET codigo = v_cod, fecha_corte = p_fecha_corte, habilitada = COALESCE(p_habilitada, true)
     WHERE bodega_id = p_bodega_id;
  END IF;

  RETURN jsonb_build_object('bodega_id', p_bodega_id, 'codigo', v_cod);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ya existe otra bodega con el código %.', v_cod;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bodega_admin_guardar_usuario(
  p_usuario_id uuid, p_nombre text, p_email text, p_activo boolean, p_bodegas bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nombre text := btrim(COALESCE(p_nombre, ''));
  v_email  text := lower(btrim(COALESCE(p_email, '')));
  v_bod    bigint[] := COALESCE(p_bodegas, ARRAY[]::bigint[]);
  b        bigint;
BEGIN
  PERFORM public._bodega_exigir_admin();

  IF length(v_nombre) < 3 THEN RAISE EXCEPTION 'Escribe el nombre (mínimo 3 caracteres).'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Correo no válido.'; END IF;
  IF p_usuario_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_usuario_id) THEN
    RAISE EXCEPTION 'La cuenta no existe en Auth: créala primero (create-user).';
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios x WHERE x.id = p_usuario_id) THEN
    RAISE EXCEPTION 'Esta cuenta ya es usuario de la principal. Los usuarios de bodega deben ser cuentas aparte (con un rol de la principal verían sus datos).';
  END IF;
  FOREACH b IN ARRAY v_bod LOOP
    IF NOT EXISTS (SELECT 1 FROM "BodegaConfig" c WHERE c.bodega_id = b AND c.habilitada) THEN
      RAISE EXCEPTION 'La bodega % no está habilitada.', b;
    END IF;
  END LOOP;

  INSERT INTO "BodegaUsuarios" (usuario_id, nombre, email, activo)
  VALUES (p_usuario_id, v_nombre, v_email, COALESCE(p_activo, true))
  ON CONFLICT (usuario_id) DO UPDATE SET nombre = EXCLUDED.nombre, email = EXCLUDED.email, activo = EXCLUDED.activo;

  DELETE FROM "BodegaUsuarioBodegas" WHERE usuario_id = p_usuario_id AND bodega_id <> ALL (v_bod);
  INSERT INTO "BodegaUsuarioBodegas" (usuario_id, bodega_id)
  SELECT p_usuario_id, x FROM unnest(v_bod) AS x
  ON CONFLICT (usuario_id, bodega_id) DO NOTHING;

  RETURN jsonb_build_object('usuario_id', p_usuario_id, 'bodegas', to_jsonb(v_bod));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bodega_admin_buscar_usuario(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public._bodega_exigir_admin();
  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = lower(btrim(COALESCE(p_email, ''))) LIMIT 1;
  IF v_id IS NULL THEN RETURN jsonb_build_object('existe', false); END IF;
  RETURN jsonb_build_object(
    'existe', true, 'usuario_id', v_id,
    'es_usuario_principal', EXISTS (SELECT 1 FROM usuarios x WHERE x.id = v_id),
    'ya_es_bodega', EXISTS (SELECT 1 FROM "BodegaUsuarios" bu WHERE bu.usuario_id = v_id));
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
