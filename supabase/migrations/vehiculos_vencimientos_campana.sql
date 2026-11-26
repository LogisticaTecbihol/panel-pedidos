-- ============================================================
-- Vencimientos de vehículos: aviso por la CAMPANITA del panel (con sonido)
--
-- Pedido 2026-11-26. Además del aviso al grupo de WhatsApp, cada usuario con acceso al módulo
-- («Vencimientos de Vehículos» = rol admin, o permiso vehiculos_vencimientos en usuario_modulos;
-- activo) recibe el aviso en la campanita. Es una fila en `notificaciones` (módulo 'vehiculos'):
-- la campanita ya la recibe por Realtime, suena y suma al contador, igual que los demás avisos.
--
-- INDEPENDIENTE de WhatsApp: tiene su propio registro de qué se avisó
-- (VehiculosVencimientosEstadoCampana) y su propio trabajo de pg_cron que llama a una función SQL
-- (no pasa por la Edge Function ni por Whapi). Si WhatsApp falla, la campanita avisa igual, y al revés.
-- Misma regla de avisos que WhatsApp: escalones 30, 15, 7, 3 y 0 días, una sola vez cada uno, y
-- ya vencido, recordatorio cada 7 días; solo vehículos activos; un aviso por persona y por día con lo nuevo.
-- «Enviar aviso ahora» (botón de la página) sigue siendo solo para WhatsApp.
--
-- Idempotente. Aplicar con apply_migration. Fecha: 2026-11-26
-- ============================================================


-- ── 1. Módulo 'vehiculos' en notificaciones (lista vigente en producción + la nueva) ──
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'pedidos','devoluciones','cambios','muestras','ordenes','ingresos','reenvases','kardex',
    'reportes','crm','solicitudes_mercadeo','bodegas','vehiculos'
  ]::text[]));


-- ── 2. Registro propio de la campanita (último escalón avisado por documento) ──
CREATE TABLE IF NOT EXISTS public."VehiculosVencimientosEstadoCampana" (
  doc_id         bigint PRIMARY KEY REFERENCES public."VehiculosVencimientosDocs"(id) ON DELETE CASCADE,
  ultimo_umbral  int  NOT NULL,   -- 30, 15, 7, 3, 0 o -1 (vencido)
  ultimo_aviso   date NOT NULL
);

COMMENT ON TABLE public."VehiculosVencimientosEstadoCampana" IS
  'Último escalón avisado por la campanita del panel, por documento. Independiente del de WhatsApp (VehiculosVencimientosEstado). Lo escribe solo vv_avisar_campana y se borra al cambiar la fecha del documento.';

ALTER TABLE public."VehiculosVencimientosEstadoCampana" ENABLE ROW LEVEL SECURITY;   -- sin políticas: nadie desde el navegador
REVOKE ALL ON public."VehiculosVencimientosEstadoCampana" FROM anon, authenticated;
GRANT ALL ON public."VehiculosVencimientosEstadoCampana" TO service_role;


-- ── 3. Al renovar un documento (cambia la fecha) se reinician sus avisos en LOS DOS canales ──
CREATE OR REPLACE FUNCTION public.vv_reset_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW."Fecha_Vencimiento" IS DISTINCT FROM OLD."Fecha_Vencimiento" THEN
    DELETE FROM public."VehiculosVencimientosEstado"        WHERE doc_id = NEW.id;
    DELETE FROM public."VehiculosVencimientosEstadoCampana" WHERE doc_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.vv_reset_estado() FROM public, anon, authenticated;


-- ── 4. Lo nuevo para la campanita: misma regla que vv_pendientes('nuevos'), con su propio registro ──
-- (Si cambias la regla de escalones, cámbiala aquí y en vv_pendientes.)
CREATE OR REPLACE FUNCTION public.vv_pendientes_campana()
RETURNS TABLE (doc_id bigint, placa text, documento text, fecha_vencimiento date, dias int, umbral int)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH hoy AS (SELECT (now() AT TIME ZONE 'America/Bogota')::date AS d),
  base AS (
    SELECT d.id AS doc_id, v."Placa" AS placa, d."Documento" AS documento,
           d."Fecha_Vencimiento" AS fecha_vencimiento,
           (d."Fecha_Vencimiento" - hoy.d) AS dias,
           e.ultimo_umbral, e.ultimo_aviso, hoy.d AS hoy
      FROM public."VehiculosVencimientosDocs" d
      JOIN public."VehiculosVencimientos" v ON v.id = d."Vehiculo_Id"
      LEFT JOIN public."VehiculosVencimientosEstadoCampana" e ON e.doc_id = d.id
      CROSS JOIN hoy
     WHERE v."Activo"
  )
  SELECT doc_id, placa, documento, fecha_vencimiento, dias, public.vv_umbral(dias)
    FROM base
   WHERE public.vv_umbral(dias) IS NOT NULL
     AND (
          ultimo_umbral IS NULL
       OR public.vv_umbral(dias) < ultimo_umbral
       OR (public.vv_umbral(dias) = -1 AND ultimo_aviso <= hoy - 7)
     )
   ORDER BY dias, placa, documento;
$$;


-- ── 5. Crea los avisos de la campanita y marca lo avisado. Devuelve cuántos avisos creó. ──
-- Destinatarios: usuarios ACTIVOS con acceso al módulo (rol admin, o permiso vehiculos_vencimientos).
-- de_usuario_id = NULL: la campanita y la bandeja lo muestran como «Aviso automático».
-- Si no hay a quién avisar no marca nada (le llegará a quien tenga acceso cuando lo haya).
CREATE OR REPLACE FUNCTION public.vv_avisar_campana()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_ids    bigint[];
  v_total  int;
  v_venc   int;
  v_7      int;
  v_30     int;
  v_placas text;
  v_titulo text;
  v_msg    text;
  v_n      int := 0;
BEGIN
  SELECT array_agg(p.doc_id),
         count(*),
         count(*) FILTER (WHERE p.dias < 0),
         count(*) FILTER (WHERE p.dias BETWEEN 0 AND 7),
         count(*) FILTER (WHERE p.dias > 7),
         string_agg(DISTINCT p.placa, ', ' ORDER BY p.placa)
    INTO v_ids, v_total, v_venc, v_7, v_30, v_placas
    FROM public.vv_pendientes_campana() p;

  IF coalesce(v_total, 0) = 0 THEN
    RETURN 0;
  END IF;

  v_titulo := left('Documentos por revisar: ' || v_placas, 200);
  v_msg := concat_ws(' · ',
    CASE WHEN v_venc > 0 THEN v_venc || CASE WHEN v_venc = 1 THEN ' documento vencido' ELSE ' documentos vencidos' END END,
    CASE WHEN v_7    > 0 THEN v_7    || CASE WHEN v_7    = 1 THEN ' vence' ELSE ' vencen' END || ' en 7 días o menos' END,
    CASE WHEN v_30   > 0 THEN v_30   || CASE WHEN v_30   = 1 THEN ' vence' ELSE ' vencen' END || ' en los próximos 30 días' END
  );

  INSERT INTO public.notificaciones (para_usuario_id, de_usuario_id, modulo, referencia, titulo, mensaje)
  SELECT u.id, NULL, 'vehiculos', NULL, v_titulo, v_msg
    FROM public.usuarios u
   WHERE u.activo = true
     AND (u.rol = 'admin'
          OR EXISTS (SELECT 1 FROM public.usuario_modulos m
                      WHERE m.usuario_id = u.id AND m.modulo = 'vehiculos_vencimientos'));
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO public."VehiculosVencimientosEstadoCampana" (doc_id, ultimo_umbral, ultimo_aviso)
    SELECT d.id, public.vv_umbral(d."Fecha_Vencimiento" - v_hoy), v_hoy
      FROM public."VehiculosVencimientosDocs" d
     WHERE d.id = ANY (v_ids)
       AND public.vv_umbral(d."Fecha_Vencimiento" - v_hoy) IS NOT NULL
    ON CONFLICT (doc_id) DO UPDATE
       SET ultimo_umbral = EXCLUDED.ultimo_umbral, ultimo_aviso = EXCLUDED.ultimo_aviso;
  END IF;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.vv_pendientes_campana() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.vv_avisar_campana()     FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vv_pendientes_campana() TO service_role;
GRANT EXECUTE ON FUNCTION public.vv_avisar_campana()     TO service_role;


-- ── 6. Trabajo diario de pg_cron: 13:00 UTC = 8:00 a. m. Colombia (UTC-5 todo el año) ──
-- (Se aplicó con '0 12 * * *' = 7:00 a. m. y el 2026-11-26 se pasó a las 8:00 con cron.alter_job.)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vencimientos-vehiculos-campana';
END $$;

SELECT cron.schedule(
  'vencimientos-vehiculos-campana',
  '0 13 * * *',
  $job$SELECT public.vv_avisar_campana();$job$
);


-- ── 7. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración vehiculos_vencimientos_campana
-- ============================================================
