-- ============================================================
-- Auditoría del consecutivo de Legalización de Gastos
--
-- Pestaña "Consecutivo" de legalizacion-gastos.html: muestra, por serie
-- (LEG = Ruta + Mantenimiento, ENV = Envíos), qué números existen y cuáles
-- faltan (huecos), con el motivo tomado del audit_log y una nota manual de
-- revisión por hueco.
--
--   1. LegalizacionGastosConsecutivoNotas: una nota de revisión por número
--      faltante (Serie + Numero). Leer: cualquiera del módulo. Escribir /
--      borrar: quien concilia gastos (legalizacion_gastos_aprobar) o admin,
--      el mismo criterio que edita el catálogo de Vehículos.
--   2. get_auditoria_consecutivo_legalizacion_gastos(): arma la auditoría
--      completa en el servidor. SECURITY DEFINER porque el RLS de
--      LegalizacionGastos filtra por empresa (legalizacion_gastos_visible) y
--      un usuario con empresas restringidas vería "huecos" falsos si lo
--      calculara en el navegador; además audit_log solo lo lee un admin.
--      Solo devuelve datos básicos (número, tipo, fecha, estado) y, de lo
--      eliminado, el resumen del registro.
--
-- Un número cuenta como "emitido" si ya salió del contador (lo que entregó
-- la secuencia), aunque no exista una fila: un insert fallido o revertido
-- gasta el número y aparece como hueco al final de la serie.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

-- ── 1. Notas de revisión ──
CREATE TABLE IF NOT EXISTS public."LegalizacionGastosConsecutivoNotas" (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Serie"                 text    NOT NULL,
  "Numero"                integer NOT NULL,
  "Nota"                  text    NOT NULL,
  "creado_por"            uuid,
  "creado_por_nombre"     text,
  "creado_en"             timestamptz,
  "modificado_por"        uuid,
  "modificado_por_nombre" text,
  "modificado_en"         timestamptz
);

ALTER TABLE public."LegalizacionGastosConsecutivoNotas" DROP CONSTRAINT IF EXISTS lgcn_serie_chk;
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" ADD CONSTRAINT lgcn_serie_chk CHECK ("Serie" IN ('LEG', 'ENV'));
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" DROP CONSTRAINT IF EXISTS lgcn_numero_chk;
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" ADD CONSTRAINT lgcn_numero_chk CHECK ("Numero" > 0);
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" DROP CONSTRAINT IF EXISTS lgcn_nota_chk;
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" ADD CONSTRAINT lgcn_nota_chk CHECK (btrim("Nota") <> '');
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" DROP CONSTRAINT IF EXISTS lgcn_serie_numero_uq;
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" ADD CONSTRAINT lgcn_serie_numero_uq UNIQUE ("Serie", "Numero");

COMMENT ON TABLE public."LegalizacionGastosConsecutivoNotas" IS
  'Nota de revisión de un número faltante (hueco) del consecutivo de Legalización de Gastos (Serie LEG|ENV + Numero). Una por número.';

-- Auditoría (mismo patrón que las demás tablas del módulo).
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LegalizacionGastosConsecutivoNotas";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastosConsecutivoNotas"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LegalizacionGastosConsecutivoNotas";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosConsecutivoNotas"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 2. RLS ──
ALTER TABLE public."LegalizacionGastosConsecutivoNotas" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LGConsecutivoNotas_select" ON public."LegalizacionGastosConsecutivoNotas";
CREATE POLICY "LGConsecutivoNotas_select" ON public."LegalizacionGastosConsecutivoNotas" FOR SELECT TO authenticated
  USING (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'));

DROP POLICY IF EXISTS "LGConsecutivoNotas_insert" ON public."LegalizacionGastosConsecutivoNotas";
CREATE POLICY "LGConsecutivoNotas_insert" ON public."LegalizacionGastosConsecutivoNotas" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('legalizacion_gastos_aprobar'));

DROP POLICY IF EXISTS "LGConsecutivoNotas_update" ON public."LegalizacionGastosConsecutivoNotas";
CREATE POLICY "LGConsecutivoNotas_update" ON public."LegalizacionGastosConsecutivoNotas" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos_aprobar'))
  WITH CHECK (public.user_has_module('legalizacion_gastos_aprobar'));

-- Borrar la nota reabre el hueco como "Pendiente" (queda en audit_log).
DROP POLICY IF EXISTS "LGConsecutivoNotas_delete" ON public."LegalizacionGastosConsecutivoNotas";
CREATE POLICY "LGConsecutivoNotas_delete" ON public."LegalizacionGastosConsecutivoNotas" FOR DELETE TO authenticated
  USING (public.user_has_module('legalizacion_gastos_aprobar'));

GRANT ALL ON public."LegalizacionGastosConsecutivoNotas" TO anon, authenticated, service_role;

-- ── 3. Auditoría completa del consecutivo ──
-- Devuelve:
-- { generado, series: [ { serie, ultimo, siguiente, existentes, huecos, pendientes,
--     filas: [ { numero, consecutivo, existe, id, tipo, fecha, estado,
--                motivo: { accion, cuando, usuario, renumerada_a, detalle:{...} } | null,
--                nota:   { id, texto, por, cuando } | null } ] } ] }
-- Una fila por cada número de 1 a "ultimo" (el mayor entre los existentes y lo
-- que ya entregó el contador). "motivo" solo viene en los huecos y sale del
-- audit_log: DELETE (eliminada) o UPDATE que cambió el Consecutivo (renumerada,
-- p. ej. el primer envío que era LEG-00016 y pasó a ENV-00001). Sin rastro en
-- el audit_log, "motivo" es null.
CREATE OR REPLACE FUNCTION public.get_auditoria_consecutivo_legalizacion_gastos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_series jsonb := '[]'::jsonb;
  v_serie  text;
  v_ultimo int;
  v_filas  jsonb;
  v_exist  int;
  v_huecos int;
  v_pend   int;
BEGIN
  IF NOT (public.user_has_module('legalizacion_gastos')
          OR public.user_has_module('legalizacion_gastos_aprobar')) THEN
    RAISE EXCEPTION 'Sin permiso para consultar el consecutivo de legalizaciones';
  END IF;

  FOREACH v_serie IN ARRAY ARRAY['LEG', 'ENV'] LOOP
    -- Lo que ya entregó el contador de la serie...
    IF v_serie = 'LEG' THEN
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO v_ultimo
        FROM public.legalizacion_gastos_leg_seq;
    ELSE
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO v_ultimo
        FROM public.legalizacion_gastos_env_seq;
    END IF;
    -- ...o el mayor número que exista, el que sea más alto.
    v_ultimo := GREATEST(v_ultimo, COALESCE((
      SELECT max(substring(g."Consecutivo" from '\d+$')::int)
        FROM public."LegalizacionGastos" g
       WHERE g."Consecutivo" ~ ('^' || v_serie || '-\d+$')), 0));

    WITH nums AS (
      SELECT n, v_serie || '-' || lpad(n::text, 5, '0') AS cons
        FROM generate_series(1, v_ultimo) AS n
    ), ex AS (
      SELECT g."Consecutivo" AS cons, g.id, g."Tipo", g."Fecha", g."Estado_Conciliacion" AS estado
        FROM public."LegalizacionGastos" g
       WHERE g."Consecutivo" ~ ('^' || v_serie || '-\d+$')
    ), mot AS (
      -- Último evento del audit_log que hizo desaparecer ese consecutivo.
      SELECT DISTINCT ON (a.datos_antes->>'Consecutivo')
             a.datos_antes->>'Consecutivo'    AS cons,
             a.accion,
             a.created_at,
             a.usuario_id,
             a.usuario_email,
             a.datos_antes                    AS antes,
             a.datos_despues->>'Consecutivo'  AS nuevo
        FROM public.audit_log a
       WHERE a.tabla = 'LegalizacionGastos'
         AND a.datos_antes->>'Consecutivo' LIKE v_serie || '-%'
         AND (a.accion = 'DELETE'
              OR (a.accion = 'UPDATE'
                  AND a.datos_despues->>'Consecutivo' IS DISTINCT FROM a.datos_antes->>'Consecutivo'))
       ORDER BY a.datos_antes->>'Consecutivo', a.created_at DESC
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'numero',      nums.n,
             'consecutivo', nums.cons,
             'existe',      (ex.cons IS NOT NULL),
             'id',          ex.id,
             'tipo',        ex."Tipo",
             'fecha',       ex."Fecha",
             'estado',      ex.estado,
             'motivo', CASE WHEN ex.cons IS NULL AND mot.cons IS NOT NULL THEN jsonb_build_object(
                         'accion',       mot.accion,
                         'cuando',       mot.created_at,
                         'usuario',      COALESCE(u.nombre, mot.usuario_email),
                         'renumerada_a', CASE WHEN mot.accion = 'UPDATE' THEN mot.nuevo END,
                         'detalle',      jsonb_build_object(
                                           'tipo',        mot.antes->>'Tipo',
                                           'fecha',       mot.antes->>'Fecha',
                                           'responsable', mot.antes->>'Responsable',
                                           'ruta',        mot.antes->>'Recorrido_Ruta',
                                           'placa',       mot.antes->>'Placa',
                                           'estado',      mot.antes->>'Estado_Conciliacion'))
                       END,
             'nota', CASE WHEN nt.id IS NOT NULL THEN jsonb_build_object(
                         'id',     nt.id,
                         'texto',  nt."Nota",
                         'por',    COALESCE(nt.modificado_por_nombre, nt.creado_por_nombre),
                         'cuando', COALESCE(nt.modificado_en, nt.creado_en))
                     END
           ) ORDER BY nums.n), '[]'::jsonb),
           count(*) FILTER (WHERE ex.cons IS NOT NULL),
           count(*) FILTER (WHERE ex.cons IS NULL),
           count(*) FILTER (WHERE ex.cons IS NULL AND nt.id IS NULL)
      INTO v_filas, v_exist, v_huecos, v_pend
      FROM nums
      LEFT JOIN ex  ON ex.cons  = nums.cons
      LEFT JOIN mot ON mot.cons = nums.cons
      LEFT JOIN public.usuarios u ON u.id = mot.usuario_id
      LEFT JOIN public."LegalizacionGastosConsecutivoNotas" nt
             ON nt."Serie" = v_serie AND nt."Numero" = nums.n;

    v_series := v_series || jsonb_build_array(jsonb_build_object(
      'serie',      v_serie,
      'ultimo',     v_ultimo,
      'siguiente',  v_ultimo + 1,
      'existentes', v_exist,
      'huecos',     v_huecos,
      'pendientes', v_pend,
      'filas',      v_filas));
  END LOOP;

  RETURN jsonb_build_object('generado', now(), 'series', v_series);
END;
$$;

REVOKE ALL ON FUNCTION public.get_auditoria_consecutivo_legalizacion_gastos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auditoria_consecutivo_legalizacion_gastos() TO authenticated;

-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
