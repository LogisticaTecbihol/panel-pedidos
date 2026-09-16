-- ============================================================
-- Migracion: aviso in-app diario del reporte "Programacion de planta"
--
-- Objetivo: recordarle todos los dias, a una hora fija, a un
-- usuario puntual (Carlos Ramirez) que el reporte de Programacion
-- de planta (reportes.html, pestana "planta") esta disponible.
-- Reutiliza la bandeja de notificaciones ya existente (tabla
-- notificaciones + campanita/Realtime); no envia correo ni push,
-- solo aparece cuando el usuario entra al panel o si ya lo tiene
-- abierto.
--
-- Piezas:
--   1. Extension pg_cron (no estaba habilitada en el proyecto).
--   2. 'reportes' se agrega al CHECK de notificaciones.modulo.
--   3. RPC SECURITY DEFINER enviar_notificacion_diaria_planta():
--      inserta 1 notificacion/dia para Carlos Ramirez, "de" Diana
--      Marquez (admin que configuro este aviso). No se expone via
--      API (sin GRANT a authenticated/anon) — solo la llama pg_cron.
--   4. cron.schedule diario a las 13:00 UTC = 8:00 a.m. hora
--      Colombia (America/Bogota es UTC-5 todo el ano, sin horario
--      de verano, por eso el offset fijo).
--
-- Idempotente. Ejecutar con apply_migration del MCP de Supabase
-- (no se aplica con el push).
-- Fecha: 2026-09-16
-- ============================================================


-- ── 1. Extension pg_cron ──
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ── 2. Permitir modulo 'reportes' en notificaciones ──
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'pedidos','devoluciones','cambios','muestras',
    'ordenes','ingresos','reenvases','kardex','reportes'
  ]));


-- ── 3. RPC: crear el aviso del dia (si no existe ya uno hoy) ──
CREATE OR REPLACE FUNCTION public.enviar_notificacion_diaria_planta()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_para_id uuid;
  v_de_id   uuid;
  v_hoy     date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  SELECT id INTO v_para_id FROM usuarios WHERE email = 'candresr_81@hotmail.com';
  SELECT id INTO v_de_id   FROM usuarios WHERE email = 'dmelina77@gmail.com';

  IF v_para_id IS NULL OR v_de_id IS NULL THEN
    RETURN;
  END IF;

  -- Evita duplicar el aviso si la funcion se llama mas de una vez el mismo dia.
  IF EXISTS (
    SELECT 1 FROM notificaciones
    WHERE para_usuario_id = v_para_id
      AND modulo = 'reportes'
      AND (created_at AT TIME ZONE 'America/Bogota')::date = v_hoy
  ) THEN
    RETURN;
  END IF;

  INSERT INTO notificaciones (para_usuario_id, de_usuario_id, modulo, titulo, mensaje, storage_path)
  VALUES (
    v_para_id,
    v_de_id,
    'reportes',
    '📈 Reporte disponible: Programación de planta',
    'El reporte de Programación de planta ya está disponible en el módulo de Reportes.',
    NULL
  );
END;
$function$;

-- Sin GRANT a authenticated/anon: solo la invoca el cron job (como postgres).
REVOKE ALL ON FUNCTION public.enviar_notificacion_diaria_planta() FROM public, anon, authenticated;


-- ── 4. Programar el envio diario (13:00 UTC = 8:00 a.m. Bogota) ──
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'aviso-diario-programacion-planta';
END $$;

SELECT cron.schedule(
  'aviso-diario-programacion-planta',
  '0 13 * * *',
  $$SELECT public.enviar_notificacion_diaria_planta();$$
);


-- ── 5. Refrescar la cache de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migracion notifica_diaria_programacion_planta
-- ============================================================
