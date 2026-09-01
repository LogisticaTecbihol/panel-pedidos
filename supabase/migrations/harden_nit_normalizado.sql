-- Endurece el emparejamiento de NIT usado al dar de alta clientes desde un
-- pedido manual (registrar_cliente_nuevo_desde_pedido).
--
-- La normalización anterior (`split_part(regexp_replace(nit,'[\.\s]',''),'-',1)`)
-- no cubría:
--   · dígito de verificación separado por espacio  -> "900693414 3"
--   · dígito de verificación pegado                -> "9016336122"
--   · prefijos alfabéticos                         -> "NIT 800159028 1"
-- Eso provocaba clientes duplicados marcados "Nuevo" cuando el cliente ya
-- existía con el NIT en otro formato.

-- ── nit_normalizado ──
-- Devuelve solo los dígitos del NIT, sin dígito de verificación:
--   1. quita el DV si va tras un separador (espacio, punto o guion)
--   2. deja solo dígitos (descarta "NIT"/"CC", puntos y espacios internos)
--   3. si quedan 10 dígitos y empieza en 8 o 9 (NIT de empresa con el DV
--      pegado), quita el último dígito
-- Las cédulas de 10 dígitos (empiezan en 1) no se tocan.
create or replace function public.nit_normalizado(p_nit text)
returns text
language sql
immutable
as $$
  with s1 as (
    select regexp_replace(btrim(coalesce(p_nit, '')), '[\s\.\-]+\d$', '') as v
  ),
  s2 as (
    select regexp_replace(v, '\D', '', 'g') as v from s1
  )
  select case
    when length(v) = 10 and left(v, 1) in ('8', '9') then left(v, 9)
    else v
  end
  from s2
$$;

grant execute on function public.nit_normalizado(text) to authenticated, anon;

-- ── registrar_cliente_nuevo_desde_pedido (usa nit_normalizado) ──
create or replace function public.registrar_cliente_nuevo_desde_pedido(
  p_cliente          text,
  p_nit              text,
  p_empresa          text default '',
  p_telefono         text default '',
  p_direccion_envio  text default '',
  p_municipio        text default '',
  p_departamento     text default '',
  p_plazo_pago       text default '',
  p_lista_precio     text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nit_clean text;
  v_exists    boolean;
  v_id        bigint;
begin
  -- get_user_role() es NULL para usuarios anónimos: hay que rechazar ese caso
  -- explícitamente (NULL <> ALL da NULL, no true).
  if public.get_user_role() is null
     or public.get_user_role() <> all (array['admin','editor','contabilidad','gerente_iaso','comercial','remisionador']) then
    raise exception 'No autorizado';
  end if;

  v_nit_clean := public.nit_normalizado(p_nit);

  -- Sin NIT, o NIT demasiado corto para ser un documento válido: no se crea nada.
  if v_nit_clean = '' or length(v_nit_clean) < 5 then
    return jsonb_build_object('created', false, 'reason', 'sin_nit');
  end if;

  select exists (
    select 1
    from public."ClientesUnicos" cu
    where public.nit_normalizado(cu."Identificacion") = v_nit_clean
  ) into v_exists;

  if v_exists then
    return jsonb_build_object('created', false, 'reason', 'ya_existe');
  end if;

  insert into public."ClientesUnicos" (
    "Cliente", "Identificacion", "Nombre_Empresa", "Telefono",
    "Direccion_Envio", "Municipio", "Departamento",
    "Plazo_Pago", "Lista_Precio", "Estado", "Cliente_Nuevo"
  ) values (
    btrim(coalesce(p_cliente, '')), btrim(coalesce(p_nit, '')), coalesce(p_empresa, ''),
    coalesce(p_telefono, ''), coalesce(p_direccion_envio, ''), coalesce(p_municipio, ''),
    coalesce(p_departamento, ''), coalesce(p_plazo_pago, ''), coalesce(p_lista_precio, ''),
    'Activo', true
  )
  returning id into v_id;

  return jsonb_build_object('created', true, 'id', v_id);
end;
$$;

revoke execute on function public.registrar_cliente_nuevo_desde_pedido(
  text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.registrar_cliente_nuevo_desde_pedido(
  text, text, text, text, text, text, text, text, text) to authenticated;
