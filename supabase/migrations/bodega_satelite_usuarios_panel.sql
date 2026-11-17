-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite — PARTE 7: una cuenta del panel principal también puede ser usuario de bodega
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere: bodega_satelite_admin.sql. Solo REEMPLAZA 3 funciones de administración (mismas firmas).
--
-- MOTIVO (2026-11-17): un usuario con rol en el panel (p. ej. un comercial) debe poder gestionar ALGUNAS
-- bodegas satélite con su MISMA cuenta. Antes bodega_admin_guardar_usuario rechazaba cualquier cuenta con fila en
-- `usuarios` (regla de aislamiento pensada para los usuarios que son SOLO de bodega). Ese bloqueo no protegía a quien ya
-- tiene rol (ya ve del panel lo que su rol permite); el riesgo real era a la inversa: un usuario solo de bodega al que
-- después le den un rol del panel pasaría a ver la principal. Por eso ahora se permite, pero SE VE: la lista de
-- usuarios de bodega muestra el rol del panel de cada cuenta («Solo bodega» o «Panel: comercial»).
--
-- QUÉ CAMBIA
--   • bodega_admin_guardar_usuario: ya NO rechaza cuentas de la principal. Sí exige que el correo coincida con el de la
--     cuenta de Auth (evita vincular un uid con el correo equivocado).
--   • bodega_admin_buscar_usuario: además devuelve rol_panel y nombre_panel (de public.usuarios) para que la pantalla
--     pida confirmación y no pida contraseña a una cuenta que ya existe.
--   • bodega_admin_listar: cada usuario de bodega trae rol_panel (null = solo bodega).
--   NO cambia: las RPC de la bodega (_bodega_acceso exige estar en BodegaUsuarios/BodegaUsuarioBodegas, sin mirar el rol),
--   el acceso del usuario al panel (no se toca usuarios ni sus permisos) ni los usuarios de bodega que ya existan.
--
-- Idempotente. Rollback: bodega_satelite_usuarios_panel_rollback.sql (restaura la regla anterior).
-- Fecha: 2026-11-17
-- ════════════════════════════════════════════════════════════════════════════

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
               'rol_panel', (SELECT x.rol FROM usuarios x WHERE x.id = u.usuario_id),
               'bodegas', COALESCE((SELECT jsonb_agg(ub.bodega_id ORDER BY ub.bodega_id) FROM "BodegaUsuarioBodegas" ub WHERE ub.usuario_id = u.usuario_id), '[]'::jsonb))
             ORDER BY u.nombre)
        FROM "BodegaUsuarios" u), '[]'::jsonb));
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
  v_nombre     text := btrim(COALESCE(p_nombre, ''));
  v_email      text := lower(btrim(COALESCE(p_email, '')));
  v_bod        bigint[] := COALESCE(p_bodegas, ARRAY[]::bigint[]);
  v_auth_email text;
  b            bigint;
BEGIN
  PERFORM public._bodega_exigir_admin();

  IF length(v_nombre) < 3 THEN RAISE EXCEPTION 'Escribe el nombre (mínimo 3 caracteres).'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Correo no válido.'; END IF;
  SELECT lower(btrim(u.email)) INTO v_auth_email FROM auth.users u WHERE u.id = p_usuario_id;
  IF p_usuario_id IS NULL OR v_auth_email IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe en Auth: créala primero (create-user).';
  END IF;
  IF v_auth_email <> v_email THEN
    RAISE EXCEPTION 'El correo no corresponde a la cuenta seleccionada.';
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
    'rol_panel', (SELECT x.rol FROM usuarios x WHERE x.id = v_id),
    'nombre_panel', (SELECT x.nombre FROM usuarios x WHERE x.id = v_id),
    'ya_es_bodega', EXISTS (SELECT 1 FROM "BodegaUsuarios" bu WHERE bu.usuario_id = v_id));
END;
$function$;


-- ════════════════ PERMISOS (igual que en las demás partes) ════════════════
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
