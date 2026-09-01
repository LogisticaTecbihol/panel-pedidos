-- Alta automática de cliente en el maestro ClientesUnicos cuando se crea un
-- pedido manual ("Nuevo Pedido") cuyo NIT no estaba en el listado de Clientes.
--
-- · La columna "Cliente_Nuevo" marca esas filas para que se distingan en el
--   panel de Clientes (clientes.html).
-- · La marca se limpia cuando alguien edita/guarda ese cliente en el módulo
--   Clientes (ver js/shared.js -> editarClienteUnico): pasa a funcionar como
--   una lista de "clientes pendientes por completar/verificar".
-- · Solo aplica al alta manual de pedidos. La carga por Excel/PDF no crea
--   clientes.
-- · Sin NIT no se crea nada.

alter table public."ClientesUnicos"
  add column if not exists "Cliente_Nuevo" boolean not null default false;

-- ── registrar_cliente_nuevo_desde_pedido ──
-- Empareja por NIT normalizado (sin puntos/espacios ni dígito de verificación,
-- misma lógica que get_or_create_cliente / cliente_estado_pedido).
--   · Sin NIT              -> no crea nada  (reason = 'sin_nit')
--   · NIT ya en el maestro -> no crea nada  (reason = 'ya_existe')
--   · NIT nuevo            -> inserta la fila con Estado='Activo' y
--                             Cliente_Nuevo=true  (created = true)
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
  -- Mismos roles que pueden crear pedidos (js/auth.js -> canEdit).
  -- get_user_role() es NULL para usuarios anónimos: hay que rechazar ese caso
  -- explícitamente (NULL <> ALL da NULL, no true).
  if public.get_user_role() is null
     or public.get_user_role() <> all (array['admin','editor','contabilidad','gerente_iaso','comercial','remisionador']) then
    raise exception 'No autorizado';
  end if;

  v_nit_clean := split_part(
    regexp_replace(btrim(coalesce(p_nit, '')), '[\.\s]', '', 'g'), '-', 1);

  if v_nit_clean = '' then
    return jsonb_build_object('created', false, 'reason', 'sin_nit');
  end if;

  select exists (
    select 1
    from public."ClientesUnicos" cu
    where split_part(
            regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'),
            '-', 1) = v_nit_clean
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
