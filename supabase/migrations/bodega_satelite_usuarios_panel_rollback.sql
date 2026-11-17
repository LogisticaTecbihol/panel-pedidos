-- ROLLBACK de bodega_satelite_usuarios_panel.sql — restaura las 3 funciones como estaban en bodega_satelite_admin.sql
-- (una cuenta con fila en `usuarios` vuelve a rechazarse). Los usuarios de bodega ya vinculados que sean cuentas del panel
-- NO se borran; si existen, conviene desactivarlos antes de revertir porque la regla antigua ya no los admitiría al editarlos.

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
