-- ============================================================
-- Migracion: registro de consultas a reportes sensibles
--
-- Objetivo: saber que usuarios abren la pestana "Programacion de
-- planta" de reportes.html y cuando lo hacen.
--
-- Los reportes son de solo lectura y no escriben nada, asi que hoy
-- no dejan rastro (audit_log solo captura INSERT/UPDATE/DELETE via
-- triggers). Esta tabla + RPC llenan ese hueco.
--
-- Granularidad: 1 fila por (reporte, usuario, dia). La primera
-- consulta del dia crea la fila; las siguientes actualizan
-- ultima_hora y suman veces. "dia" se calcula en hora de Bogota.
--
-- Lectura: solo rol 'admin' (se ve en la pestana Consultas del
-- panel Auditoria). Escritura: solo via la RPC SECURITY DEFINER.
--
-- Idempotente. Ejecutar con apply_migration del MCP de Supabase
-- (no se aplica con el push).
-- Fecha: 2026-09-08
-- ============================================================


-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public.acceso_reportes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporte        TEXT NOT NULL,
  usuario_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_email  TEXT,
  usuario_nombre TEXT,
  dia            DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Bogota')::date,
  primera_hora   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_hora    TIMESTAMPTZ NOT NULL DEFAULT now(),
  veces          INT NOT NULL DEFAULT 1
);

COMMENT ON TABLE public.acceso_reportes IS
  'Registro de consultas a reportes de solo lectura (quien abre que reporte y cuando). 1 fila por reporte/usuario/dia.';
COMMENT ON COLUMN public.acceso_reportes.reporte IS
  'Identificador del reporte consultado. Hoy solo: programacion_planta.';
COMMENT ON COLUMN public.acceso_reportes.dia IS
  'Dia de la consulta en hora de Bogota (America/Bogota). Parte de la clave unica.';
COMMENT ON COLUMN public.acceso_reportes.veces IS
  'Cuantas veces ese usuario abrio ese reporte ese dia.';

-- Clave unica que hace cumplir "1 fila por usuario/reporte/dia"
-- y sirve de arbitro para el ON CONFLICT de la RPC.
CREATE UNIQUE INDEX IF NOT EXISTS uq_acceso_reportes_dia
  ON public.acceso_reportes (reporte, usuario_id, dia);

CREATE INDEX IF NOT EXISTS idx_acceso_reportes_dia
  ON public.acceso_reportes (dia DESC);
CREATE INDEX IF NOT EXISTS idx_acceso_reportes_usuario
  ON public.acceso_reportes (usuario_id);


-- ── 2. RLS: solo admin lee; nadie escribe directo ──
ALTER TABLE public.acceso_reportes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acceso_reportes_select ON public.acceso_reportes;
CREATE POLICY acceso_reportes_select ON public.acceso_reportes
  FOR SELECT TO authenticated
  USING (get_user_role() = 'admin');

-- Sin politicas de INSERT/UPDATE/DELETE: las escrituras entran solo
-- por registrar_acceso_reporte() (SECURITY DEFINER, se salta RLS).

GRANT SELECT ON public.acceso_reportes TO authenticated;
GRANT ALL    ON public.acceso_reportes TO service_role;


-- ── 3. RPC: registrar una consulta ──
CREATE OR REPLACE FUNCTION public.registrar_acceso_reporte(p_reporte text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_nombre text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Lista blanca: se agregan aqui los reportes que se quieran vigilar.
  IF p_reporte NOT IN ('programacion_planta') THEN
    RETURN;
  END IF;

  SELECT email, nombre INTO v_email, v_nombre
  FROM usuarios WHERE id = v_uid;

  INSERT INTO acceso_reportes (reporte, usuario_id, usuario_email, usuario_nombre)
  VALUES (p_reporte, v_uid, v_email, v_nombre)
  ON CONFLICT (reporte, usuario_id, dia) DO UPDATE
    SET ultima_hora = now(),
        veces       = acceso_reportes.veces + 1,
        usuario_email  = COALESCE(EXCLUDED.usuario_email, acceso_reportes.usuario_email),
        usuario_nombre = COALESCE(EXCLUDED.usuario_nombre, acceso_reportes.usuario_nombre);
END;
$function$;

REVOKE ALL   ON FUNCTION public.registrar_acceso_reporte(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_acceso_reporte(text) TO authenticated;


-- ── 4. Refrescar la cache de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migracion add_acceso_reportes
-- ============================================================
