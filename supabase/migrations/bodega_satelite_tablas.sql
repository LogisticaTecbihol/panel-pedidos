-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite / consignación — PARTE 1 de 5: tablas (libro propio + identidad)
-- ════════════════════════════════════════════════════════════════════════════
-- Plan: «Gestión de inventario en bodegas satélite / consignación» (2026-11-17).
-- Piloto: IASO — Bodega COATOL (Chicoral), Bodega COATOL (Ibagué) y Bodega ESPINAL.
--
-- QUÉ HACE: crea las tablas Bodega* — un libro de inventario propio por bodega y la
-- identidad de sus usuarios. NO toca ninguna tabla, función ni política existente:
-- _kx_movs, get_saldos_holding, Kardex, Existencias, Dashboard y Reportes siguen
-- leyendo exactamente lo mismo (ninguno referencia estas tablas).
--
-- AISLAMIENTO: los usuarios de bodega son usuarios de Supabase Auth SIN fila en
-- public.usuarios. get_user_role() devuelve NULL para ellos y todas las políticas de
-- la principal piden un rol, así que no ven nada de la principal (comprobado en
-- producción: solo leen `empresas`). Estas tablas NO tienen políticas de escritura:
-- se escriben SOLO por RPC (SECURITY DEFINER, migraciones siguientes). Lectura directa:
-- solo admin (para Backup y soporte); los usuarios de bodega leen por RPC.
--
-- DECISIONES (revisión del plan, 2026-11-17):
--   • Clave del saldo = (bodega, producto normalizado sin mayúsculas). `maestro_productos`
--     solo tiene el nombre (la presentación va dentro: «X LITRO») y Pedidos.Presentacion
--     viene escrita de varias formas («kilo», «1 KG», «100ML»); separar el saldo por
--     presentación partiría el mismo producto. `presentacion` se guarda como dato visible.
--   • BodegaConfig / BodegaUsuarios / BodegaUsuarioBodegas llevan `id` propio: fn_audit_log
--     exige una columna `id`.
--   • ENTRADA_TRASLADO y ENTRADA_TRASLADO_BODEGA admiten cantidad 0 (línea que nunca
--     llegó): así la línea queda cerrada «con diferencia» y no reaparece como pendiente.
--
-- Idempotente. Rollback: bodega_satelite_tablas_rollback.sql (BORRA los datos Bodega*).
-- Aplicar con apply_migration del MCP ANTES de publicar el código (el push a GitHub no
-- aplica SQL). Orden de las 5 partes: tablas → avisos → nucleo → traslados_bodega → admin.
-- Fecha: 2026-11-17
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. BodegaConfig: bodega habilitada para gestión ────────────────────────
CREATE TABLE IF NOT EXISTS public."BodegaConfig" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bodega_id             bigint  NOT NULL UNIQUE REFERENCES public."BodegasConsignacion"(id),
  codigo                text    NOT NULL UNIQUE
                          CONSTRAINT chk_bodega_codigo CHECK (codigo ~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{2,12})?$'),
  fecha_corte           date    NOT NULL,
  habilitada            boolean NOT NULL DEFAULT true,
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz
);
COMMENT ON TABLE public."BodegaConfig" IS
  'Bodega en consignación habilitada para gestionar su propio inventario. codigo = prefijo de las series BOD-<codigo>-RS/TR/DV. fecha_corte = fecha del conteo físico inicial.';


-- ── 2. BodegaUsuarios / BodegaUsuarioBodegas: identidad de los usuarios de bodega ──
CREATE TABLE IF NOT EXISTS public."BodegaUsuarios" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id            uuid    NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre                text    NOT NULL CONSTRAINT chk_bodega_usuario_nombre CHECK (btrim(nombre) <> ''),
  email                 text    NOT NULL,
  activo                boolean NOT NULL DEFAULT true,
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz
);
COMMENT ON TABLE public."BodegaUsuarios" IS
  'Usuarios de las bodegas satélite. Son usuarios de Auth SIN fila en public.usuarios (así no ven nada de la principal).';

CREATE TABLE IF NOT EXISTS public."BodegaUsuarioBodegas" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id            uuid   NOT NULL REFERENCES public."BodegaUsuarios"(usuario_id) ON DELETE CASCADE,
  bodega_id             bigint NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz,
  CONSTRAINT uq_bodega_usuario_bodega UNIQUE (usuario_id, bodega_id)
);


-- ── 3. BodegaConsecutivos: series propias (no toca consecutivos_remisiones) ──
CREATE TABLE IF NOT EXISTS public."BodegaConsecutivos" (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bodega_id bigint  NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  tipo      text    NOT NULL CONSTRAINT chk_bodega_consec_tipo CHECK (tipo IN ('RS', 'DV', 'TR')),
  ultimo    integer NOT NULL DEFAULT 0,
  CONSTRAINT uq_bodega_consecutivo UNIQUE (bodega_id, tipo)
);
COMMENT ON TABLE public."BodegaConsecutivos" IS
  'RS = salida/despacho, DV = devolución a la principal (fase 2), TR = traslado entre bodegas. Serie: BOD-<codigo>-<tipo>-0001.';


-- ── 4. Conteos físicos (cabecera + líneas) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."BodegaConteos" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bodega_id             bigint NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  fecha                 date   NOT NULL,
  tipo                  text   NOT NULL CONSTRAINT chk_bodega_conteo_tipo CHECK (tipo IN ('INICIAL', 'PERIODICO')),
  estado                text   NOT NULL DEFAULT 'Borrador' CONSTRAINT chk_bodega_conteo_estado CHECK (estado IN ('Borrador', 'Aplicado')),
  observaciones         text   NOT NULL DEFAULT '',
  aplicado_por          uuid,
  aplicado_por_nombre   text,
  aplicado_en           timestamptz,
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz
);
-- Un solo conteo INICIAL aplicado por bodega.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodega_conteo_inicial
  ON public."BodegaConteos" (bodega_id) WHERE tipo = 'INICIAL' AND estado = 'Aplicado';
CREATE INDEX IF NOT EXISTS ix_bodega_conteos_bodega ON public."BodegaConteos" (bodega_id, fecha DESC);

CREATE TABLE IF NOT EXISTS public."BodegaConteoLineas" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conteo_id             bigint  NOT NULL REFERENCES public."BodegaConteos"(id) ON DELETE CASCADE,
  producto              text    NOT NULL,
  presentacion          text    NOT NULL DEFAULT '',
  cant_sistema          numeric NOT NULL DEFAULT 0,
  cant_fisica           numeric NOT NULL CONSTRAINT chk_bodega_conteo_fisica CHECK (cant_fisica >= 0),
  diferencia            numeric GENERATED ALWAYS AS (cant_fisica - cant_sistema) STORED,
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodega_conteolinea_producto
  ON public."BodegaConteoLineas" (conteo_id, upper(producto));


-- ── 5. Traslados entre bodegas satélite (cabecera) ──────────────────────────
CREATE TABLE IF NOT EXISTS public."BodegaTraslados" (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consecutivo             text   NOT NULL UNIQUE,
  bodega_origen           bigint NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  bodega_destino          bigint NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  fecha                   date   NOT NULL,
  estado                  text   NOT NULL DEFAULT 'En tránsito'
                            CONSTRAINT chk_bodega_traslado_estado CHECK (estado IN ('En tránsito', 'Recibido', 'Recibido con diferencia', 'Cancelado')),
  observaciones           text   NOT NULL DEFAULT '',
  enviado_por             uuid,
  enviado_por_nombre      text,
  enviado_en              timestamptz NOT NULL DEFAULT now(),
  recibido_por            uuid,
  recibido_por_nombre     text,
  recibido_en             timestamptz,
  obs_recepcion           text,
  cancelado_por           uuid,
  cancelado_por_nombre    text,
  cancelado_en            timestamptz,
  motivo_cancelacion      text,
  creado_por              uuid,
  creado_por_nombre       text,
  creado_en               timestamptz,
  modificado_por          uuid,
  modificado_por_nombre   text,
  modificado_en           timestamptz,
  CONSTRAINT chk_bodega_traslado_distintas CHECK (bodega_origen <> bodega_destino)
);
CREATE INDEX IF NOT EXISTS ix_bodega_traslados_origen  ON public."BodegaTraslados" (bodega_origen, id DESC);
CREATE INDEX IF NOT EXISTS ix_bodega_traslados_destino ON public."BodegaTraslados" (bodega_destino, estado);


-- ── 6. BodegaMovimientos: el libro (el signo sale del tipo) ─────────────────
CREATE TABLE IF NOT EXISTS public."BodegaMovimientos" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bodega_id             bigint  NOT NULL REFERENCES public."BodegaConfig"(bodega_id),
  fecha                 date    NOT NULL,
  tipo                  text    NOT NULL
    CONSTRAINT chk_bodega_mov_tipo CHECK (tipo IN (
      'SALDO_INICIAL', 'ENTRADA_TRASLADO', 'ENTRADA_TRASLADO_BODEGA', 'AJUSTE_SOBRANTE',
      'SALIDA_DESPACHO', 'SALIDA_DEVOLUCION_PRINCIPAL', 'SALIDA_TRASLADO_BODEGA', 'AJUSTE_FALTANTE')),
  producto              text    NOT NULL,
  presentacion          text    NOT NULL DEFAULT '',
  cantidad              numeric NOT NULL,
  documento             text    NOT NULL DEFAULT '',
  origen_remision       text,
  cant_despachada       numeric,
  contraparte           text    NOT NULL DEFAULT '',
  observaciones         text    NOT NULL DEFAULT '',
  conteo_id             bigint  REFERENCES public."BodegaConteos"(id),
  traslado_id           bigint  REFERENCES public."BodegaTraslados"(id),
  estado                text    NOT NULL DEFAULT 'Activo' CONSTRAINT chk_bodega_mov_estado CHECK (estado IN ('Activo', 'Anulado')),
  motivo_anulacion      text,
  anulado_por           uuid,
  anulado_por_nombre    text,
  anulado_en            timestamptz,
  creado_por            uuid,
  creado_por_nombre     text,
  creado_en             timestamptz,
  modificado_por        uuid,
  modificado_por_nombre text,
  modificado_en         timestamptz,
  CONSTRAINT chk_bodega_mov_cantidad CHECK (
    cantidad > 0 OR (tipo IN ('ENTRADA_TRASLADO', 'ENTRADA_TRASLADO_BODEGA') AND cantidad >= 0)),
  CONSTRAINT chk_bodega_mov_remision CHECK (
    tipo <> 'ENTRADA_TRASLADO' OR (origen_remision IS NOT NULL AND btrim(origen_remision) <> '')),
  CONSTRAINT chk_bodega_mov_traslado CHECK (
    (tipo IN ('ENTRADA_TRASLADO_BODEGA', 'SALIDA_TRASLADO_BODEGA')) = (traslado_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_bodega_mov_bodega_fecha ON public."BodegaMovimientos" (bodega_id, fecha, id);
CREATE INDEX IF NOT EXISTS ix_bodega_mov_producto     ON public."BodegaMovimientos" (bodega_id, upper(producto)) WHERE estado = 'Activo';
CREATE INDEX IF NOT EXISTS ix_bodega_mov_documento    ON public."BodegaMovimientos" (bodega_id, documento);
CREATE INDEX IF NOT EXISTS ix_bodega_mov_traslado     ON public."BodegaMovimientos" (traslado_id) WHERE traslado_id IS NOT NULL;
-- Recibir dos veces la misma línea de una remisión de la principal es imposible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodega_entrada_traslado
  ON public."BodegaMovimientos" (bodega_id, origen_remision, upper(producto))
  WHERE tipo = 'ENTRADA_TRASLADO' AND estado = 'Activo';
COMMENT ON TABLE public."BodegaMovimientos" IS
  'Libro de inventario de las bodegas satélite (solo producto terminado bueno). Suma: SALDO_INICIAL, ENTRADA_TRASLADO, ENTRADA_TRASLADO_BODEGA, AJUSTE_SOBRANTE. Resta: SALIDA_DESPACHO, SALIDA_DEVOLUCION_PRINCIPAL, SALIDA_TRASLADO_BODEGA, AJUSTE_FALTANTE. Nada se borra: se anula.';


-- ── 7. Candados ─────────────────────────────────────────────────────────────
-- 7a. Un movimiento no se edita ni se borra: solo pasa de Activo a Anulado.
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
      NEW.origen_remision, NEW.cant_despachada, NEW.contraparte, NEW.observaciones, NEW.conteo_id, NEW.traslado_id)
     IS DISTINCT FROM
     (OLD.bodega_id, OLD.fecha, OLD.tipo, OLD.producto, OLD.presentacion, OLD.cantidad, OLD.documento,
      OLD.origen_remision, OLD.cant_despachada, OLD.contraparte, OLD.observaciones, OLD.conteo_id, OLD.traslado_id) THEN
    RAISE EXCEPTION 'Un movimiento de bodega no se edita: se anula y se registra otro.';
  END IF;
  IF OLD.estado = 'Anulado' AND NEW.estado <> 'Anulado' THEN
    RAISE EXCEPTION 'Un movimiento anulado no se reactiva.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bodega_mov_guard ON public."BodegaMovimientos";
CREATE TRIGGER trg_bodega_mov_guard
  BEFORE UPDATE OR DELETE ON public."BodegaMovimientos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_bodega_mov_guard();

-- 7b. Un traslado entre bodegas solo es posible dentro de la MISMA empresa
--     (cambiar de empresa cambia el dueño del inventario y va por la principal).
CREATE OR REPLACE FUNCTION public.fn_bodega_traslado_misma_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o text;
  v_d text;
BEGIN
  SELECT "Nombre_Empresa" INTO v_o FROM "BodegasConsignacion" WHERE id = NEW.bodega_origen;
  SELECT "Nombre_Empresa" INTO v_d FROM "BodegasConsignacion" WHERE id = NEW.bodega_destino;
  IF v_o IS NULL OR v_d IS NULL OR btrim(v_o) <> btrim(v_d) THEN
    RAISE EXCEPTION 'Solo se puede trasladar entre bodegas de la misma empresa.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bodega_traslado_misma_empresa ON public."BodegaTraslados";
CREATE TRIGGER trg_bodega_traslado_misma_empresa
  BEFORE INSERT ON public."BodegaTraslados"
  FOR EACH ROW EXECUTE FUNCTION public.fn_bodega_traslado_misma_empresa();


-- ── 8. Auditoría (mismos triggers que el resto del panel) ───────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['BodegaConfig', 'BodegaUsuarios', 'BodegaUsuarioBodegas', 'BodegaConteos',
                           'BodegaConteoLineas', 'BodegaTraslados', 'BodegaMovimientos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_auditoria_row BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_row()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_log ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log()', t);
  END LOOP;
END
$$;


-- ── 9. RLS: sin políticas de escritura; lectura directa solo admin ──────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['BodegaConfig', 'BodegaUsuarios', 'BodegaUsuarioBodegas', 'BodegaConsecutivos',
                           'BodegaConteos', 'BodegaConteoLineas', 'BodegaTraslados', 'BodegaMovimientos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.get_user_role()) = ''admin'')',
                   t || '_select_admin', t);
    -- Defensa en profundidad: anon no ve estas tablas y authenticated solo puede LEER (con la política).
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
  END LOOP;
END
$$;
