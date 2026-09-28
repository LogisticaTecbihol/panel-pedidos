-- ============================================================
-- Nuevo estado de cliente: 'Suspendido'.
--
-- Para un cliente al que definitivamente no se le volverá a vender
-- (distinto de 'Inactivo', que es más laxo/reversible). Se comporta
-- igual que 'Bloqueado por cartera' en todo lo operativo:
--   - Bloquea la creación de nuevos pedidos (cliente_estado_pedido()).
--   - Solo admin/editor/cartera pueden ponerlo o quitarlo
--     (guard_bloqueo_cartera_cliente()).
-- Es el estado más severo de los cuatro (por encima incluso de
-- 'Bloqueado por cartera', que es un bloqueo de cartera potencialmente
-- temporal).
--
-- Fecha: 2026-09-28
-- ============================================================

-- ── 1. CHECK de ClientesUnicos.Estado: aceptar 'Suspendido' ──
ALTER TABLE "ClientesUnicos" DROP CONSTRAINT IF EXISTS "ClientesUnicos_Estado_check";
ALTER TABLE "ClientesUnicos"
  ADD CONSTRAINT "ClientesUnicos_Estado_check"
  CHECK ("Estado" = ANY (ARRAY['Activo'::text, 'Inactivo'::text, 'Bloqueado por cartera'::text, 'Suspendido'::text]));

-- ── 2. cliente_estado_pedido(): 'Suspendido' es el más severo ──
CREATE OR REPLACE FUNCTION public.cliente_estado_pedido(p_cliente text, p_nit text, p_empresa text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nit_clean text;
  v_estado text;
begin
  v_nit_clean := split_part(regexp_replace(btrim(coalesce(p_nit, '')), '[\.\s]', '', 'g'), '-', 1);

  select cu."Estado"
    into v_estado
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

  return coalesce(v_estado, 'Activo');
end;
$function$;

-- ── 3. Trigger de candado: 'Suspendido' restringido igual que 'Bloqueado por cartera' ──
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
     AND (COALESCE(v_old,'') IN ('Bloqueado por cartera','Suspendido')
          OR COALESCE(NEW."Estado",'') IN ('Bloqueado por cartera','Suspendido'))
     AND v_rol IS NOT NULL
     AND v_rol NOT IN ('admin','editor','cartera')
  THEN
    RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar el estado "%" en un cliente', COALESCE(NEW."Estado", v_old);
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_estado_suspendido_cliente
-- ============================================================
