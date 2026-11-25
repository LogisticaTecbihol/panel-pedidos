-- ============================================================
-- Vencimientos de vehículos (SOAT y técnico-mecánica) + aviso al grupo de WhatsApp
--
-- Pedido 2026-11-25. Módulo «🚗 Vencimientos de Vehículos» (vehiculos-vencimientos.html):
-- se llevan las fechas de vencimiento por placa y una Edge Function diaria
-- (vencimientos-vehiculos-aviso, programada con pg_cron) avisa al grupo de WhatsApp.
--
-- Piezas:
--   0. Dos permisos nuevos en usuario_modulos:
--        vehiculos_vencimientos          -> VER (entrar al módulo y leer)
--        vehiculos_vencimientos_editar   -> EDITAR (requiere también «ver»; el rol lector nunca escribe)
--   1. VehiculosVencimientos        una fila por placa (propietario, identificación, activo).
--      Tabla INDEPENDIENTE de "Vehiculos" (catálogo de Legalización de gastos): no la toca.
--   2. VehiculosVencimientosDocs    una fila por (vehículo, documento): SOAT | TECNOMECANICA.
--   3. VehiculosVencimientosEstado  último escalón avisado por documento (solo la Edge Function;
--      va aparte para que marcar un aviso no ensucie la auditoría de los datos).
--   4. VehiculosVencimientosAvisos  historial de avisos enviados (o fallidos).
--   5. RPC guardar_vehiculo_vencimiento (SECURITY INVOKER: aplican las RLS) y funciones de
--      avisos vv_pendientes / vv_marcar (solo service_role).
--
-- Avisos: un solo mensaje diario con lo NUEVO. Escalones 30, 15, 7, 3 días y el día 0; ya vencido,
-- recordatorio cada 7 días. Cada escalón se avisa una vez; si el cron falla un día se recupera al
-- siguiente. Al cambiar la fecha de un documento (renovación) sus avisos se reinician solos.
--
-- Idempotente. Aplicar con apply_migration ANTES de publicar el código.
-- Fecha: 2026-11-25
-- ============================================================


-- ── 0. Permisos nuevos (CHECK de public.usuario_modulos) ──
-- Lista = la vigente en producción el 2026-11-25 + las dos claves nuevas. Ojo: otro esquema
-- tiene una tabla con el mismo nombre de CHECK (por eso se califica public.usuario_modulos).
ALTER TABLE public.usuario_modulos DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;
ALTER TABLE public.usuario_modulos ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'bodegas_consignacion','cartera','clientes','crm','dashboard','dashboard_rentabilidad',
    'devoluciones','ingresos','inventario','kardex','legalizacion_gastos',
    'legalizacion_gastos_aprobar','lista_precios','muestras','muestras_aprobar','notificaciones',
    'ordenes','ordenes_aprobar','pedidos','pedidos_editar_cantidad','prod_ajustes','prod_compras',
    'prod_consumos_detalle','prod_costos','prod_custodia','prod_entregas','prod_formulas',
    'prod_indicadores','prod_inventario','prod_kardex','prod_maestros','prod_mp_nombres',
    'prod_ordenes','prod_pnc','prod_recepciones','prod_traslados','productos','reabastecimiento',
    'reenvases','reportes','solicitudes_mercadeo','solicitudes_mercadeo_aprobar',
    'vehiculos_vencimientos','vehiculos_vencimientos_editar'
  ]::text[]));


-- ── 1. Vehículos ──
CREATE TABLE IF NOT EXISTS public."VehiculosVencimientos" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Placa"               text    NOT NULL,
  "Propietario"         text    NOT NULL DEFAULT '',
  "Identificacion"      text    NOT NULL DEFAULT '',   -- C.C. o NIT (texto: algunos NIT llevan guion)
  "Activo"              boolean NOT NULL DEFAULT true, -- false = no se avisa más de este vehículo
  "creado_por"            uuid,
  "creado_por_nombre"     text,
  "creado_en"             timestamptz,
  "modificado_por"        uuid,
  "modificado_por_nombre" text,
  "modificado_en"         timestamptz,
  CONSTRAINT vv_placa_formato CHECK (char_length("Placa") BETWEEN 3 AND 10 AND "Placa" = upper("Placa") AND "Placa" !~ '\s')
);
CREATE UNIQUE INDEX IF NOT EXISTS vv_placa_unica ON public."VehiculosVencimientos" ("Placa");

COMMENT ON TABLE public."VehiculosVencimientos" IS
  'Vehículos con control de vencimiento de documentos (módulo Vencimientos de Vehículos). Independiente de "Vehiculos" (catálogo de Legalización de gastos). Baja lógica con Activo=false; borrar solo admin.';


-- ── 2. Documentos y fecha de vencimiento ──
CREATE TABLE IF NOT EXISTS public."VehiculosVencimientosDocs" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Vehiculo_Id"         bigint NOT NULL REFERENCES public."VehiculosVencimientos"(id) ON DELETE CASCADE,
  "Documento"           text   NOT NULL,
  "Fecha_Vencimiento"   date   NOT NULL,
  "creado_por"            uuid,
  "creado_por_nombre"     text,
  "creado_en"             timestamptz,
  "modificado_por"        uuid,
  "modificado_por_nombre" text,
  "modificado_en"         timestamptz,
  CONSTRAINT vvd_documento_valido CHECK ("Documento" IN ('SOAT', 'TECNOMECANICA')),
  CONSTRAINT vvd_fecha_razonable  CHECK ("Fecha_Vencimiento" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  CONSTRAINT vvd_unico UNIQUE ("Vehiculo_Id", "Documento")
);

COMMENT ON TABLE public."VehiculosVencimientosDocs" IS
  'Fecha de vencimiento de cada documento (SOAT | TECNOMECANICA) por vehículo. Para otro documento hay que ampliar el CHECK vvd_documento_valido.';


-- ── 3. Último escalón avisado (solo service_role / funciones; sin políticas) ──
CREATE TABLE IF NOT EXISTS public."VehiculosVencimientosEstado" (
  doc_id         bigint PRIMARY KEY REFERENCES public."VehiculosVencimientosDocs"(id) ON DELETE CASCADE,
  ultimo_umbral  int  NOT NULL,   -- 30, 15, 7, 3, 0 o -1 (vencido)
  ultimo_aviso   date NOT NULL
);

COMMENT ON TABLE public."VehiculosVencimientosEstado" IS
  'Último escalón de aviso enviado por documento. Lo escribe solo vv_marcar (service_role) y se borra al cambiar la fecha del documento.';


-- ── 4. Historial de avisos ──
CREATE TABLE IF NOT EXISTS public."VehiculosVencimientosAvisos" (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Creado_En"         timestamptz NOT NULL DEFAULT now(),
  "Origen"            text NOT NULL,                 -- automatico (cron) | manual (botón «Enviar aviso ahora»)
  "Estado"            text NOT NULL,                 -- enviado | error
  "Documentos"        int  NOT NULL DEFAULT 0,       -- cuántos documentos iban en el mensaje
  "Mensaje"           text NOT NULL DEFAULT '',
  "Error"             text,
  "Enviado_Por"       uuid,
  "Enviado_Por_Nombre" text,
  CONSTRAINT vva_origen CHECK ("Origen" IN ('automatico', 'manual')),
  CONSTRAINT vva_estado CHECK ("Estado" IN ('enviado', 'error'))
);
CREATE INDEX IF NOT EXISTS vva_creado_en ON public."VehiculosVencimientosAvisos" ("Creado_En" DESC);

COMMENT ON TABLE public."VehiculosVencimientosAvisos" IS
  'Historial de avisos de vencimiento enviados al grupo de WhatsApp (o que fallaron). Lo escribe solo la Edge Function vencimientos-vehiculos-aviso; no se edita ni se borra.';


-- ── 5. Triggers ──
-- 5a. Normaliza placa y textos (la placa queda en mayúsculas y sin espacios).
CREATE OR REPLACE FUNCTION public.vv_normalizar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW."Placa"          := upper(regexp_replace(btrim(coalesce(NEW."Placa", '')), '\s+', '', 'g'));
  NEW."Propietario"    := btrim(coalesce(NEW."Propietario", ''));
  NEW."Identificacion" := btrim(coalesce(NEW."Identificacion", ''));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.vv_normalizar() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vv_normalizar ON public."VehiculosVencimientos";
CREATE TRIGGER trg_vv_normalizar
  BEFORE INSERT OR UPDATE ON public."VehiculosVencimientos"
  FOR EACH ROW EXECUTE FUNCTION public.vv_normalizar();

-- 5b. Auditoría estándar del panel (quién y cuándo; valor anterior en audit_log).
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."VehiculosVencimientos";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."VehiculosVencimientos"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();
DROP TRIGGER IF EXISTS trg_audit_log ON public."VehiculosVencimientos";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."VehiculosVencimientos"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."VehiculosVencimientosDocs";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."VehiculosVencimientosDocs"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();
DROP TRIGGER IF EXISTS trg_audit_log ON public."VehiculosVencimientosDocs";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."VehiculosVencimientosDocs"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- 5c. Renovación: si cambia la fecha de un documento se reinician sus avisos.
CREATE OR REPLACE FUNCTION public.vv_reset_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW."Fecha_Vencimiento" IS DISTINCT FROM OLD."Fecha_Vencimiento" THEN
    DELETE FROM public."VehiculosVencimientosEstado" WHERE doc_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.vv_reset_estado() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vv_reset_estado ON public."VehiculosVencimientosDocs";
CREATE TRIGGER trg_vv_reset_estado
  AFTER UPDATE OF "Fecha_Vencimiento" ON public."VehiculosVencimientosDocs"
  FOR EACH ROW EXECUTE FUNCTION public.vv_reset_estado();


-- ── 6. RLS ──
ALTER TABLE public."VehiculosVencimientos"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VehiculosVencimientosDocs"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VehiculosVencimientosEstado" ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo service_role
ALTER TABLE public."VehiculosVencimientosAvisos" ENABLE ROW LEVEL SECURITY;

-- user_has_module() ya devuelve true para el administrador. El rol «lector» nunca escribe.
DROP POLICY IF EXISTS "VV_select" ON public."VehiculosVencimientos";
CREATE POLICY "VV_select" ON public."VehiculosVencimientos" FOR SELECT TO authenticated
  USING (public.user_has_module('vehiculos_vencimientos'));
DROP POLICY IF EXISTS "VV_insert" ON public."VehiculosVencimientos";
CREATE POLICY "VV_insert" ON public."VehiculosVencimientos" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector');
DROP POLICY IF EXISTS "VV_update" ON public."VehiculosVencimientos";
CREATE POLICY "VV_update" ON public."VehiculosVencimientos" FOR UPDATE TO authenticated
  USING (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector')
  WITH CHECK (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector');
DROP POLICY IF EXISTS "VV_delete" ON public."VehiculosVencimientos";
CREATE POLICY "VV_delete" ON public."VehiculosVencimientos" FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');   -- el resto da de baja con Activo=false

DROP POLICY IF EXISTS "VVD_select" ON public."VehiculosVencimientosDocs";
CREATE POLICY "VVD_select" ON public."VehiculosVencimientosDocs" FOR SELECT TO authenticated
  USING (public.user_has_module('vehiculos_vencimientos'));
DROP POLICY IF EXISTS "VVD_insert" ON public."VehiculosVencimientosDocs";
CREATE POLICY "VVD_insert" ON public."VehiculosVencimientosDocs" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector');
DROP POLICY IF EXISTS "VVD_update" ON public."VehiculosVencimientosDocs";
CREATE POLICY "VVD_update" ON public."VehiculosVencimientosDocs" FOR UPDATE TO authenticated
  USING (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector')
  WITH CHECK (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector');
DROP POLICY IF EXISTS "VVD_delete" ON public."VehiculosVencimientosDocs";
CREATE POLICY "VVD_delete" ON public."VehiculosVencimientosDocs" FOR DELETE TO authenticated
  USING (public.user_has_module('vehiculos_vencimientos_editar') AND coalesce(public.get_user_role(), '') <> 'lector');

DROP POLICY IF EXISTS "VVA_select" ON public."VehiculosVencimientosAvisos";
CREATE POLICY "VVA_select" ON public."VehiculosVencimientosAvisos" FOR SELECT TO authenticated
  USING (public.user_has_module('vehiculos_vencimientos'));
-- Sin INSERT/UPDATE/DELETE para clientes: el historial lo escribe solo la Edge Function (service_role).

REVOKE ALL ON public."VehiculosVencimientos", public."VehiculosVencimientosDocs",
              public."VehiculosVencimientosEstado", public."VehiculosVencimientosAvisos" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."VehiculosVencimientos", public."VehiculosVencimientosDocs" TO authenticated;
-- Los privilegios por defecto del proyecto dan ALL (incluido TRUNCATE) a authenticated: por eso se revoca todo arriba y
-- se concede solo lo necesario. El historial es de solo lectura para el navegador; Estado no se concede a nadie.
GRANT SELECT ON public."VehiculosVencimientosAvisos" TO authenticated;
GRANT ALL ON public."VehiculosVencimientos", public."VehiculosVencimientosDocs",
             public."VehiculosVencimientosEstado", public."VehiculosVencimientosAvisos" TO service_role;


-- ── 7. Guardar un vehículo con sus dos fechas, atómico (SECURITY INVOKER: aplican las RLS) ──
-- p_soat / p_tecnomecanica en NULL = quitar ese documento (se borra la fila).
CREATE OR REPLACE FUNCTION public.guardar_vehiculo_vencimiento(
  p_id              bigint,
  p_placa           text,
  p_propietario     text,
  p_identificacion  text,
  p_activo          boolean,
  p_soat            date,
  p_tecnomecanica   date
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_id bigint := p_id;
BEGIN
  IF btrim(coalesce(p_placa, '')) = '' THEN
    RAISE EXCEPTION 'La placa es obligatoria' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO "VehiculosVencimientos" ("Placa", "Propietario", "Identificacion", "Activo")
    VALUES (p_placa, coalesce(p_propietario, ''), coalesce(p_identificacion, ''), coalesce(p_activo, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE "VehiculosVencimientos"
       SET "Placa" = p_placa,
           "Propietario" = coalesce(p_propietario, ''),
           "Identificacion" = coalesce(p_identificacion, ''),
           "Activo" = coalesce(p_activo, true)
     WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vehículo no encontrado o sin permiso para modificarlo' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_soat IS NULL THEN
    DELETE FROM "VehiculosVencimientosDocs" WHERE "Vehiculo_Id" = v_id AND "Documento" = 'SOAT';
  ELSE
    INSERT INTO "VehiculosVencimientosDocs" ("Vehiculo_Id", "Documento", "Fecha_Vencimiento")
    VALUES (v_id, 'SOAT', p_soat)
    ON CONFLICT ("Vehiculo_Id", "Documento") DO UPDATE SET "Fecha_Vencimiento" = EXCLUDED."Fecha_Vencimiento";
  END IF;

  IF p_tecnomecanica IS NULL THEN
    DELETE FROM "VehiculosVencimientosDocs" WHERE "Vehiculo_Id" = v_id AND "Documento" = 'TECNOMECANICA';
  ELSE
    INSERT INTO "VehiculosVencimientosDocs" ("Vehiculo_Id", "Documento", "Fecha_Vencimiento")
    VALUES (v_id, 'TECNOMECANICA', p_tecnomecanica)
    ON CONFLICT ("Vehiculo_Id", "Documento") DO UPDATE SET "Fecha_Vencimiento" = EXCLUDED."Fecha_Vencimiento";
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_vehiculo_vencimiento(bigint, text, text, text, boolean, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.guardar_vehiculo_vencimiento(bigint, text, text, text, boolean, date, date) TO authenticated;


-- ── 8. Lógica de avisos (solo service_role) ──
-- Escalón de un documento según los días que faltan (negativo = ya venció). NULL = faltan más de 30.
CREATE OR REPLACE FUNCTION public.vv_umbral(p_dias int)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_dias < 0   THEN -1
    WHEN p_dias = 0   THEN 0
    WHEN p_dias <= 3  THEN 3
    WHEN p_dias <= 7  THEN 7
    WHEN p_dias <= 15 THEN 15
    WHEN p_dias <= 30 THEN 30
  END
$$;

-- p_modo = 'nuevos' (cron): solo lo que cruzó un escalón nuevo o los vencidos con recordatorio semanal.
-- p_modo = 'todos' (botón «Enviar aviso ahora» y vista previa): todo lo vencido o que vence en ≤ 30 días.
CREATE OR REPLACE FUNCTION public.vv_pendientes(p_modo text DEFAULT 'nuevos')
RETURNS TABLE (
  doc_id bigint, vehiculo_id bigint, placa text, propietario text,
  documento text, fecha_vencimiento date, dias int, umbral int
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH hoy AS (SELECT (now() AT TIME ZONE 'America/Bogota')::date AS d),
  base AS (
    SELECT d.id AS doc_id, v.id AS vehiculo_id, v."Placa" AS placa, v."Propietario" AS propietario,
           d."Documento" AS documento, d."Fecha_Vencimiento" AS fecha_vencimiento,
           (d."Fecha_Vencimiento" - hoy.d) AS dias,
           e.ultimo_umbral, e.ultimo_aviso, hoy.d AS hoy
      FROM public."VehiculosVencimientosDocs" d
      JOIN public."VehiculosVencimientos" v ON v.id = d."Vehiculo_Id"
      LEFT JOIN public."VehiculosVencimientosEstado" e ON e.doc_id = d.id
      CROSS JOIN hoy
     WHERE v."Activo"
  )
  SELECT doc_id, vehiculo_id, placa, propietario, documento, fecha_vencimiento, dias, public.vv_umbral(dias)
    FROM base
   WHERE public.vv_umbral(dias) IS NOT NULL
     AND (
          p_modo = 'todos'
       OR ultimo_umbral IS NULL
       OR public.vv_umbral(dias) < ultimo_umbral
       OR (public.vv_umbral(dias) = -1 AND ultimo_aviso <= hoy - 7)
     )
   ORDER BY dias, placa, documento;
$$;

-- Marca los documentos como avisados (solo tras un envío correcto).
CREATE OR REPLACE FUNCTION public.vv_marcar(p_ids bigint[])
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $$
  INSERT INTO public."VehiculosVencimientosEstado" (doc_id, ultimo_umbral, ultimo_aviso)
  SELECT d.id,
         public.vv_umbral(d."Fecha_Vencimiento" - (now() AT TIME ZONE 'America/Bogota')::date),
         (now() AT TIME ZONE 'America/Bogota')::date
    FROM public."VehiculosVencimientosDocs" d
   WHERE d.id = ANY (p_ids)
     AND public.vv_umbral(d."Fecha_Vencimiento" - (now() AT TIME ZONE 'America/Bogota')::date) IS NOT NULL
  ON CONFLICT (doc_id) DO UPDATE
     SET ultimo_umbral = EXCLUDED.ultimo_umbral, ultimo_aviso = EXCLUDED.ultimo_aviso;
$$;

REVOKE ALL ON FUNCTION public.vv_umbral(int)         FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.vv_pendientes(text)    FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.vv_marcar(bigint[])    FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vv_umbral(int)      TO service_role;
GRANT EXECUTE ON FUNCTION public.vv_pendientes(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vv_marcar(bigint[]) TO service_role;


-- ── 9. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_vehiculos_vencimientos
-- ============================================================
