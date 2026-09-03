-- ============================================================
-- Migración: rol 'cartera' + candado del estado "Bloqueado por cartera"
--
-- Rol 'cartera':
--   • CRUD completo en ClientesUnicos (módulo Clientes)
--   • Solo lectura en Pedidos (+ EntregasPedido)
--   • Acceso a todas las empresas (user_has_company => true)
--
-- "Bloqueado por cartera" (Pedidos.Estado_2 y ClientesUnicos.Estado):
--   solo lo pueden poner/quitar los roles admin, editor y cartera.
--   Se aplica con dos triggers BEFORE + una RPC dedicada, para que
--   'cartera' (solo lectura en Pedidos) pueda alternar el bloqueo.
--
-- Idempotente. Ejecutar con el MCP de Supabase (apply_migration).
-- Fecha: 2026-09-03
-- ============================================================


-- ── 1. CHECK de rol: aceptar 'cartera' ──
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador',
                 'contabilidad','gerente_iaso','remisionador','cartera'));


-- ── 2. user_has_company: 'cartera' ve todas las empresas ──
CREATE OR REPLACE FUNCTION public.user_has_company(p_empresa text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text;
  v_sigla text;
  v_found boolean;
BEGIN
  IF p_empresa IS NULL OR TRIM(p_empresa) = '' THEN
    RETURN true;
  END IF;

  SELECT rol INTO v_rol FROM usuarios
  WHERE id = auth.uid() AND activo = true;

  IF v_rol IS NULL THEN RETURN false; END IF;
  IF v_rol IN ('admin','cartera') THEN RETURN true; END IF;

  -- Resolver sigla: si el input es un nombre completo, buscar su sigla
  SELECT sigla INTO v_sigla FROM empresas
  WHERE sigla = TRIM(p_empresa) OR nombre_completo = TRIM(p_empresa);

  IF v_sigla IS NULL THEN RETURN false; END IF;

  SELECT EXISTS(
    SELECT 1 FROM usuario_empresas
    WHERE usuario_id = auth.uid() AND empresa_sigla = v_sigla
  ) INTO v_found;

  RETURN v_found;
END;
$function$;


-- ── 3. RLS ClientesUnicos: 'cartera' con escritura completa ──
DROP POLICY IF EXISTS "ClientesUnicos_insert" ON "ClientesUnicos";
CREATE POLICY "ClientesUnicos_insert" ON "ClientesUnicos" FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']));

DROP POLICY IF EXISTS "ClientesUnicos_update" ON "ClientesUnicos";
CREATE POLICY "ClientesUnicos_update" ON "ClientesUnicos" FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']));

DROP POLICY IF EXISTS "ClientesUnicos_delete" ON "ClientesUnicos";
CREATE POLICY "ClientesUnicos_delete" ON "ClientesUnicos" FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','cartera']));


-- ── 4. RLS Pedidos + EntregasPedido: 'cartera' con lectura ──
--     (mismas condiciones que hoy, solo se añade 'cartera' a la lista de roles;
--      NO se toca insert/update/delete de Pedidos: 'cartera' es solo lectura)
DROP POLICY IF EXISTS "Pedidos_select" ON "Pedidos";
CREATE POLICY "Pedidos_select" ON "Pedidos" FOR SELECT TO authenticated
  USING (
    (user_has_company("Nombre_Empresa") OR (get_user_role() = 'gerente_iaso'))
    AND (
      (get_user_role() = ANY (ARRAY['admin','editor','lector','contabilidad','gerente_iaso','despachador','remisionador','cartera']))
      OR ((get_user_role() = 'comercial') AND ((comercial_id = (SELECT auth.uid())) OR (creado_por = (SELECT auth.uid()))))
    )
  );

DROP POLICY IF EXISTS "EntregasPedido_select" ON "EntregasPedido";
CREATE POLICY "EntregasPedido_select" ON "EntregasPedido" FOR SELECT TO authenticated
  USING (
    (user_has_company(empresa_pedido) OR user_has_company(empresa_stock))
    AND (
      (get_user_role() = ANY (ARRAY['admin','editor','lector','remisionador','cartera']))
      OR ((get_user_role() = 'comercial') AND (EXISTS (
        SELECT 1 FROM "Pedidos" p
        WHERE p.id = "EntregasPedido".pedido_id
          AND ((p.comercial_id = (SELECT auth.uid())) OR (p.creado_por = (SELECT auth.uid())))
      )))
    )
  );


-- ── 5. RPC: alternar "Bloqueado por cartera" en un pedido ──
--     'cartera' es solo lectura sobre Pedidos, así que necesita esta RPC
--     SECURITY DEFINER para poder marcar/liberar el bloqueo.
CREATE OR REPLACE FUNCTION public.set_bloqueo_cartera_pedido(
  p_empresa text, p_consecutivo text, p_bloquear boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_n int;
BEGIN
  IF COALESCE(v_rol,'') NOT IN ('admin','editor','cartera') THEN
    RAISE EXCEPTION 'No autorizado: solo Cartera, edición o administración pueden bloquear/liberar pedidos por cartera';
  END IF;

  UPDATE "Pedidos"
     SET "Estado_2" = CASE WHEN p_bloquear THEN 'Bloqueado por cartera' ELSE 'Abierto' END,
         modificado_por = auth.uid()
   WHERE "Nombre_Empresa" = p_empresa
     AND "Consecutivo" = p_consecutivo
     AND COALESCE("Estado_2",'') <> 'Anulado';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bloqueo_cartera_pedido(text,text,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_bloqueo_cartera_pedido(text,text,boolean) TO authenticated;


-- ── 6. Trigger: candado en Pedidos.Estado_2 ──
--     Bloquea a cualquier usuario autenticado que NO sea admin/editor/cartera
--     de poner o quitar "Bloqueado por cartera". Un contexto sin sesión
--     (postgres/service_role/migraciones) se considera de confianza y pasa.
CREATE OR REPLACE FUNCTION public.guard_bloqueo_cartera_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
BEGIN
  IF NEW."Estado_2" IS DISTINCT FROM OLD."Estado_2"
     AND 'Bloqueado por cartera' IN (COALESCE(OLD."Estado_2",''), COALESCE(NEW."Estado_2",''))
     AND v_rol IS NOT NULL
     AND v_rol NOT IN ('admin','editor','cartera')
  THEN
    RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar "Bloqueado por cartera" en un pedido';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_bloqueo_cartera_pedido ON "Pedidos";
CREATE TRIGGER trg_guard_bloqueo_cartera_pedido
  BEFORE UPDATE ON "Pedidos"
  FOR EACH ROW EXECUTE FUNCTION public.guard_bloqueo_cartera_pedido();

-- El trigger function no debe exponerse como RPC
REVOKE ALL ON FUNCTION public.guard_bloqueo_cartera_pedido() FROM public, anon, authenticated;


-- ── 7. Trigger: candado en ClientesUnicos.Estado ──
CREATE OR REPLACE FUNCTION public.guard_bloqueo_cartera_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_old text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Estado" ELSE NULL END;
BEGIN
  IF NEW."Estado" IS DISTINCT FROM v_old
     AND 'Bloqueado por cartera' IN (COALESCE(v_old,''), COALESCE(NEW."Estado",''))
     AND v_rol IS NOT NULL
     AND v_rol NOT IN ('admin','editor','cartera')
  THEN
    RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar "Bloqueado por cartera" en un cliente';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_bloqueo_cartera_cliente ON "ClientesUnicos";
CREATE TRIGGER trg_guard_bloqueo_cartera_cliente
  BEFORE INSERT OR UPDATE ON "ClientesUnicos"
  FOR EACH ROW EXECUTE FUNCTION public.guard_bloqueo_cartera_cliente();

REVOKE ALL ON FUNCTION public.guard_bloqueo_cartera_cliente() FROM public, anon, authenticated;


-- ── 8. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_cartera_role
-- ============================================================
