-- Corregir hallazgo alto: get_audit_history() salta el RLS admin-only de audit_log
-- Cualquier usuario autenticado podía leer snapshots completos (JSON antes/después)
-- de registros de cualquier empresa, más el email del usuario que hizo el cambio.
-- Ejecutado en producción el 2026-08-29. Se versiona como documentación del
-- estado real de la BD (fuera del historial de migraciones de Supabase); no
-- re-ejecutar a ciegas.

CREATE OR REPLACE FUNCTION public.get_audit_history(p_tabla text, p_registro_id text)
 RETURNS TABLE(accion text, usuario_email text, datos_antes jsonb, datos_despues jsonb, fecha timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT a.accion, a.usuario_email, a.datos_antes, a.datos_despues, a.created_at
  FROM audit_log a
  WHERE a.tabla = p_tabla AND a.registro_id = p_registro_id
  ORDER BY a.created_at DESC;
END;
$function$;
