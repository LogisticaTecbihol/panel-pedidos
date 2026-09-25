-- ============================================================
-- Estado del cliente (ClientesUnicos.Estado) específico POR EMPRESA.
--
-- Antes: cliente_estado_pedido() y bloquear_cliente_por_nit() emparejaban
-- solo por NIT/nombre, sin importar la empresa. Un cliente bloqueado en la
-- empresa A quedaba bloqueado también para crear pedidos en B, C... y el
-- panel de Clientes (js/clientes.js -> saveEdit) además propagaba el Estado
-- a TODOS los registros del mismo NIT al guardar cualquiera de ellos.
--
-- Ahora ambas funciones reciben p_empresa y solo consideran los registros
-- de ClientesUnicos de ESA empresa. El panel deja de propagar el Estado
-- entre registros (ver commit del mismo cambio en js/clientes.js).
--
-- Verificado 2026-09-25: 0 clientes tienen hoy 'Bloqueado por cartera' en
-- más de una empresa a la vez, así que este cambio no requiere migrar datos.
--
-- Fecha: 2026-09-25
-- ============================================================

drop function if exists public.cliente_estado_pedido(text, text);

create or replace function public.cliente_estado_pedido(p_cliente text, p_nit text, p_empresa text default '')
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
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
    -- Estado específico por empresa: si se indica empresa, solo cuentan los
    -- registros de ESA empresa (antes se mezclaban todas las empresas del
    -- cliente y un bloqueo en una se contagiaba a las demás).
    and (coalesce(p_empresa, '') = '' or cu."Nombre_Empresa" = p_empresa)
  order by case coalesce(cu."Estado", 'Activo')
             when 'Bloqueado por cartera' then 0
             when 'Inactivo' then 1
             else 2
           end
  limit 1;

  return coalesce(v_estado, 'Activo');
end;
$$;

grant execute on function public.cliente_estado_pedido(text, text, text) to authenticated;

-- ── bloquear_cliente_por_nit: ahora también recibe p_empresa ──────────
drop function if exists public.bloquear_cliente_por_nit(text, text);

create or replace function public.bloquear_cliente_por_nit(p_nit text, p_cliente text, p_empresa text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rol   text := get_user_role();
  v_clean text;
  v_found int;
  v_upd   int;
begin
  if coalesce(v_rol,'') not in ('admin','editor','cartera') then
    raise exception 'No autorizado: solo Cartera, edición o administración pueden bloquear clientes por cartera';
  end if;

  v_clean := split_part(regexp_replace(btrim(coalesce(p_nit, '')), '[\.\s]', '', 'g'), '-', 1);

  select count(*) into v_found
  from public."ClientesUnicos" cu
  where (
      (
        v_clean <> ''
        and split_part(regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'), '-', 1) = v_clean
      )
      or (
        coalesce(p_cliente, '') <> ''
        and lower(btrim(cu."Cliente")) = lower(btrim(p_cliente))
      )
    )
    and (coalesce(p_empresa, '') = '' or cu."Nombre_Empresa" = p_empresa);

  update public."ClientesUnicos" cu
     set "Estado" = 'Bloqueado por cartera'
  where (
      (
        v_clean <> ''
        and split_part(regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'), '-', 1) = v_clean
      )
      or (
        coalesce(p_cliente, '') <> ''
        and lower(btrim(cu."Cliente")) = lower(btrim(p_cliente))
      )
    )
    and (coalesce(p_empresa, '') = '' or cu."Nombre_Empresa" = p_empresa)
    and coalesce(cu."Estado", '') <> 'Bloqueado por cartera';

  get diagnostics v_upd = row_count;

  return jsonb_build_object('ok', true, 'found', v_found, 'updated', v_upd);
end;
$function$;

revoke all on function public.bloquear_cliente_por_nit(text,text,text) from public, anon;
grant execute on function public.bloquear_cliente_por_nit(text,text,text) to authenticated;

notify pgrst, 'reload schema';
