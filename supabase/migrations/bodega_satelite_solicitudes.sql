-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite / consignación — PARTE 8: FASE 2 (solicitudes a la principal + supervisión)
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere: bodega_satelite_tablas / avisos / nucleo / traslados_bodega / admin (en ese orden).
--
-- QUÉ HACE (la bodega NUNCA escribe en tablas de la principal; todo es libro propio + avisos):
--   1. BodegaSolicitudes: bandeja bodega → principal. Tres tipos:
--        MUESTRA     la despacha la principal (origen PRINCIPAL) o sale del stock de la bodega (origen BODEGA:
--                    baja al registrar con SALIDA_MUESTRA y se REINTEGRA —se anula— si la principal la rechaza
--                    o la bodega la cancela mientras está Pendiente).
--        CAMBIO      solo solicitud (cliente, factura, productos que devuelve con lote/vencimiento, razón y
--                    opcionalmente el reemplazo). NO mueve el stock de la bodega.
--        DEVOLUCION  devolución de mercancía a la principal: baja al registrar (SALIDA_DEVOLUCION_PRINCIPAL),
--                    documento propio BOD-<COD>-DV-n, estado «En tránsito» hasta que la principal confirma la
--                    recepción (no mueve nada: el ingreso lo registra la principal a mano en Ingresos).
--      Estados: MUESTRA/CAMBIO  Pendiente → En proceso → Atendida | Rechazada  (Cancelada solo desde Pendiente).
--               DEVOLUCION      En tránsito → Recibida | Recibida con diferencia  (Cancelada solo desde En tránsito).
--   2. BodegaMovimientos: columna solicitud_id, tipo nuevo SALIDA_MUESTRA, y el guard del libro la protege.
--      BodegaConsecutivos: series nuevas SM (solicitud de muestra) y SC (solicitud de cambio); DV ya existía.
--   3. Quién atiende en la principal (decisión del usuario, 2026-11-18): administradores + quienes ya atienden
--      Muestras/Devoluciones = rol editor/contabilidad/gerente_iaso/remisionador con el módulo `muestras_aprobar`,
--      el módulo `muestras` (si es MUESTRA) o `devoluciones` (CAMBIO/DEVOLUCION) y la empresa de la bodega asignada.
--      En IASO: Alison Vargas, Paula Martínez y Lady Puentes. Reciben el aviso en la campanita (módulo 'bodegas').
--   4. Supervisión (solo lectura) en la principal: bodega_supervision_resumen() = existencias por bodega. La ven
--      admin/editor/contabilidad/gerente_iaso/remisionador/lector con el módulo `bodegas_consignacion` y la empresa.
--   5. bodega_existencias() ahora también informa las devoluciones «en tránsito» hacia la principal.
--
-- NO toca nada de la principal: no escribe Pedidos/Ingresos/Muestras/Cambios ni _kx_movs, Kardex, Existencias,
-- Dashboard o Reportes. Solo LEE usuarios / usuario_modulos / usuario_empresas / empresas (para saber a quién avisar).
-- Reescribe, sobre el cuerpo vigente, dos funciones DEL PROPIO MÓDULO: fn_bodega_mov_guard y bodega_existencias.
--
-- Idempotente. Rollback: bodega_satelite_solicitudes_rollback.sql (BORRA solicitudes y los movimientos nuevos).
-- Aplicar con apply_migration del MCP ANTES de publicar el código (el push a GitHub no aplica SQL).
-- OJO: mientras dure una prueba, estas solicitudes avisan a los atendedores REALES (no a «solo el admin»).
-- Fecha: 2026-11-18
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. BodegaSolicitudes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."BodegaSolicitudes" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consecutivo           text   NOT NULL UNIQUE,
  bodega_id             bigint NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  tipo                  text   NOT NULL CONSTRAINT chk_bodega_sol_tipo CHECK (tipo IN ('MUESTRA', 'CAMBIO', 'DEVOLUCION')),
  estado                text   NOT NULL CONSTRAINT chk_bodega_sol_estado CHECK (estado IN (
                          'Pendiente', 'En proceso', 'Atendida', 'Rechazada',
                          'En tránsito', 'Recibida', 'Recibida con diferencia', 'Cancelada')),
  fecha                 date   NOT NULL,
  origen_stock          text   NOT NULL DEFAULT 'PRINCIPAL' CONSTRAINT chk_bodega_sol_origen CHECK (origen_stock IN ('PRINCIPAL', 'BODEGA')),
  destinatario          text   NOT NULL DEFAULT '',
  telefono              text   NOT NULL DEFAULT '',
  municipio             text   NOT NULL DEFAULT '',
  departamento          text   NOT NULL DEFAULT '',
  tipo_cultivo          text   NOT NULL DEFAULT '',
  objetivo              text   NOT NULL DEFAULT '',
  num_factura           text   NOT NULL DEFAULT '',
  motivo                text   NOT NULL DEFAULT '',
  observaciones         text   NOT NULL DEFAULT '',
  lineas                jsonb  NOT NULL,
  ref_principal         text,
  respuesta             text,
  atendido_por          uuid,
  atendido_por_nombre   text,
  atendido_en           timestamptz,
  cancelado_por         uuid,
  cancelado_por_nombre  text,
  cancelado_en          timestamptz,
  motivo_cancelacion    text,
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz,
  CONSTRAINT chk_bodega_sol_estado_tipo CHECK (
    (tipo = 'DEVOLUCION' AND estado IN ('En tránsito', 'Recibida', 'Recibida con diferencia', 'Cancelada'))
    OR (tipo <> 'DEVOLUCION' AND estado IN ('Pendiente', 'En proceso', 'Atendida', 'Rechazada', 'Cancelada'))),
  CONSTRAINT chk_bodega_sol_origen_tipo CHECK (origen_stock = 'PRINCIPAL' OR tipo = 'MUESTRA'),
  CONSTRAINT chk_bodega_sol_lineas CHECK (jsonb_typeof(lineas) = 'array' AND jsonb_array_length(lineas) > 0)
);
CREATE INDEX IF NOT EXISTS ix_bodega_sol_bodega ON public."BodegaSolicitudes" (bodega_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_bodega_sol_abiertas ON public."BodegaSolicitudes" (estado)
  WHERE estado IN ('Pendiente', 'En proceso', 'En tránsito');
COMMENT ON TABLE public."BodegaSolicitudes" IS
  'Solicitudes de una bodega satélite a la principal (muestra, cambio, devolución). La principal las atiende con sus módulos; la bodega nunca escribe en tablas de la principal.';

-- Auditoría + RLS (mismo patrón que el resto de tablas Bodega*: sin políticas de escritura, lectura directa solo admin).
DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_auditoria_row ON public."BodegaSolicitudes"';
  EXECUTE 'CREATE TRIGGER trg_auditoria_row BEFORE INSERT OR UPDATE ON public."BodegaSolicitudes" FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_row()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_log ON public."BodegaSolicitudes"';
  EXECUTE 'CREATE TRIGGER trg_audit_log AFTER INSERT OR UPDATE OR DELETE ON public."BodegaSolicitudes" FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log()';
  EXECUTE 'ALTER TABLE public."BodegaSolicitudes" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS "BodegaSolicitudes_select_admin" ON public."BodegaSolicitudes"';
  EXECUTE 'CREATE POLICY "BodegaSolicitudes_select_admin" ON public."BodegaSolicitudes" FOR SELECT TO authenticated USING ((SELECT public.get_user_role()) = ''admin'')';
  EXECUTE 'REVOKE ALL ON TABLE public."BodegaSolicitudes" FROM anon';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."BodegaSolicitudes" FROM authenticated';
END
$$;


-- ── 2. Libro y series: tipo SALIDA_MUESTRA, solicitud_id, series SM/SC ──────
ALTER TABLE public."BodegaMovimientos"
  ADD COLUMN IF NOT EXISTS solicitud_id bigint REFERENCES public."BodegaSolicitudes"(id);

ALTER TABLE public."BodegaMovimientos" DROP CONSTRAINT IF EXISTS chk_bodega_mov_tipo;
ALTER TABLE public."BodegaMovimientos" ADD CONSTRAINT chk_bodega_mov_tipo CHECK (tipo IN (
  'SALDO_INICIAL', 'ENTRADA_TRASLADO', 'ENTRADA_TRASLADO_BODEGA', 'AJUSTE_SOBRANTE',
  'SALIDA_DESPACHO', 'SALIDA_DEVOLUCION_PRINCIPAL', 'SALIDA_TRASLADO_BODEGA', 'SALIDA_MUESTRA', 'AJUSTE_FALTANTE'));

-- Un movimiento de muestra o de devolución SIEMPRE cuelga de su solicitud (y solo ellos).
ALTER TABLE public."BodegaMovimientos" DROP CONSTRAINT IF EXISTS chk_bodega_mov_solicitud;
ALTER TABLE public."BodegaMovimientos" ADD CONSTRAINT chk_bodega_mov_solicitud CHECK (
  (tipo IN ('SALIDA_MUESTRA', 'SALIDA_DEVOLUCION_PRINCIPAL')) = (solicitud_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS ix_bodega_mov_solicitud ON public."BodegaMovimientos" (solicitud_id) WHERE solicitud_id IS NOT NULL;
COMMENT ON TABLE public."BodegaMovimientos" IS
  'Libro de inventario de las bodegas satélite (solo producto terminado bueno). Suma: SALDO_INICIAL, ENTRADA_TRASLADO, ENTRADA_TRASLADO_BODEGA, AJUSTE_SOBRANTE. Resta: SALIDA_DESPACHO, SALIDA_DEVOLUCION_PRINCIPAL, SALIDA_TRASLADO_BODEGA, SALIDA_MUESTRA, AJUSTE_FALTANTE. Nada se borra: se anula.';

ALTER TABLE public."BodegaConsecutivos" DROP CONSTRAINT IF EXISTS chk_bodega_consec_tipo;
ALTER TABLE public."BodegaConsecutivos" ADD CONSTRAINT chk_bodega_consec_tipo CHECK (tipo IN ('RS', 'DV', 'TR', 'SM', 'SC'));
COMMENT ON TABLE public."BodegaConsecutivos" IS
  'RS = salida/despacho, DV = devolución a la principal, TR = traslado entre bodegas, SM = solicitud de muestra, SC = solicitud de cambio. Serie: BOD-<codigo>-<tipo>-0001.';

-- El guard del libro ahora también protege solicitud_id (un movimiento no se edita; solo pasa de Activo a Anulado).
CREATE OR REPLACE FUNCTION public.fn_bodega_mov_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un movimiento de bodega no se borra: se anula con motivo.';
  END IF;
  IF (NEW.bodega_id, NEW.fecha, NEW.tipo, NEW.producto, NEW.presentacion, NEW.cantidad, NEW.documento,
      NEW.origen_remision, NEW.cant_despachada, NEW.contraparte, NEW.observaciones, NEW.conteo_id, NEW.traslado_id, NEW.solicitud_id)
     IS DISTINCT FROM
     (OLD.bodega_id, OLD.fecha, OLD.tipo, OLD.producto, OLD.presentacion, OLD.cantidad, OLD.documento,
      OLD.origen_remision, OLD.cant_despachada, OLD.contraparte, OLD.observaciones, OLD.conteo_id, OLD.traslado_id, OLD.solicitud_id) THEN
    RAISE EXCEPTION 'Un movimiento de bodega no se edita: se anula y se registra otro.';
  END IF;
  IF OLD.estado = 'Anulado' AND NEW.estado <> 'Anulado' THEN
    RAISE EXCEPTION 'Un movimiento anulado no se reactiva.';
  END IF;
  RETURN NEW;
END;
$function$;
-- (_bodega_signo ya resta todo tipo que no esté en su lista de entradas: SALIDA_MUESTRA resta sin tocarla.)


-- ════════════════ HELPERS INTERNOS ════════════════

-- ¿Puede ver la bodega el personal de la principal (supervisión, solo lectura)?
CREATE OR REPLACE FUNCTION public._bodega_principal_ver(p_bodega bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.get_user_role() IN ('admin', 'editor', 'contabilidad', 'gerente_iaso', 'remisionador', 'lector'), false)
     AND public.user_has_module('bodegas_consignacion')
     AND EXISTS (SELECT 1 FROM "BodegaConfig" c JOIN "BodegasConsignacion" b ON b.id = c.bodega_id
                  WHERE c.bodega_id = p_bodega AND public.user_has_company(b."Nombre_Empresa"))
$function$;

-- ¿Puede atender (cambiar el estado de) una solicitud de ese tipo? Admin, o quien ya atiende Muestras/Devoluciones.
CREATE OR REPLACE FUNCTION public._bodega_principal_atiende(p_bodega bigint, p_tipo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.get_user_role() = 'admin', false)
      OR ( COALESCE(public.get_user_role() IN ('editor', 'contabilidad', 'gerente_iaso', 'remisionador'), false)
           AND public.user_has_module('muestras_aprobar')
           AND public.user_has_module(CASE WHEN p_tipo = 'MUESTRA' THEN 'muestras' ELSE 'devoluciones' END)
           AND EXISTS (SELECT 1 FROM "BodegaConfig" c JOIN "BodegasConsignacion" b ON b.id = c.bodega_id
                        WHERE c.bodega_id = p_bodega AND public.user_has_company(b."Nombre_Empresa")) )
$function$;

-- A quién se le avisa: los administradores activos + los atendedores de ese tipo de la empresa de la bodega.
CREATE OR REPLACE FUNCTION public._bodega_atendedores(p_bodega bigint, p_tipo text)
 RETURNS TABLE(usuario_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id FROM usuarios u WHERE u.activo AND u.rol = 'admin'
  UNION
  SELECT u.id
    FROM usuarios u
   WHERE u.activo AND u.rol IN ('editor', 'contabilidad', 'gerente_iaso', 'remisionador')
     AND EXISTS (SELECT 1 FROM usuario_modulos um WHERE um.usuario_id = u.id AND um.modulo = 'muestras_aprobar')
     AND EXISTS (SELECT 1 FROM usuario_modulos um WHERE um.usuario_id = u.id
                    AND um.modulo = CASE WHEN p_tipo = 'MUESTRA' THEN 'muestras' ELSE 'devoluciones' END)
     AND EXISTS (SELECT 1 FROM usuario_empresas ue
                   JOIN empresas e ON e.sigla = ue.empresa_sigla
                   JOIN "BodegasConsignacion" b ON b.id = p_bodega
                  WHERE ue.usuario_id = u.id
                    AND (e.nombre_completo = btrim(b."Nombre_Empresa") OR e.sigla = btrim(b."Nombre_Empresa")))
$function$;

-- Aviso a la campanita de los atendedores. NUNCA bloquea la operación (un fallo queda como WARNING).
CREATE OR REPLACE FUNCTION public._bodega_avisar_solicitud(p_bodega bigint, p_tipo text, p_titulo text, p_mensaje text, p_ref text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ins integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_titulo, '')), '') IS NULL THEN RETURN 0; END IF;
  INSERT INTO notificaciones (para_usuario_id, de_usuario_id, modulo, referencia, titulo, mensaje, storage_path)
  SELECT a.usuario_id, NULL, 'bodegas', p_ref, p_titulo, p_mensaje, NULL
    FROM public._bodega_atendedores(p_bodega, p_tipo) a
   WHERE NOT EXISTS (
     SELECT 1 FROM notificaciones n
      WHERE n.para_usuario_id = a.usuario_id AND n.modulo = 'bodegas'
        AND n.referencia IS NOT DISTINCT FROM p_ref AND n.titulo = p_titulo);
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN v_ins;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_bodega_avisar_solicitud(bodega %): %', p_bodega, SQLERRM;
  RETURN 0;
END;
$function$;

-- Líneas de una solicitud de CAMBIO: [{producto, cantidad, sentido DEVUELVE|REEMPLAZO, lote?, presentacion?}].
-- No agrega repetidos (cada línea puede llevar su propio lote); exige al menos un producto que el cliente devuelve.
CREATE OR REPLACE FUNCTION public._bodega_lineas_cambio(p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e      jsonb;
  v_prod text;
  v_txt  text;
  v_sent text;
  v_out  jsonb := '[]'::jsonb;
  v_dev  integer := 0;
BEGIN
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto.';
  END IF;
  IF jsonb_array_length(p_lineas) > 100 THEN RAISE EXCEPTION 'Demasiadas líneas (máximo 100).'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_prod := public._bodega_nombre_canonico(e->>'producto');
    IF v_prod IS NULL OR v_prod = '' THEN RAISE EXCEPTION 'Hay una línea sin producto.'; END IF;
    v_txt := btrim(COALESCE(e->>'cantidad', ''));
    IF v_txt !~ '^[0-9]{1,9}(\.0+)?$' OR v_txt::numeric <= 0 THEN
      RAISE EXCEPTION 'Cantidad no válida para %: debe ser un número entero mayor que 0.', v_prod;
    END IF;
    v_sent := upper(btrim(COALESCE(NULLIF(btrim(e->>'sentido'), ''), 'DEVUELVE')));
    IF v_sent NOT IN ('DEVUELVE', 'REEMPLAZO') THEN RAISE EXCEPTION 'Sentido de línea no válido para %.', v_prod; END IF;
    IF v_sent = 'DEVUELVE' THEN v_dev := v_dev + 1; END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'producto', v_prod,
      'presentacion', COALESCE(NULLIF(btrim(COALESCE(e->>'presentacion', '')), ''), public._bodega_presentacion(v_prod)),
      'cantidad', v_txt::numeric, 'sentido', v_sent, 'lote', left(btrim(COALESCE(e->>'lote', '')), 80)));
  END LOOP;
  IF v_dev = 0 THEN RAISE EXCEPTION 'Agrega al menos un producto que el cliente devuelve.'; END IF;
  RETURN v_out;
END;
$function$;

-- Una solicitud completa como jsonb (para la bodega y para la principal).
CREATE OR REPLACE FUNCTION public._bodega_solicitud_json(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', s.id, 'consecutivo', s.consecutivo, 'bodega_id', s.bodega_id,
    'bodega', jsonb_build_object('codigo', c.codigo, 'nombre', b."Nombre", 'municipio', b."Municipio",
                                 'departamento', b."Departamento", 'empresa', b."Nombre_Empresa"),
    'tipo', s.tipo, 'estado', s.estado, 'fecha', s.fecha, 'origen_stock', s.origen_stock,
    'destinatario', s.destinatario, 'telefono', s.telefono, 'municipio', s.municipio, 'departamento', s.departamento,
    'tipo_cultivo', s.tipo_cultivo, 'objetivo', s.objetivo, 'num_factura', s.num_factura, 'motivo', s.motivo,
    'observaciones', s.observaciones, 'lineas', s.lineas, 'ref_principal', s.ref_principal, 'respuesta', s.respuesta,
    'atendido_por_nombre', s.atendido_por_nombre, 'atendido_en', s.atendido_en,
    'cancelado_por_nombre', s.cancelado_por_nombre, 'cancelado_en', s.cancelado_en, 'motivo_cancelacion', s.motivo_cancelacion,
    'creado_por_nombre', s.creado_por_nombre, 'creado_en', s.creado_en)
    FROM "BodegaSolicitudes" s
    JOIN "BodegaConfig" c ON c.bodega_id = s.bodega_id
    JOIN "BodegasConsignacion" b ON b.id = s.bodega_id
   WHERE s.id = p_id
$function$;

-- Anula los movimientos de una solicitud (reintegra el stock). El llamador ya tiene el lock de la bodega.
CREATE OR REPLACE FUNCTION public._bodega_anular_mov_solicitud(p_solicitud bigint, p_motivo text, p_nombre text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  UPDATE "BodegaMovimientos"
     SET estado = 'Anulado', motivo_anulacion = left(p_motivo, 300), anulado_por = auth.uid(),
         anulado_por_nombre = p_nombre, anulado_en = now()
   WHERE solicitud_id = p_solicitud AND estado = 'Activo';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;


-- ════════════════ RPC DE LA BODEGA ════════════════

-- ── Crear una solicitud de MUESTRA o de CAMBIO ──
-- p_datos: {destinatario, telefono?, municipio, departamento?, tipo_cultivo?, objetivo, num_factura?, motivo,
--           observaciones?, origen_stock? (solo MUESTRA: PRINCIPAL|BODEGA), fecha?}
-- p_lineas: MUESTRA [{producto, cantidad}] · CAMBIO [{producto, cantidad, sentido DEVUELVE|REEMPLAZO, lote?}]
CREATE OR REPLACE FUNCTION public.bodega_crear_solicitud(p_bodega bigint, p_tipo text, p_datos jsonb, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_tipo   text := upper(btrim(COALESCE(p_tipo, '')));
  v_dest   text := btrim(COALESCE(p_datos->>'destinatario', ''));
  v_tel    text := left(btrim(COALESCE(p_datos->>'telefono', '')), 40);
  v_mun    text := btrim(COALESCE(p_datos->>'municipio', ''));
  v_dep    text := btrim(COALESCE(p_datos->>'departamento', ''));
  v_cult   text := left(btrim(COALESCE(p_datos->>'tipo_cultivo', '')), 120);
  v_obj    text := btrim(COALESCE(p_datos->>'objetivo', ''));
  v_fact   text := left(btrim(COALESCE(p_datos->>'num_factura', '')), 60);
  v_mot    text := btrim(COALESCE(p_datos->>'motivo', ''));
  v_obs    text := left(btrim(COALESCE(p_datos->>'observaciones', '')), 300);
  v_orig   text := upper(btrim(COALESCE(NULLIF(btrim(p_datos->>'origen_stock'), ''), 'PRINCIPAL')));
  v_fecha  date;
  v_nombre text := public._bodega_actor_nombre();
  v_lin    jsonb;
  v_n      integer;
  v_cons   text;
  v_id     bigint;
  v_bn     text;
  v_uds    numeric;
  v_nprod  integer;
  r        record;
  v_saldo  numeric;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  PERFORM pg_advisory_xact_lock(74201, p_bodega::integer);

  IF v_tipo NOT IN ('MUESTRA', 'CAMBIO') THEN RAISE EXCEPTION 'Tipo de solicitud no válido (MUESTRA o CAMBIO).'; END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN RAISE EXCEPTION 'Faltan los datos de la solicitud.'; END IF;
  IF length(v_dest) < 3 THEN
    RAISE EXCEPTION 'Escribe %.', CASE WHEN v_tipo = 'MUESTRA' THEN 'el destinatario de la muestra (mínimo 3 caracteres)' ELSE 'el cliente (mínimo 3 caracteres)' END;
  END IF;
  IF v_tipo = 'MUESTRA' THEN
    IF length(v_mun) < 2 THEN RAISE EXCEPTION 'Escribe el municipio.'; END IF;
    IF length(v_obj) < 3 THEN RAISE EXCEPTION 'Escribe el objetivo de la muestra (mínimo 3 caracteres).'; END IF;
    IF v_orig NOT IN ('PRINCIPAL', 'BODEGA') THEN RAISE EXCEPTION 'Origen del producto no válido (PRINCIPAL o BODEGA).'; END IF;
  ELSE
    IF length(v_mot) < 5 THEN RAISE EXCEPTION 'Escribe la razón del cambio (mínimo 5 caracteres).'; END IF;
    v_orig := 'PRINCIPAL';
    v_obj := '';
    v_cult := '';
  END IF;

  v_fecha := COALESCE(public._bodega_fecha_segura(p_datos->>'fecha'), public._bodega_hoy());
  IF v_fecha > public._bodega_hoy() THEN RAISE EXCEPTION 'La fecha no puede ser futura.'; END IF;

  -- Líneas normalizadas
  IF v_tipo = 'CAMBIO' THEN
    v_lin := public._bodega_lineas_cambio(p_lineas);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('producto', ln.producto, 'presentacion', ln.presentacion, 'cantidad', ln.cantidad) ORDER BY ln.producto), '[]'::jsonb)
      INTO v_lin FROM public._bodega_lineas(p_lineas) ln;
  END IF;

  -- Muestra desde el stock de la bodega: exige conteo inicial, fecha ≥ corte y existencia suficiente.
  IF v_tipo = 'MUESTRA' AND v_orig = 'BODEGA' THEN
    IF NOT public._bodega_tiene_inicial(p_bodega) THEN
      RAISE EXCEPTION 'Antes de sacar muestras del stock de la bodega debe aplicar su conteo inicial.';
    END IF;
    IF v_fecha < v_cfg.fecha_corte THEN
      RAISE EXCEPTION 'La fecha no puede ser anterior a la fecha de corte (%).', to_char(v_cfg.fecha_corte, 'DD/MM/YYYY');
    END IF;
    FOR r IN SELECT * FROM public._bodega_lineas(p_lineas) LOOP
      v_saldo := public._bodega_saldo_de(p_bodega, r.producto);
      IF r.cantidad > v_saldo THEN
        RAISE EXCEPTION 'Existencia insuficiente de %: hay %, se piden %.', r.producto, v_saldo, r.cantidad;
      END IF;
    END LOOP;
  END IF;

  v_n    := public._bodega_siguiente(p_bodega, CASE WHEN v_tipo = 'MUESTRA' THEN 'SM' ELSE 'SC' END);
  v_cons := 'BOD-' || v_cfg.codigo || '-' || CASE WHEN v_tipo = 'MUESTRA' THEN 'SM' ELSE 'SC' END || '-' || lpad(v_n::text, 4, '0');

  INSERT INTO "BodegaSolicitudes"
    (consecutivo, bodega_id, tipo, estado, fecha, origen_stock, destinatario, telefono, municipio, departamento,
     tipo_cultivo, objetivo, num_factura, motivo, observaciones, lineas, creado_por_nombre)
  VALUES
    (v_cons, p_bodega, v_tipo, 'Pendiente', v_fecha, v_orig, v_dest, v_tel, v_mun, v_dep,
     v_cult, v_obj, v_fact, v_mot, v_obs, v_lin, v_nombre)
  RETURNING id INTO v_id;

  IF v_tipo = 'MUESTRA' AND v_orig = 'BODEGA' THEN
    INSERT INTO "BodegaMovimientos"
      (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, contraparte, observaciones, solicitud_id, creado_por_nombre)
    SELECT p_bodega, v_fecha, 'SALIDA_MUESTRA', ln.producto,
           COALESCE((SELECT s.presentacion FROM public._bodega_saldos(p_bodega) s WHERE upper(s.producto) = upper(ln.producto) LIMIT 1), ln.presentacion),
           ln.cantidad, v_cons, v_dest, left('Muestra: ' || v_obj, 300), v_id, v_nombre
      FROM public._bodega_lineas(p_lineas) ln;
  END IF;

  SELECT b."Nombre" || COALESCE(' · ' || NULLIF(b."Municipio", ''), '') INTO v_bn FROM "BodegasConsignacion" b WHERE b.id = p_bodega;
  SELECT count(*), COALESCE(sum((x->>'cantidad')::numeric) FILTER (WHERE COALESCE(x->>'sentido', 'DEVUELVE') = 'DEVUELVE'), 0)
    INTO v_nprod, v_uds FROM jsonb_array_elements(v_lin) x;

  PERFORM public._bodega_avisar_solicitud(
    p_bodega, v_tipo,
    CASE WHEN v_tipo = 'MUESTRA' THEN '📨 Solicitud de muestra ' ELSE '🔄 Solicitud de cambio ' END || v_cons,
    v_bn || ' solicita ' || CASE WHEN v_tipo = 'MUESTRA'
        THEN 'una muestra de ' || v_nprod || ' producto(s) (' || v_uds::bigint || ' ud) para ' || v_dest || ' (' || v_mun || '). Objetivo: ' || v_obj
             || CASE WHEN v_orig = 'BODEGA' THEN '. Sale del stock de la bodega (ya se descontó).' ELSE '. La despacha la principal.' END
        ELSE 'un cambio de producto para ' || v_dest || ': devuelve ' || v_uds::bigint || ' ud. Razón: ' || v_mot END,
    v_cons);

  RETURN public._bodega_solicitud_json(v_id);
END;
$function$;

-- ── Devolución a la principal (baja al registrar; documento BOD-<COD>-DV-n; En tránsito hasta que la principal confirme) ──
CREATE OR REPLACE FUNCTION public.bodega_registrar_devolucion(
  p_bodega bigint, p_lineas jsonb, p_motivo text, p_obs text DEFAULT '', p_fecha date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    public."BodegaConfig"%ROWTYPE;
  v_mot    text := btrim(COALESCE(p_motivo, ''));
  v_obs    text := left(btrim(COALESCE(p_obs, '')), 300);
  v_nombre text := public._bodega_actor_nombre();
  v_fecha  date;
  v_n      integer;
  v_doc    text;
  v_id     bigint;
  v_lin    jsonb;
  v_b      record;
  v_uds    numeric;
  r        record;
  v_saldo  numeric;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  PERFORM pg_advisory_xact_lock(74201, p_bodega::integer);

  IF NOT public._bodega_tiene_inicial(p_bodega) THEN
    RAISE EXCEPTION 'Antes de devolver mercancía la bodega debe aplicar su conteo inicial.';
  END IF;
  IF length(v_mot) < 5 THEN RAISE EXCEPTION 'Escribe el motivo de la devolución (mínimo 5 caracteres).'; END IF;
  v_fecha := COALESCE(p_fecha, public._bodega_hoy());
  IF v_fecha > public._bodega_hoy() THEN RAISE EXCEPTION 'La fecha de la devolución no puede ser futura.'; END IF;
  IF v_fecha < v_cfg.fecha_corte THEN
    RAISE EXCEPTION 'La fecha de la devolución no puede ser anterior a la fecha de corte (%).', to_char(v_cfg.fecha_corte, 'DD/MM/YYYY');
  END IF;

  FOR r IN SELECT * FROM public._bodega_lineas(p_lineas) LOOP
    v_saldo := public._bodega_saldo_de(p_bodega, r.producto);
    IF r.cantidad > v_saldo THEN
      RAISE EXCEPTION 'Existencia insuficiente de %: hay %, se devuelven %.', r.producto, v_saldo, r.cantidad;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('producto', ln.producto, 'presentacion', ln.presentacion, 'cantidad', ln.cantidad) ORDER BY ln.producto), '[]'::jsonb),
         COALESCE(sum(ln.cantidad), 0)
    INTO v_lin, v_uds FROM public._bodega_lineas(p_lineas) ln;

  v_n   := public._bodega_siguiente(p_bodega, 'DV');
  v_doc := 'BOD-' || v_cfg.codigo || '-DV-' || lpad(v_n::text, 4, '0');

  INSERT INTO "BodegaSolicitudes"
    (consecutivo, bodega_id, tipo, estado, fecha, destinatario, motivo, observaciones, lineas, creado_por_nombre)
  VALUES (v_doc, p_bodega, 'DEVOLUCION', 'En tránsito', v_fecha, 'Bodega principal', v_mot, v_obs, v_lin, v_nombre)
  RETURNING id INTO v_id;

  INSERT INTO "BodegaMovimientos"
    (bodega_id, fecha, tipo, producto, presentacion, cantidad, documento, contraparte, observaciones, solicitud_id, creado_por_nombre)
  SELECT p_bodega, v_fecha, 'SALIDA_DEVOLUCION_PRINCIPAL', ln.producto,
         COALESCE((SELECT s.presentacion FROM public._bodega_saldos(p_bodega) s WHERE upper(s.producto) = upper(ln.producto) LIMIT 1), ln.presentacion),
         ln.cantidad, v_doc, 'Bodega principal', left(v_mot || CASE WHEN v_obs <> '' THEN ' · ' || v_obs ELSE '' END, 300), v_id, v_nombre
    FROM public._bodega_lineas(p_lineas) ln;

  SELECT b."Nombre", b."Municipio", b."Departamento", b."Nombre_Empresa" INTO v_b
    FROM "BodegasConsignacion" b WHERE b.id = p_bodega;

  PERFORM public._bodega_avisar_solicitud(
    p_bodega, 'DEVOLUCION',
    '↩️ Devolución en tránsito ' || v_doc,
    v_b."Nombre" || COALESCE(' · ' || NULLIF(v_b."Municipio", ''), '') || ' devuelve a la principal ' || v_uds::bigint || ' ud en '
      || jsonb_array_length(v_lin) || ' producto(s). Motivo: ' || v_mot || '. Confírmala en Bodegas en Consignación › Solicitudes cuando llegue y regístrala en Ingresos.',
    v_doc);

  RETURN jsonb_build_object(
    'id', v_id, 'documento', v_doc, 'fecha', v_fecha, 'empresa', v_b."Nombre_Empresa",
    'bodega', jsonb_build_object('id', p_bodega, 'codigo', v_cfg.codigo, 'nombre', v_b."Nombre",
                                 'municipio', v_b."Municipio", 'departamento', v_b."Departamento"),
    'motivo', v_mot, 'observaciones', v_obs, 'usuario', v_nombre, 'estado', 'En tránsito', 'lineas', v_lin);
END;
$function$;

-- ── Cancelar (la bodega): Pendiente (muestra/cambio) o En tránsito (devolución). Reintegra el stock si había movimientos. ──
CREATE OR REPLACE FUNCTION public.bodega_cancelar_solicitud(p_id bigint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_s      public."BodegaSolicitudes"%ROWTYPE;
  v_mot    text := btrim(COALESCE(p_motivo, ''));
  v_nombre text := public._bodega_actor_nombre();
  v_mov    integer;
BEGIN
  SELECT * INTO v_s FROM "BodegaSolicitudes" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada.'; END IF;
  PERFORM public._bodega_acceso(v_s.bodega_id);
  PERFORM pg_advisory_xact_lock(74201, v_s.bodega_id::integer);

  IF length(v_mot) < 5 THEN RAISE EXCEPTION 'Escribe el motivo de la cancelación (mínimo 5 caracteres).'; END IF;
  IF (v_s.tipo = 'DEVOLUCION' AND v_s.estado <> 'En tránsito') OR (v_s.tipo <> 'DEVOLUCION' AND v_s.estado <> 'Pendiente') THEN
    RAISE EXCEPTION 'La solicitud % está en estado «%»: ya no se puede cancelar%.', v_s.consecutivo, v_s.estado,
      CASE WHEN v_s.tipo <> 'DEVOLUCION' AND v_s.estado = 'En proceso' THEN ' (la principal ya la está atendiendo; comunícate con ella)' ELSE '' END;
  END IF;

  v_mov := public._bodega_anular_mov_solicitud(v_s.id, 'Solicitud ' || v_s.consecutivo || ' cancelada por la bodega: ' || v_mot, v_nombre);

  UPDATE "BodegaSolicitudes"
     SET estado = 'Cancelada', cancelado_por = auth.uid(), cancelado_por_nombre = v_nombre, cancelado_en = now(), motivo_cancelacion = v_mot
   WHERE id = v_s.id;

  PERFORM public._bodega_avisar_solicitud(
    v_s.bodega_id, v_s.tipo,
    '🚫 Solicitud cancelada ' || v_s.consecutivo,
    'La bodega canceló ' || CASE v_s.tipo WHEN 'MUESTRA' THEN 'la solicitud de muestra' WHEN 'CAMBIO' THEN 'la solicitud de cambio' ELSE 'la devolución' END
      || ' ' || v_s.consecutivo || '. Motivo: ' || v_mot,
    v_s.consecutivo);

  RETURN public._bodega_solicitud_json(v_s.id) || jsonb_build_object('movimientos_anulados', v_mov);
END;
$function$;

-- ── Lista de la bodega (últimas 200) ──
CREATE OR REPLACE FUNCTION public.bodega_solicitudes(p_bodega bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bodega_acceso(p_bodega);
  RETURN COALESCE((
    SELECT jsonb_agg(public._bodega_solicitud_json(q.id) ORDER BY q.id DESC)
      FROM (SELECT s.id FROM "BodegaSolicitudes" s WHERE s.bodega_id = p_bodega ORDER BY s.id DESC LIMIT 200) q), '[]'::jsonb);
END;
$function$;


-- ════════════════ RPC DE LA PRINCIPAL ════════════════

-- ¿Qué puede hacer quien llama? (para mostrar u ocultar las pestañas; la seguridad real está en cada RPC).
CREATE OR REPLACE FUNCTION public.bodega_principal_permisos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'ver',     EXISTS (SELECT 1 FROM "BodegaConfig" c WHERE c.habilitada AND public._bodega_principal_ver(c.bodega_id)),
    'atiende', EXISTS (SELECT 1 FROM "BodegaConfig" c WHERE c.habilitada
                         AND (public._bodega_principal_atiende(c.bodega_id, 'MUESTRA') OR public._bodega_principal_atiende(c.bodega_id, 'CAMBIO'))),
    'admin',   COALESCE(public.get_user_role() = 'admin', false))
$function$;

-- Bandeja de la principal: solicitudes de las bodegas que puede ver (más recientes primero).
CREATE OR REPLACE FUNCTION public.bodega_solicitudes_principal(p_estado text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BodegaConfig" c WHERE public._bodega_principal_ver(c.bodega_id)) THEN
    RAISE EXCEPTION 'No tienes acceso a las solicitudes de las bodegas.';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public._bodega_solicitud_json(q.id) || jsonb_build_object('puede_atender', public._bodega_principal_atiende(q.bodega_id, q.tipo))
                     ORDER BY q.id DESC)
      FROM (SELECT s.id, s.bodega_id, s.tipo
              FROM "BodegaSolicitudes" s
             WHERE public._bodega_principal_ver(s.bodega_id)
               AND (p_estado IS NULL OR s.estado = p_estado)
             ORDER BY s.id DESC LIMIT 500) q), '[]'::jsonb);
END;
$function$;

-- Atender: p_accion = EN_PROCESO | ATENDIDA | RECHAZADA (muestra/cambio) · RECIBIDA | RECIBIDA_DIF (devolución).
-- ATENDIDA y RECIBIDA exigen la referencia del documento de la principal; RECHAZADA y RECIBIDA_DIF exigen texto en la respuesta.
-- Rechazar una muestra que salió del stock de la bodega REINTEGRA las unidades (anula la salida). NO escribe nada más.
CREATE OR REPLACE FUNCTION public.bodega_solicitud_atender(p_id bigint, p_accion text, p_ref text DEFAULT '', p_respuesta text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_s      public."BodegaSolicitudes"%ROWTYPE;
  v_acc    text := upper(btrim(COALESCE(p_accion, '')));
  v_ref    text := left(btrim(COALESCE(p_ref, '')), 120);
  v_resp   text := left(btrim(COALESCE(p_respuesta, '')), 500);
  v_nombre text;
  v_nuevo  text;
  v_mov    integer := 0;
BEGIN
  SELECT * INTO v_s FROM "BodegaSolicitudes" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada.'; END IF;
  IF NOT public._bodega_principal_atiende(v_s.bodega_id, v_s.tipo) THEN
    RAISE EXCEPTION 'No tienes permiso para atender esta solicitud.';
  END IF;
  PERFORM pg_advisory_xact_lock(74201, v_s.bodega_id::integer);
  SELECT COALESCE(u.nombre, 'Principal') INTO v_nombre FROM usuarios u WHERE u.id = auth.uid();

  IF v_s.tipo = 'DEVOLUCION' THEN
    IF v_s.estado <> 'En tránsito' THEN
      RAISE EXCEPTION 'La devolución % está en estado «%»: ya no se puede confirmar.', v_s.consecutivo, v_s.estado;
    END IF;
    IF v_acc = 'RECIBIDA' THEN
      IF length(v_ref) < 2 THEN RAISE EXCEPTION 'Escribe la referencia del ingreso en la principal (remisión de entrada).'; END IF;
      v_nuevo := 'Recibida';
    ELSIF v_acc = 'RECIBIDA_DIF' THEN
      IF length(v_resp) < 5 THEN RAISE EXCEPTION 'Describe la diferencia encontrada (mínimo 5 caracteres).'; END IF;
      v_nuevo := 'Recibida con diferencia';
    ELSE
      RAISE EXCEPTION 'Acción no válida para una devolución (RECIBIDA o RECIBIDA_DIF).';
    END IF;
  ELSE
    IF v_s.estado NOT IN ('Pendiente', 'En proceso') THEN
      RAISE EXCEPTION 'La solicitud % está en estado «%»: ya no se puede atender.', v_s.consecutivo, v_s.estado;
    END IF;
    IF v_acc = 'EN_PROCESO' THEN
      IF v_s.estado <> 'Pendiente' THEN RAISE EXCEPTION 'La solicitud % ya está en proceso.', v_s.consecutivo; END IF;
      v_nuevo := 'En proceso';
    ELSIF v_acc = 'ATENDIDA' THEN
      IF length(v_ref) < 2 THEN RAISE EXCEPTION 'Escribe la referencia del documento en la principal (consecutivo de la muestra o del cambio).'; END IF;
      v_nuevo := 'Atendida';
    ELSIF v_acc = 'RECHAZADA' THEN
      IF length(v_resp) < 5 THEN RAISE EXCEPTION 'Escribe el motivo del rechazo (mínimo 5 caracteres).'; END IF;
      v_nuevo := 'Rechazada';
      v_mov := public._bodega_anular_mov_solicitud(v_s.id, 'Solicitud ' || v_s.consecutivo || ' rechazada por la principal: ' || v_resp, v_nombre);
    ELSE
      RAISE EXCEPTION 'Acción no válida (EN_PROCESO, ATENDIDA o RECHAZADA).';
    END IF;
  END IF;

  UPDATE "BodegaSolicitudes"
     SET estado = v_nuevo,
         ref_principal = COALESCE(NULLIF(v_ref, ''), ref_principal),
         respuesta = COALESCE(NULLIF(v_resp, ''), respuesta),
         atendido_por = auth.uid(), atendido_por_nombre = v_nombre, atendido_en = now()
   WHERE id = v_s.id;

  RETURN public._bodega_solicitud_json(v_s.id) || jsonb_build_object('movimientos_anulados', v_mov);
END;
$function$;

-- Supervisión (solo lectura): existencias de cada bodega habilitada que el usuario puede ver.
CREATE OR REPLACE FUNCTION public.bodega_supervision_resumen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BodegaConfig" c WHERE public._bodega_principal_ver(c.bodega_id)) THEN
    RAISE EXCEPTION 'No tienes acceso a las existencias de las bodegas.';
  END IF;
  RETURN jsonb_build_object('bodegas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'bodega_id', c.bodega_id, 'codigo', c.codigo, 'nombre', b."Nombre", 'municipio', b."Municipio",
        'departamento', b."Departamento", 'empresa', b."Nombre_Empresa",
        'fecha_corte', c.fecha_corte, 'inicial_aplicado', public._bodega_tiene_inicial(c.bodega_id),
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('producto', s.producto, 'presentacion', s.presentacion, 'existencia', s.existencia) ORDER BY s.producto)
                             FROM public._bodega_saldos(c.bodega_id) s WHERE s.existencia <> 0), '[]'::jsonb),
        'unidades', COALESCE((SELECT sum(s.existencia) FROM public._bodega_saldos(c.bodega_id) s), 0),
        'en_transito_traslados', COALESCE((SELECT sum(m.cantidad) FROM "BodegaTraslados" t
                                             JOIN "BodegaMovimientos" m ON m.traslado_id = t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
                                            WHERE t.bodega_origen = c.bodega_id AND t.estado = 'En tránsito'), 0),
        'en_transito_devoluciones', COALESCE((SELECT sum(m.cantidad) FROM "BodegaSolicitudes" s
                                                JOIN "BodegaMovimientos" m ON m.solicitud_id = s.id AND m.tipo = 'SALIDA_DEVOLUCION_PRINCIPAL' AND m.estado = 'Activo'
                                               WHERE s.bodega_id = c.bodega_id AND s.estado = 'En tránsito'), 0),
        'solicitudes_abiertas', (SELECT count(*) FROM "BodegaSolicitudes" s WHERE s.bodega_id = c.bodega_id AND s.estado IN ('Pendiente', 'En proceso', 'En tránsito')),
        'ultimo_movimiento', (SELECT max(m.fecha) FROM "BodegaMovimientos" m WHERE m.bodega_id = c.bodega_id AND m.estado = 'Activo'))
      ORDER BY b."Nombre_Empresa", b."Nombre", b."Municipio", c.bodega_id)
      FROM "BodegaConfig" c
      JOIN "BodegasConsignacion" b ON b.id = c.bodega_id AND COALESCE(b."Activo", true)
     WHERE c.habilitada AND public._bodega_principal_ver(c.bodega_id)), '[]'::jsonb));
END;
$function$;


-- ════════════════ bodega_existencias: + devoluciones en tránsito ════════════════
-- (mismo cuerpo vigente + la clave 'en_transito_devolucion')
CREATE OR REPLACE FUNCTION public.bodega_existencias(p_bodega bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public."BodegaConfig"%ROWTYPE;
BEGIN
  v_cfg := public._bodega_acceso(p_bodega);
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('producto', s.producto, 'presentacion', s.presentacion, 'existencia', s.existencia)
                       ORDER BY s.producto)
        FROM public._bodega_saldos(p_bodega) s WHERE s.existencia <> 0), '[]'::jsonb),
    'en_transito_salida', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'traslado_id', t.id, 'consecutivo', t.consecutivo,
               'destino', bd."Nombre" || COALESCE(' · ' || NULLIF(bd."Municipio", ''), ''),
               'producto', m.producto, 'presentacion', m.presentacion, 'cantidad', m.cantidad)
             ORDER BY t.id, m.producto)
        FROM "BodegaTraslados" t
        JOIN "BodegaMovimientos" m ON m.traslado_id = t.id AND m.tipo = 'SALIDA_TRASLADO_BODEGA' AND m.estado = 'Activo'
        JOIN "BodegasConsignacion" bd ON bd.id = t.bodega_destino
       WHERE t.bodega_origen = p_bodega AND t.estado = 'En tránsito'), '[]'::jsonb),
    'en_transito_devolucion', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'solicitud_id', s.id, 'consecutivo', s.consecutivo,
               'producto', m.producto, 'presentacion', m.presentacion, 'cantidad', m.cantidad)
             ORDER BY s.id, m.producto)
        FROM "BodegaSolicitudes" s
        JOIN "BodegaMovimientos" m ON m.solicitud_id = s.id AND m.tipo = 'SALIDA_DEVOLUCION_PRINCIPAL' AND m.estado = 'Activo'
       WHERE s.bodega_id = p_bodega AND s.estado = 'En tránsito'), '[]'::jsonb),
    'por_recibir_bodega', (SELECT count(*) FROM "BodegaTraslados" t WHERE t.bodega_destino = p_bodega AND t.estado = 'En tránsito'),
    'inicial_aplicado', public._bodega_tiene_inicial(p_bodega));
END;
$function$;


-- ════════════════ PERMISOS ════════════════
-- Mismo criterio que el núcleo: las bodega_* las ejecuta cualquier sesión (la guarda está dentro del cuerpo);
-- las _bodega_* internas, nadie.
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

NOTIFY pgrst, 'reload schema';
