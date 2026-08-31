-- Estado del cliente en el maestro ClientesUnicos.
-- Valores: 'Activo' (por defecto), 'Inactivo', 'Bloqueado por cartera'.
-- El estado es informativo en el panel de Clientes y además BLOQUEA la
-- creación de pedidos para clientes 'Inactivo' o 'Bloqueado por cartera'
-- (ver función cliente_estado_pedido y js/shared.js -> agregarPedido).

alter table public."ClientesUnicos"
  add column if not exists "Estado" text not null default 'Activo';

-- Normaliza filas previas (por si el default no aplicó a alguna).
update public."ClientesUnicos"
  set "Estado" = 'Activo'
  where "Estado" is null or btrim("Estado") = '';

-- Restringe a los 3 valores válidos (idempotente: Postgres no soporta
-- ADD CONSTRAINT IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ClientesUnicos_Estado_check'
      and conrelid = 'public."ClientesUnicos"'::regclass
  ) then
    alter table public."ClientesUnicos"
      add constraint "ClientesUnicos_Estado_check"
      check ("Estado" in ('Activo', 'Inactivo', 'Bloqueado por cartera'));
  end if;
end $$;

-- Estado efectivo del cliente para el flujo de pedidos.
-- Empareja por NIT normalizado (sin puntos/espacios ni dígito de
-- verificación, misma lógica que get_or_create_cliente) o por nombre
-- exacto (case-insensitive). Si varias filas coinciden devuelve el estado
-- más restrictivo. Devuelve 'Activo' cuando no hay coincidencia.
create or replace function public.cliente_estado_pedido(p_cliente text, p_nit text)
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
      v_nit_clean <> ''
      and split_part(regexp_replace(btrim(coalesce(cu."Identificacion", '')), '[\.\s]', '', 'g'), '-', 1) = v_nit_clean
    )
    or (
      coalesce(p_cliente, '') <> ''
      and lower(btrim(cu."Cliente")) = lower(btrim(p_cliente))
    )
  order by case coalesce(cu."Estado", 'Activo')
             when 'Bloqueado por cartera' then 0
             when 'Inactivo' then 1
             else 2
           end
  limit 1;

  return coalesce(v_estado, 'Activo');
end;
$$;

grant execute on function public.cliente_estado_pedido(text, text) to authenticated;
