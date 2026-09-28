-- ============================================================
-- Observaciones de Cartera en ClientesUnicos.
--
-- Campo de texto libre para explicar el motivo cuando un cliente queda
-- 'Bloqueado por cartera' o 'Suspendido' (ver create/add_estado_suspendido_cliente.sql).
-- Se edita en clientes.html (form Editar Cliente) y se muestra al comercial
-- en pedidos.html cuando intenta armar un pedido para ese cliente/empresa:
--   - Aviso temprano al seleccionar el cliente (_avisarEstadoCliente, usa el
--     snapshot ya cargado en clientesCache -> apiGet('getClientesUnicos')).
--   - Mensaje de bloqueo al guardar (agregarPedido en shared.js, vía la
--     nueva RPC cliente_observaciones_cartera, misma lógica de cruce/ranking
--     que cliente_estado_pedido).
--
-- Mismo candado que el Estado: solo admin/editor/cartera pueden escribir
-- este campo (se extiende el trigger guard_bloqueo_cartera_cliente ya
-- existente, en vez de crear uno nuevo).
--
-- Fecha: 2026-09-28
-- ============================================================

-- ── 1. Columna ──
ALTER TABLE public."ClientesUnicos"
  ADD COLUMN IF NOT EXISTS "Observaciones_Cartera" text NOT NULL DEFAULT '';

-- ── 2. Trigger de candado: además del Estado, protege Observaciones_Cartera ──
CREATE OR REPLACE FUNCTION public.guard_bloqueo_cartera_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_old_estado text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Estado" ELSE NULL END;
  v_old_obs    text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Observaciones_Cartera" ELSE NULL END;
BEGIN
  IF v_rol IS NOT NULL AND v_rol NOT IN ('admin','editor','cartera') THEN
    IF NEW."Estado" IS DISTINCT FROM v_old_estado
       AND (COALESCE(v_old_estado,'') IN ('Bloqueado por cartera','Suspendido')
            OR COALESCE(NEW."Estado",'') IN ('Bloqueado por cartera','Suspendido'))
    THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar el estado "%" en un cliente', COALESCE(NEW."Estado", v_old_estado);
    END IF;

    IF NEW."Observaciones_Cartera" IS DISTINCT FROM COALESCE(v_old_obs, '') THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden editar las observaciones de cartera de un cliente';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 3. RPC: observaciones de cartera de un cliente/empresa (mismo cruce y
--     ranking que cliente_estado_pedido) ──
CREATE OR REPLACE FUNCTION public.cliente_observaciones_cartera(p_cliente text, p_nit text, p_empresa text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nit_clean text;
  v_obs text;
begin
  v_nit_clean := split_part(regexp_replace(btrim(coalesce(p_nit, '')), '[\.\s]', '', 'g'), '-', 1);

  select cu."Observaciones_Cartera"
    into v_obs
  from public."ClientesUnicos" cu
  where (
      (
        v_nit_clean <> ''
        and split_part(regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'), '-', 1) = v_nit_clean
      )
      or (
        coalesce(p_cliente, '') <> ''
        and lower(btrim(cu."Cliente")) = lower(btrim(p_cliente))
      )
    )
    and (coalesce(p_empresa, '') = '' or cu."Nombre_Empresa" = p_empresa)
  order by case coalesce(cu."Estado", 'Activo')
             when 'Suspendido' then 0
             when 'Bloqueado por cartera' then 1
             when 'Inactivo' then 2
             else 3
           end
  limit 1;

  return coalesce(v_obs, '');
end;
$function$;

-- Texto sensible (motivo de cartera): a diferencia de cliente_estado_pedido,
-- se revoca explícitamente PUBLIC/anon (mismo patrón que set_bloqueo_cartera_pedido
-- en add_cartera_role.sql) para que solo usuarios autenticados puedan leerlo.
REVOKE ALL ON FUNCTION public.cliente_observaciones_cartera(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cliente_observaciones_cartera(text, text, text) TO authenticated;

-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_observaciones_cartera_cliente
-- ============================================================
