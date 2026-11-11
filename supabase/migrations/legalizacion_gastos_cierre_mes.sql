-- ============================================================
-- Legalización de Gastos: CIERRE DE MES
--
-- Un mes cerrado solo lo puede tocar un administrador. Para cualquier otro usuario
-- NO se puede crear, editar ni eliminar una legalización (Ruta / Mantenimiento) ni un
-- envío cuya "Fecha" caiga en un período cerrado, ni cambiar la fecha de un registro
-- para meterlo o sacarlo de él.
--
-- Modelo: tabla LegalizacionGastosCierres. Cada fila es un cierre y guarda el ÚLTIMO
-- DÍA cerrado ("Cerrado_Hasta", siempre un fin de mes); una fecha está cerrada si es
-- menor o igual al mayor "Cerrado_Hasta". Es decir, cerrar un mes cierra también todos
-- los anteriores.
--   * Cerrar noviembre : INSERT ... ("Cerrado_Hasta") VALUES ('2026-11-30')
--   * Reabrir un mes   : borrar la fila de ese cierre (y las posteriores) y, si hay que
--                        dejar cerrados los anteriores, insertar el fin del mes previo.
--   * Hoy queda cerrado hasta el 2026-10-31 (octubre y meses anteriores; los datos
--     empiezan en 2026-09-01).
--
-- Cómo se hace cumplir: triggers BEFORE en las tres tablas (cabecera, líneas de gasto y
-- reparto por empresa), no políticas RLS, para no tocar las políticas vigentes.
--   * Admin (usuarios.rol = 'admin') y las llamadas sin sesión (SQL editor, service role,
--     migraciones): sin restricción.
--   * Conciliar / rechazar (RPC conciliar_legalizacion_gastos) SIGUE permitido en meses
--     cerrados: solo cambia estado, saldos y quién/cuándo concilió, no los datos.
--     Se detecta comparando la fila sin esas columnas.
--   * Los soportes adjuntos (bucket legalizacion-gastos-adjuntos) NO se restringen aquí:
--     la pantalla los oculta en meses cerrados (js/legalizacion-gastos.js), pero la BD no.
--
-- La pantalla lee el cierre con legalizacion_gastos_cerrado_hasta() (callable por
-- usuarios con sesión) para ocultar «Editar»/adjuntar y avisar antes de guardar.
--
-- Aplicar con apply_migration (MCP) ANTES de publicar el código.
-- Reversión: legalizacion_gastos_cierre_mes_rollback.sql
-- ============================================================

-- ── 1. Tabla de cierres ──
CREATE TABLE IF NOT EXISTS public."LegalizacionGastosCierres" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Cerrado_Hasta"          date NOT NULL,
  "Nota"                   text NOT NULL DEFAULT '',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz,
  CONSTRAINT legalizacion_gastos_cierres_unico UNIQUE ("Cerrado_Hasta"),
  -- Siempre un fin de mes: el día siguiente es el 1.º de otro mes.
  CONSTRAINT legalizacion_gastos_cierres_fin_de_mes
    CHECK (extract(day FROM ("Cerrado_Hasta" + 1)) = 1)
);

COMMENT ON TABLE public."LegalizacionGastosCierres" IS
  'Cierres de mes de Legalización de Gastos. "Cerrado_Hasta" es el último día cerrado (fin de mes); una fecha está cerrada si es <= al mayor valor. En un período cerrado solo un admin crea/edita/elimina legalizaciones y envíos.';

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."LegalizacionGastosCierres";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."LegalizacionGastosCierres"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."LegalizacionGastosCierres";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosCierres"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 2. RLS: lo lee quien usa el módulo; solo el admin lo escribe ──
ALTER TABLE public."LegalizacionGastosCierres" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LegalizacionGastosCierres_select" ON public."LegalizacionGastosCierres";
CREATE POLICY "LegalizacionGastosCierres_select" ON public."LegalizacionGastosCierres" FOR SELECT TO authenticated
  USING (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'));

DROP POLICY IF EXISTS "LegalizacionGastosCierres_insert" ON public."LegalizacionGastosCierres";
CREATE POLICY "LegalizacionGastosCierres_insert" ON public."LegalizacionGastosCierres" FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "LegalizacionGastosCierres_update" ON public."LegalizacionGastosCierres";
CREATE POLICY "LegalizacionGastosCierres_update" ON public."LegalizacionGastosCierres" FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "LegalizacionGastosCierres_delete" ON public."LegalizacionGastosCierres";
CREATE POLICY "LegalizacionGastosCierres_delete" ON public."LegalizacionGastosCierres" FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

REVOKE ALL ON public."LegalizacionGastosCierres" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LegalizacionGastosCierres" TO authenticated;
GRANT ALL ON public."LegalizacionGastosCierres" TO service_role;

-- ── 3. Funciones ──
-- Último día cerrado (NULL si no hay ningún cierre). La llama la pantalla.
CREATE OR REPLACE FUNCTION public.legalizacion_gastos_cerrado_hasta()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max("Cerrado_Hasta") FROM public."LegalizacionGastosCierres";
$$;

COMMENT ON FUNCTION public.legalizacion_gastos_cerrado_hasta() IS
  'Último día cerrado de Legalización de Gastos (NULL si no hay cierres). Una fecha <= este valor está cerrada.';

-- ¿La fecha cae en un período cerrado?
CREATE OR REPLACE FUNCTION public.legalizacion_gastos_fecha_cerrada(p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_fecha <= public.legalizacion_gastos_cerrado_hasta(), false);
$$;

-- Rechaza (excepción) si la fecha está cerrada y quien escribe no es admin.
-- Sin sesión (auth.uid() NULL: SQL editor, service role, migraciones) no restringe.
CREATE OR REPLACE FUNCTION public.legalizacion_gastos_asegurar_fecha_abierta(p_fecha date)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.legalizacion_gastos_fecha_cerrada(p_fecha) THEN
    RETURN;
  END IF;
  IF auth.uid() IS NULL OR public.get_user_role() = 'admin' THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un mes cerrado (hasta el %). Solo un administrador puede crear, editar o eliminar legalizaciones y envíos de ese período.',
    to_char(p_fecha, 'DD/MM/YYYY'),
    to_char(public.legalizacion_gastos_cerrado_hasta(), 'DD/MM/YYYY');
END;
$$;

-- Trigger de la cabecera (LegalizacionGastos).
CREATE OR REPLACE FUNCTION public.fn_legalizacion_gastos_cierre_mes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Lo único que cambia al conciliar/rechazar (RPC conciliar_legalizacion_gastos) y la auditoría.
  v_ignorar text[] := ARRAY['Estado_Conciliacion', 'Saldo_Favor_Empleado', 'Saldo_Reembolsar_Empresa',
                            'Conciliado_Por', 'Fecha_Conciliacion', 'Motivo_Rechazo',
                            'modificado_por', 'modificado_por_nombre', 'modificado_en'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.legalizacion_gastos_asegurar_fecha_abierta(NEW."Fecha");
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.legalizacion_gastos_asegurar_fecha_abierta(OLD."Fecha");
    RETURN OLD;
  END IF;

  -- UPDATE: conciliar/rechazar sigue permitido en un mes cerrado.
  IF (to_jsonb(NEW) - v_ignorar) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_ignorar) THEN
    RETURN NEW;
  END IF;
  PERFORM public.legalizacion_gastos_asegurar_fecha_abierta(OLD."Fecha");  -- no sacar un registro de un mes cerrado
  PERFORM public.legalizacion_gastos_asegurar_fecha_abierta(NEW."Fecha");  -- ni meterlo
  RETURN NEW;
END;
$$;

-- Trigger de las líneas de gasto y del reparto por empresa: miran la fecha de su legalización.
CREATE OR REPLACE FUNCTION public.fn_legalizacion_gastos_hijos_cierre_mes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fecha date;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "Fecha" INTO v_fecha FROM public."LegalizacionGastos" WHERE id = OLD."Legalizacion_Id";
    PERFORM public.legalizacion_gastos_asegurar_fecha_abierta(v_fecha);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "Fecha" INTO v_fecha FROM public."LegalizacionGastos" WHERE id = NEW."Legalizacion_Id";
    PERFORM public.legalizacion_gastos_asegurar_fecha_abierta(v_fecha);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Ninguna es llamable por clientes, salvo la que lee la pantalla.
REVOKE ALL ON FUNCTION public.legalizacion_gastos_fecha_cerrada(date)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legalizacion_gastos_asegurar_fecha_abierta(date)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_legalizacion_gastos_cierre_mes()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_legalizacion_gastos_hijos_cierre_mes()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legalizacion_gastos_cerrado_hasta()               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legalizacion_gastos_cerrado_hasta() TO authenticated, service_role;

-- ── 4. Triggers ──
DROP TRIGGER IF EXISTS trg_legalizacion_gastos_cierre_mes ON public."LegalizacionGastos";
CREATE TRIGGER trg_legalizacion_gastos_cierre_mes
  BEFORE INSERT OR UPDATE OR DELETE ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_legalizacion_gastos_cierre_mes();

DROP TRIGGER IF EXISTS trg_legalizacion_gastos_cierre_mes ON public."LegalizacionGastosItems";
CREATE TRIGGER trg_legalizacion_gastos_cierre_mes
  BEFORE INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosItems"
  FOR EACH ROW EXECUTE FUNCTION public.fn_legalizacion_gastos_hijos_cierre_mes();

DROP TRIGGER IF EXISTS trg_legalizacion_gastos_cierre_mes ON public."LegalizacionGastosEmpresas";
CREATE TRIGGER trg_legalizacion_gastos_cierre_mes
  BEFORE INSERT OR UPDATE OR DELETE ON public."LegalizacionGastosEmpresas"
  FOR EACH ROW EXECUTE FUNCTION public.fn_legalizacion_gastos_hijos_cierre_mes();

-- ── 5. Cierre inicial: octubre de 2026 (y los meses anteriores) ──
INSERT INTO public."LegalizacionGastosCierres" ("Cerrado_Hasta", "Nota", creado_por_nombre)
SELECT DATE '2026-10-31', 'Cierre de octubre de 2026 (incluye los meses anteriores)', 'Migración legalizacion_gastos_cierre_mes'
 WHERE NOT EXISTS (SELECT 1 FROM public."LegalizacionGastosCierres" WHERE "Cerrado_Hasta" = DATE '2026-10-31');

-- ── 6. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
