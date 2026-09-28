-- ============================================================
-- Bitácora de contacto de clientes.
--
-- Historial de gestiones comerciales/cobranza con un cliente: fecha,
-- tipo de contacto (Llamada/WhatsApp/Correo/Otro) y gestión (texto libre).
--
-- Una sola bitácora por CLIENTE UNIFICADO (cruza por NIT normalizado con
-- nit_normalizado(), igual que cliente_estado_pedido()), no por cada
-- registro/empresa de ClientesUnicos — un cliente con sedes en varias
-- empresas del holding comparte un solo historial de contacto.
--
-- Mismos roles con escritura que ya tiene ClientesUnicos (add_cartera_role.sql):
-- admin, editor, contabilidad, gerente_iaso, remisionador, cartera. Lectura
-- abierta a cualquier autenticado, igual que ClientesUnicos_select (el acceso
-- real lo filtra el módulo 'clientes' en la página).
--
-- Botón "📋" en clientes.html, columna Acción (junto a Ver detalle/Editar).
--
-- Fecha: 2026-09-28
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."BitacoraContactoClientes" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "NIT"                    text NOT NULL DEFAULT '',
  "Cliente"                text NOT NULL DEFAULT '',
  "Fecha_Contacto"         date NOT NULL DEFAULT current_date,
  "Tipo_Contacto"          text NOT NULL,
  "Gestion"                text NOT NULL DEFAULT '',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz
);

ALTER TABLE public."BitacoraContactoClientes"
  DROP CONSTRAINT IF EXISTS bitacora_contacto_clientes_tipo_valido;
ALTER TABLE public."BitacoraContactoClientes"
  ADD  CONSTRAINT bitacora_contacto_clientes_tipo_valido
       CHECK ("Tipo_Contacto" IN ('Llamada','WhatsApp','Correo','Otro'));

-- Índice funcional: el cruce por cliente siempre es vía nit_normalizado().
CREATE INDEX IF NOT EXISTS idx_bitacora_contacto_clientes_nit
  ON public."BitacoraContactoClientes" (public.nit_normalizado("NIT"));

COMMENT ON TABLE public."BitacoraContactoClientes" IS
  'Historial de gestiones de contacto (llamada/WhatsApp/correo) con un cliente unificado (cruza por NIT normalizado, no por registro/empresa). Botón en clientes.html.';

-- ── 2. Auditoría (triggers genéricos ya existentes) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."BitacoraContactoClientes";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."BitacoraContactoClientes"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."BitacoraContactoClientes";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."BitacoraContactoClientes"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 3. RPC: bitácora de un cliente unificado por NIT ──
CREATE OR REPLACE FUNCTION public.get_bitacora_contacto_cliente(p_nit text)
RETURNS SETOF public."BitacoraContactoClientes"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT *
  FROM public."BitacoraContactoClientes"
  WHERE public.nit_normalizado("NIT") = public.nit_normalizado(p_nit)
    AND public.nit_normalizado(p_nit) <> ''
  ORDER BY "Fecha_Contacto" DESC, id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_bitacora_contacto_cliente(text) TO authenticated;

-- ── 4. RLS ──
ALTER TABLE public."BitacoraContactoClientes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BitacoraContactoClientes_select" ON public."BitacoraContactoClientes";
CREATE POLICY "BitacoraContactoClientes_select" ON public."BitacoraContactoClientes" FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "BitacoraContactoClientes_insert" ON public."BitacoraContactoClientes";
CREATE POLICY "BitacoraContactoClientes_insert" ON public."BitacoraContactoClientes" FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']));

DROP POLICY IF EXISTS "BitacoraContactoClientes_update" ON public."BitacoraContactoClientes";
CREATE POLICY "BitacoraContactoClientes_update" ON public."BitacoraContactoClientes" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']));

DROP POLICY IF EXISTS "BitacoraContactoClientes_delete" ON public."BitacoraContactoClientes";
CREATE POLICY "BitacoraContactoClientes_delete" ON public."BitacoraContactoClientes" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']));

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración create_bitacora_contacto_clientes
-- ============================================================
