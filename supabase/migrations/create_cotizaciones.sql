-- ============================================================
-- Cotizaciones (pedidos.html → pestaña «Cotizaciones»)
--
-- Una cotización es una propuesta de precios que el comercial presenta a un
-- cliente (o prospecto). Si el cliente la acepta, se ajusta y se convierte en
-- un pedido real desde «Nuevo Pedido» (el pedido se crea por el flujo de
-- siempre; aquí solo queda el vínculo).
--
-- Modelo: cabecera «Cotizaciones» (una fila por cotización) + «CotizacionLineas».
-- Número visible: COT-<SIGLA>-<Consecutivo>, consecutivo POR EMPRESA.
-- Estados guardados: Abierta → Aceptada → Convertida; Abierta/Aceptada →
-- Rechazada → Abierta (reabrir). «Vencida» NO se guarda: es una Abierta con
-- Vigente_Hasta < hoy (se calcula en pantalla).
--
-- Escritura SIEMPRE por RPC (atómica, con las RLS aplicadas):
--   guardar_cotizacion(p_id, p_cab, p_lineas)      crea o edita cabecera + líneas
--   cambiar_estado_cotizacion(...)                 aceptar / rechazar / reabrir
--   marcar_cotizacion_convertida(...)              deja el vínculo con el pedido
--   generar_consecutivo_cotizacion(p_empresa)      SECURITY DEFINER (MAX+1 con lock)
-- Un trigger valida las transiciones aunque alguien escriba directo a la tabla.
--
-- Permisos (calcados de Pedidos): admin, editor, contabilidad, gerente_iaso y
-- remisionador crean/editan en sus empresas; 'lector' solo consulta; 'comercial'
-- solo ve/edita las suyas (comercial_id o creado_por = auth.uid()). Borrar: solo admin.
-- Despachador, cartera y producción no tienen acceso.
--
-- Aplicar ANTES de publicar el código de js/cotizaciones.js.
-- Fecha: 2026-11-05
-- ============================================================

-- ── 1. Tablas ──
CREATE TABLE IF NOT EXISTS public."Cotizaciones" (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Nombre_Empresa"        text        NOT NULL,
  "Consecutivo"           integer     NOT NULL,
  "Fecha_Cotizacion"      date        NOT NULL,
  "Vigente_Hasta"         date        NOT NULL,
  "Cliente"               text        NOT NULL,
  "NIT"                   text        NOT NULL DEFAULT '',
  "Sucursal"              text        NOT NULL DEFAULT '',
  "Telefono"              text        NOT NULL DEFAULT '',
  "Direccion_Envio"       text        NOT NULL DEFAULT '',
  "Municipio"             text        NOT NULL DEFAULT '',
  "Departamento"          text        NOT NULL DEFAULT '',
  "Comercial"             text        NOT NULL DEFAULT '',   -- código (p. ej. PDC-C08), como en Pedidos
  comercial_id            uuid,
  "Plazo_Pago"            text        NOT NULL DEFAULT '',
  "Precio_Facturacion"    text        NOT NULL DEFAULT '',   -- tipo de lista (Dealer/Mayorista/Público/Otro); dato interno
  "Observaciones"         text        NOT NULL DEFAULT '',
  "Total"                 numeric     NOT NULL DEFAULT 0,
  "Estado"                text        NOT NULL DEFAULT 'Abierta',
  "Aceptada_En"           timestamptz,
  "Rechazada_En"          timestamptz,
  "Motivo_Rechazo"        text        NOT NULL DEFAULT '',
  "Convertida_En"         timestamptz,
  "Pedido_Consecutivo"    text        NOT NULL DEFAULT '',   -- pedido creado a partir de esta cotización
  "Pedido_Cliente"        text        NOT NULL DEFAULT '',
  "Ediciones"             integer     NOT NULL DEFAULT 0,    -- +1 en cada edición (así el cambio de líneas también queda auditado)
  creado_por              uuid,
  creado_por_nombre       text,
  creado_en               timestamptz,
  modificado_por          uuid,
  modificado_por_nombre   text,
  modificado_en           timestamptz,
  CONSTRAINT cotizaciones_empresa_no_vacia      CHECK (btrim("Nombre_Empresa") <> ''),
  CONSTRAINT cotizaciones_cliente_no_vacio      CHECK (btrim("Cliente") <> ''),
  CONSTRAINT cotizaciones_estado_valido         CHECK ("Estado" IN ('Abierta','Aceptada','Rechazada','Convertida')),
  CONSTRAINT cotizaciones_vigencia_valida       CHECK ("Vigente_Hasta" >= "Fecha_Cotizacion"),
  CONSTRAINT cotizaciones_convertida_con_pedido CHECK ("Estado" <> 'Convertida' OR btrim("Pedido_Consecutivo") <> ''),
  CONSTRAINT cotizaciones_empresa_consecutivo_uq UNIQUE ("Nombre_Empresa", "Consecutivo")
);

CREATE TABLE IF NOT EXISTS public."CotizacionLineas" (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cotizacion_id    bigint  NOT NULL REFERENCES public."Cotizaciones"(id) ON DELETE CASCADE,
  "Orden"          integer NOT NULL DEFAULT 0,
  "Producto"       text    NOT NULL,
  "Presentacion"   text    NOT NULL DEFAULT '',
  "Cantidad"       numeric NOT NULL,
  "Valor_Unitario" numeric NOT NULL DEFAULT 0,
  "Valor_Total"    numeric NOT NULL DEFAULT 0,
  "Bonificado"     text    NOT NULL DEFAULT '',
  CONSTRAINT cotizacionlineas_producto_no_vacio CHECK (btrim("Producto") <> ''),
  CONSTRAINT cotizacionlineas_cantidad_positiva CHECK ("Cantidad" > 0),
  CONSTRAINT cotizacionlineas_valor_no_negativo CHECK ("Valor_Unitario" >= 0),
  CONSTRAINT cotizacionlineas_bonificado_valido CHECK ("Bonificado" IN ('', 'Sí'))
);

CREATE INDEX IF NOT EXISTS ix_cotizacionlineas_cotizacion ON public."CotizacionLineas" (cotizacion_id);
CREATE INDEX IF NOT EXISTS ix_cotizaciones_comercial      ON public."Cotizaciones" (comercial_id);
CREATE INDEX IF NOT EXISTS ix_cotizaciones_estado         ON public."Cotizaciones" ("Estado");

COMMENT ON TABLE public."Cotizaciones" IS
  'Cotización a un cliente o prospecto (pedidos.html → Cotizaciones). Número visible COT-<SIGLA>-<Consecutivo>, consecutivo por empresa. «Vencida» no se guarda: es Abierta con Vigente_Hasta < hoy.';
COMMENT ON TABLE public."CotizacionLineas" IS
  'Líneas de una cotización. Se reemplazan completas en cada edición (guardar_cotizacion).';

-- ── 2. Reglas de estado (también valen si alguien escribe directo a la tabla) ──
CREATE OR REPLACE FUNCTION public.fn_cotizaciones_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF NEW."Nombre_Empresa" IS DISTINCT FROM OLD."Nombre_Empresa"
     OR NEW."Consecutivo" IS DISTINCT FROM OLD."Consecutivo" THEN
    RAISE EXCEPTION 'No se puede cambiar la empresa ni el número de una cotización';
  END IF;

  IF OLD."Estado" = 'Convertida' THEN
    RAISE EXCEPTION 'La cotización COT-% ya fue convertida en pedido y no se puede modificar', OLD."Consecutivo";
  END IF;

  IF NEW."Estado" IS DISTINCT FROM OLD."Estado" THEN
    IF NOT ((OLD."Estado", NEW."Estado") IN (
         ('Abierta','Aceptada'), ('Abierta','Rechazada'),
         ('Aceptada','Rechazada'), ('Aceptada','Convertida'),
         ('Rechazada','Abierta'))) THEN
      RAISE EXCEPTION 'Cambio de estado no permitido: % → %', OLD."Estado", NEW."Estado";
    END IF;
    IF NEW."Estado" = 'Aceptada' AND NEW."Vigente_Hasta" < v_hoy THEN
      RAISE EXCEPTION 'La cotización está vencida; extiende la vigencia antes de aceptarla';
    END IF;
    IF NEW."Estado" = 'Abierta' AND NEW."Vigente_Hasta" < v_hoy THEN
      RAISE EXCEPTION 'Para reabrir la cotización indica una vigencia desde hoy';
    END IF;
  ELSIF OLD."Estado" = 'Rechazada' THEN
    RAISE EXCEPTION 'Una cotización rechazada no se puede editar; reábrela primero';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotizaciones_guard ON public."Cotizaciones";
CREATE TRIGGER trg_cotizaciones_guard
  BEFORE UPDATE ON public."Cotizaciones"
  FOR EACH ROW EXECUTE FUNCTION public.fn_cotizaciones_guard();

-- ── 3. Auditoría (triggers genéricos ya existentes) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."Cotizaciones";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."Cotizaciones"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."Cotizaciones";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."Cotizaciones"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_log ON public."CotizacionLineas";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."CotizacionLineas"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 4. RLS ──
ALTER TABLE public."Cotizaciones"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CotizacionLineas" ENABLE ROW LEVEL SECURITY;

-- Cabecera: mismo criterio que Pedidos (el comercial solo ve/edita lo suyo).
DROP POLICY IF EXISTS "Cotizaciones_select" ON public."Cotizaciones";
CREATE POLICY "Cotizaciones_select" ON public."Cotizaciones" FOR SELECT TO authenticated
  USING (
    (user_has_company("Nombre_Empresa") OR get_user_role() = 'gerente_iaso')
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','lector','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial'
          AND (comercial_id = (SELECT auth.uid()) OR creado_por = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Cotizaciones_insert" ON public."Cotizaciones";
CREATE POLICY "Cotizaciones_insert" ON public."Cotizaciones" FOR INSERT TO authenticated
  WITH CHECK (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial' AND comercial_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Cotizaciones_update" ON public."Cotizaciones";
CREATE POLICY "Cotizaciones_update" ON public."Cotizaciones" FOR UPDATE TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial'
          AND (comercial_id = (SELECT auth.uid()) OR creado_por = (SELECT auth.uid())))
    )
  )
  WITH CHECK (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
      OR (get_user_role() = 'comercial'
          AND (comercial_id = (SELECT auth.uid()) OR creado_por = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Cotizaciones_delete" ON public."Cotizaciones";
CREATE POLICY "Cotizaciones_delete" ON public."Cotizaciones" FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- Líneas: heredan la visibilidad de la cabecera (la RLS de Cotizaciones se aplica
-- dentro del EXISTS). Solo se escriben mientras la cotización siga Abierta/Aceptada.
-- No hay política de UPDATE a propósito: las líneas se reemplazan completas.
DROP POLICY IF EXISTS "CotizacionLineas_select" ON public."CotizacionLineas";
CREATE POLICY "CotizacionLineas_select" ON public."CotizacionLineas" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."Cotizaciones" c WHERE c.id = "CotizacionLineas".cotizacion_id));

DROP POLICY IF EXISTS "CotizacionLineas_insert" ON public."CotizacionLineas";
CREATE POLICY "CotizacionLineas_insert" ON public."CotizacionLineas" FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])
    AND EXISTS (SELECT 1 FROM public."Cotizaciones" c
                WHERE c.id = "CotizacionLineas".cotizacion_id AND c."Estado" IN ('Abierta','Aceptada'))
  );

DROP POLICY IF EXISTS "CotizacionLineas_delete" ON public."CotizacionLineas";
CREATE POLICY "CotizacionLineas_delete" ON public."CotizacionLineas" FOR DELETE TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])
    AND EXISTS (SELECT 1 FROM public."Cotizaciones" c
                WHERE c.id = "CotizacionLineas".cotizacion_id AND c."Estado" IN ('Abierta','Aceptada'))
  );

REVOKE ALL ON public."Cotizaciones"     FROM anon;
REVOKE ALL ON public."CotizacionLineas" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Cotizaciones"     TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public."CotizacionLineas" TO authenticated;

-- ── 5. RPC ──

-- Nombre completo de la empresa (acepta sigla o nombre). SECURITY DEFINER para no
-- depender de la RLS de «empresas».
CREATE OR REPLACE FUNCTION public._cot_empresa_nombre(p_empresa text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nombre_completo FROM public.empresas
   WHERE sigla = btrim(p_empresa) OR nombre_completo = btrim(p_empresa)
   LIMIT 1;
$$;

-- Siguiente consecutivo POR EMPRESA. SECURITY DEFINER a propósito: con RLS un
-- comercial solo ve sus cotizaciones y el MAX()+1 saldría repetido. Lock por
-- empresa (se libera al terminar la transacción del RPC que la llama).
CREATE OR REPLACE FUNCTION public.generar_consecutivo_cotizacion(p_empresa text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo integer;
BEGIN
  IF p_empresa IS NULL OR btrim(p_empresa) = '' THEN
    RAISE EXCEPTION 'Empresa requerida';
  END IF;

  -- Mismo criterio que la política Cotizaciones_insert
  IF NOT (public.user_has_company(p_empresa)
          AND public.get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cotizacion_consec:' || btrim(p_empresa)));

  SELECT COALESCE(MAX("Consecutivo"), 0) + 1
    INTO v_nuevo
    FROM public."Cotizaciones"
   WHERE "Nombre_Empresa" = btrim(p_empresa);

  RETURN v_nuevo;
END;
$$;

-- Crea (p_id NULL) o edita una cotización con sus líneas, de forma ATÓMICA.
-- SECURITY INVOKER: aplican las RLS de quien llama. El total se recalcula aquí.
-- p_cab:    {nombre_empresa, fecha_cotizacion, vigente_hasta, cliente, nit, sucursal, telefono,
--            direccion_envio, municipio, departamento, comercial, comercial_id, plazo_pago,
--            precio_facturacion, observaciones}
-- p_lineas: [{producto, presentacion, cantidad, valor_unitario, bonificado}]
CREATE OR REPLACE FUNCTION public.guardar_cotizacion(p_id bigint, p_cab jsonb, p_lineas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hoy      date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_cot      public."Cotizaciones"%ROWTYPE;
  v_id       bigint;
  v_cons     integer;
  v_empresa  text;
  v_fecha    date;
  v_vig      date;
  v_cliente  text;
  v_cid      uuid;
  v_total    numeric := 0;
  v_lin      jsonb;
  v_orden    integer := 0;
  v_prod     text;
  v_cant     numeric;
  v_vuni     numeric;
BEGIN
  IF p_cab IS NULL OR jsonb_typeof(p_cab) <> 'object' THEN
    RAISE EXCEPTION 'Datos de la cotización inválidos';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto';
  END IF;

  v_fecha   := NULLIF(btrim(coalesce(p_cab->>'fecha_cotizacion', '')), '')::date;
  v_vig     := NULLIF(btrim(coalesce(p_cab->>'vigente_hasta', '')), '')::date;
  v_cliente := btrim(coalesce(p_cab->>'cliente', ''));
  v_cid     := NULLIF(btrim(coalesce(p_cab->>'comercial_id', '')), '')::uuid;

  IF v_fecha IS NULL THEN RAISE EXCEPTION 'Indica la fecha de la cotización'; END IF;
  IF v_vig   IS NULL THEN RAISE EXCEPTION 'Indica hasta cuándo es válida la cotización'; END IF;
  IF v_vig < v_fecha THEN RAISE EXCEPTION 'La vigencia no puede ser anterior a la fecha de la cotización'; END IF;
  IF v_cliente = '' THEN RAISE EXCEPTION 'Ingresa el nombre del cliente'; END IF;

  -- Valida las líneas y calcula el total ANTES de escribir nada.
  FOR v_lin IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
    v_prod := btrim(coalesce(v_lin->>'producto', ''));
    v_cant := coalesce(NULLIF(btrim(coalesce(v_lin->>'cantidad', '')), '')::numeric, 0);
    v_vuni := coalesce(NULLIF(btrim(coalesce(v_lin->>'valor_unitario', '')), '')::numeric, 0);
    IF v_prod = '' THEN RAISE EXCEPTION 'Hay una línea sin producto'; END IF;
    IF v_cant <= 0 THEN RAISE EXCEPTION 'La cantidad de "%" debe ser mayor que cero', v_prod; END IF;
    IF v_vuni < 0 THEN RAISE EXCEPTION 'El valor unitario de "%" no puede ser negativo', v_prod; END IF;
    v_total := v_total + v_cant * v_vuni;
  END LOOP;

  IF p_id IS NULL THEN
    IF v_vig < v_hoy THEN
      RAISE EXCEPTION 'La vigencia ya pasó; indica una fecha desde hoy';
    END IF;
    v_empresa := public._cot_empresa_nombre(p_cab->>'nombre_empresa');
    IF v_empresa IS NULL THEN RAISE EXCEPTION 'Empresa no válida'; END IF;
    v_cons := public.generar_consecutivo_cotizacion(v_empresa);

    INSERT INTO public."Cotizaciones" (
      "Nombre_Empresa", "Consecutivo", "Fecha_Cotizacion", "Vigente_Hasta", "Cliente", "NIT", "Sucursal",
      "Telefono", "Direccion_Envio", "Municipio", "Departamento", "Comercial", comercial_id,
      "Plazo_Pago", "Precio_Facturacion", "Observaciones", "Total", "Estado"
    ) VALUES (
      v_empresa, v_cons, v_fecha, v_vig, v_cliente,
      btrim(coalesce(p_cab->>'nit', '')), btrim(coalesce(p_cab->>'sucursal', '')),
      btrim(coalesce(p_cab->>'telefono', '')), btrim(coalesce(p_cab->>'direccion_envio', '')),
      btrim(coalesce(p_cab->>'municipio', '')), btrim(coalesce(p_cab->>'departamento', '')),
      btrim(coalesce(p_cab->>'comercial', '')), v_cid,
      btrim(coalesce(p_cab->>'plazo_pago', '')), btrim(coalesce(p_cab->>'precio_facturacion', '')),
      btrim(coalesce(p_cab->>'observaciones', '')), v_total, 'Abierta'
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_cot FROM public."Cotizaciones" WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró la cotización o no tienes acceso a ella';
    END IF;
    IF v_cot."Estado" NOT IN ('Abierta', 'Aceptada') THEN
      RAISE EXCEPTION 'No se puede editar una cotización %', lower(v_cot."Estado");
    END IF;
    IF v_cot."Estado" = 'Abierta' AND v_vig < v_hoy THEN
      RAISE EXCEPTION 'La vigencia ya pasó; extiéndela a una fecha desde hoy para guardar los cambios';
    END IF;

    UPDATE public."Cotizaciones" SET
      "Fecha_Cotizacion"   = v_fecha,
      "Vigente_Hasta"      = v_vig,
      "Cliente"            = v_cliente,
      "NIT"                = btrim(coalesce(p_cab->>'nit', '')),
      "Sucursal"           = btrim(coalesce(p_cab->>'sucursal', '')),
      "Telefono"           = btrim(coalesce(p_cab->>'telefono', '')),
      "Direccion_Envio"    = btrim(coalesce(p_cab->>'direccion_envio', '')),
      "Municipio"          = btrim(coalesce(p_cab->>'municipio', '')),
      "Departamento"       = btrim(coalesce(p_cab->>'departamento', '')),
      "Comercial"          = btrim(coalesce(p_cab->>'comercial', '')),
      comercial_id         = v_cid,
      "Plazo_Pago"         = btrim(coalesce(p_cab->>'plazo_pago', '')),
      "Precio_Facturacion" = btrim(coalesce(p_cab->>'precio_facturacion', '')),
      "Observaciones"      = btrim(coalesce(p_cab->>'observaciones', '')),
      "Total"              = v_total,
      "Ediciones"          = "Ediciones" + 1
    WHERE id = p_id;

    DELETE FROM public."CotizacionLineas" WHERE cotizacion_id = p_id;
    v_id   := p_id;
    v_cons := v_cot."Consecutivo";
  END IF;

  FOR v_lin IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
    v_orden := v_orden + 1;
    v_cant  := coalesce(NULLIF(btrim(coalesce(v_lin->>'cantidad', '')), '')::numeric, 0);
    v_vuni  := coalesce(NULLIF(btrim(coalesce(v_lin->>'valor_unitario', '')), '')::numeric, 0);
    INSERT INTO public."CotizacionLineas" (
      cotizacion_id, "Orden", "Producto", "Presentacion", "Cantidad", "Valor_Unitario", "Valor_Total", "Bonificado"
    ) VALUES (
      v_id, v_orden, btrim(v_lin->>'producto'), btrim(coalesce(v_lin->>'presentacion', '')),
      v_cant, v_vuni, v_cant * v_vuni,
      CASE WHEN btrim(coalesce(v_lin->>'bonificado', '')) IN ('Sí', 'Si') THEN 'Sí' ELSE '' END
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'consecutivo', v_cons);
END;
$$;

-- Aceptar / rechazar / reabrir. (Convertir tiene su propio RPC.)
CREATE OR REPLACE FUNCTION public.cambiar_estado_cotizacion(
  p_id            bigint,
  p_estado        text,
  p_nota          text DEFAULT NULL,
  p_vigente_hasta date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hoy  date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_cot  public."Cotizaciones"%ROWTYPE;
  v_nota text := btrim(coalesce(p_nota, ''));
BEGIN
  SELECT * INTO v_cot FROM public."Cotizaciones" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la cotización o no tienes acceso a ella';
  END IF;

  IF p_estado = 'Aceptada' THEN
    IF v_cot."Estado" <> 'Abierta' THEN
      RAISE EXCEPTION 'Solo se puede aceptar una cotización abierta (esta está %)', lower(v_cot."Estado");
    END IF;
    IF v_cot."Vigente_Hasta" < v_hoy THEN
      RAISE EXCEPTION 'La cotización está vencida (válida hasta %). Edítala y extiende la vigencia antes de aceptarla',
        to_char(v_cot."Vigente_Hasta", 'DD/MM/YYYY');
    END IF;
    UPDATE public."Cotizaciones" SET "Estado" = 'Aceptada', "Aceptada_En" = now() WHERE id = p_id;

  ELSIF p_estado = 'Rechazada' THEN
    IF v_cot."Estado" NOT IN ('Abierta', 'Aceptada') THEN
      RAISE EXCEPTION 'No se puede rechazar una cotización %', lower(v_cot."Estado");
    END IF;
    IF length(v_nota) < 5 THEN
      RAISE EXCEPTION 'Indica el motivo del rechazo (mínimo 5 caracteres)';
    END IF;
    UPDATE public."Cotizaciones"
       SET "Estado" = 'Rechazada', "Rechazada_En" = now(), "Motivo_Rechazo" = v_nota
     WHERE id = p_id;

  ELSIF p_estado = 'Abierta' THEN
    IF v_cot."Estado" <> 'Rechazada' THEN
      RAISE EXCEPTION 'Solo se puede reabrir una cotización rechazada (esta está %)', lower(v_cot."Estado");
    END IF;
    IF p_vigente_hasta IS NULL OR p_vigente_hasta < v_hoy OR p_vigente_hasta < v_cot."Fecha_Cotizacion" THEN
      RAISE EXCEPTION 'Indica una nueva vigencia desde hoy';
    END IF;
    UPDATE public."Cotizaciones"
       SET "Estado" = 'Abierta', "Vigente_Hasta" = p_vigente_hasta,
           "Aceptada_En" = NULL, "Rechazada_En" = NULL, "Motivo_Rechazo" = ''
     WHERE id = p_id;

  ELSE
    RAISE EXCEPTION 'Estado no válido: %', p_estado;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'estado', p_estado);
END;
$$;

-- Deja el vínculo con el pedido creado desde «Nuevo Pedido». Solo desde Aceptada.
CREATE OR REPLACE FUNCTION public.marcar_cotizacion_convertida(
  p_id                 bigint,
  p_pedido_consecutivo text,
  p_pedido_cliente     text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cot public."Cotizaciones"%ROWTYPE;
BEGIN
  IF btrim(coalesce(p_pedido_consecutivo, '')) = '' THEN
    RAISE EXCEPTION 'Indica el consecutivo del pedido';
  END IF;

  SELECT * INTO v_cot FROM public."Cotizaciones" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la cotización o no tienes acceso a ella';
  END IF;
  IF v_cot."Estado" <> 'Aceptada' THEN
    RAISE EXCEPTION 'Solo se puede convertir una cotización aceptada (esta está %)', lower(v_cot."Estado");
  END IF;

  UPDATE public."Cotizaciones"
     SET "Estado" = 'Convertida', "Convertida_En" = now(),
         "Pedido_Consecutivo" = btrim(p_pedido_consecutivo),
         "Pedido_Cliente"     = btrim(coalesce(p_pedido_cliente, ''))
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'estado', 'Convertida');
END;
$$;

-- ── 6. Permisos de ejecución ──
REVOKE ALL ON FUNCTION public._cot_empresa_nombre(text)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generar_consecutivo_cotizacion(text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_cotizacion(bigint, jsonb, jsonb)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cambiar_estado_cotizacion(bigint, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marcar_cotizacion_convertida(bigint, text, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cotizaciones_guard()                            FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._cot_empresa_nombre(text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.generar_consecutivo_cotizacion(text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_cotizacion(bigint, jsonb, jsonb)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_cotizacion(bigint, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_cotizacion_convertida(bigint, text, text)   TO authenticated;

-- ── 7. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_cotizaciones
-- ============================================================
