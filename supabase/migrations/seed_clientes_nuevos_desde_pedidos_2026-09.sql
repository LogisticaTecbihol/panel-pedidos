-- Alta de los 12 clientes que aparecían en pedidos manuales pero no estaban en
-- el maestro ClientesUnicos (verificación del 2026-09-01).
-- Quedan marcados Cliente_Nuevo=true para revisarlos/completarlos en el módulo
-- Clientes; la marca se limpia al editar/guardar el cliente.
--
-- NO se incluyen los casos que ya existían con el NIT en otro formato
-- (NILSON CARRILLO, JOSE R. LOPEZ, ALMACEN EL AMIGO, AGRICOLA LA PLAYA,
-- TODO CAMPO FAJARDO, AMIAGRO), ni los NIT inválidos ("VALOR TOTAL", "48"),
-- ni FERRE TURRYS / YANIRA RUIZ (dos NIT distintos por resolver).
--
-- Requiere public.nit_normalizado (ver harden_nit_normalizado.sql). Idempotente.

insert into public."ClientesUnicos" (
  "Cliente", "Identificacion", "Nombre_Empresa", "Telefono",
  "Direccion_Envio", "Municipio", "Departamento",
  "Plazo_Pago", "Lista_Precio", "Estado", "Cliente_Nuevo"
)
select
  regexp_replace(btrim(p."Cliente"), '\s+', ' ', 'g'),
  regexp_replace(btrim(p."NIT"), '[\s\-]+(\d)$', '-\1'),
  btrim(coalesce(p."Nombre_Empresa", '')),
  case when btrim(coalesce(p."Telefono", '')) ~ '\d' then btrim(p."Telefono") else '' end,
  btrim(coalesce(p."Direccion_Envio", '')),
  btrim(coalesce(p."Municipio", '')),
  btrim(coalesce(p."Departamento", '')),
  btrim(coalesce(p."Plazo_Pago", '')),
  btrim(coalesce(p."Precio_Facturacion", '')),
  'Activo',
  true
from (
  select *,
    row_number() over (
      partition by public.nit_normalizado("NIT")
      order by "Fecha_Pedido" desc, id desc
    ) as rn
  from public."Pedidos"
  where public.nit_normalizado("NIT") in (
    '902004059','60346986','901395607','900044142','901757686','1020791865',
    '53073600','900027857','1058058618','900693414','901951579','80499654'
  )
) p
where p.rn = 1
  and not exists (
    select 1 from public."ClientesUnicos" cu
    where public.nit_normalizado(cu."Identificacion") = public.nit_normalizado(p."NIT")
  );
