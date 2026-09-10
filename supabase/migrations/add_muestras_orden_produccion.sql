-- Órdenes de producción de muestras (solicitante = Mercadeo).
--
-- Algunas solicitudes de "SolicitudMuestras" no son muestras para despachar a un
-- cliente, sino ÓRDENES DE PRODUCCIÓN: Mercadeo pide que la planta produzca
-- producto en presentación de muestra, y ese producto INGRESA al inventario de
-- la empresa (no sale). Se gestionan con el flujo ya existente de
-- Reenvases (salida a producción del granel) -> "Registrar retorno" -> Ingreso.
--
--  • "SolicitudMuestras"."Tipo_Solicitud"
--       'Despacho'    → muestra normal para despacho a cliente (comportamiento actual).
--       'Produccion'  → orden de producción de muestras (Mercadeo).
--    Además "SolicitudMuestras"."Estado" gana el valor 'Producida' (cierre de la
--    orden). No hay CHECK sobre "Estado", no se toca ninguna constraint.
--
--  • "Reenvases"."Muestra_Ref" = la cadena '<Empresa completa> Muestra #<Consecutivo>'
--    de la orden de producción a la que pertenece la salida (FK lógica de texto,
--    sin REFERENCES — mismo formato que "OrdenesCompra"."Ref_Pedido" para muestras).
--    Vacío = salida a producción normal, no ligada a una orden de muestras.
--
-- Existencias/Kardex NO leen estas columnas: el granel sigue restando al crear la
-- salida y cada ingreso de retorno sigue sumando igual que antes. Son solo
-- trazabilidad + para que el módulo de Muestras nunca genere una "Salida / Muestras"
-- por una orden de producción.

-- 1. Tipo de solicitud de muestras -------------------------------------------------

alter table public."SolicitudMuestras"
  add column if not exists "Tipo_Solicitud" text not null default 'Despacho';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sm_tipo_solicitud_valido'
      and conrelid = 'public."SolicitudMuestras"'::regclass
  ) then
    alter table public."SolicitudMuestras"
      add constraint sm_tipo_solicitud_valido
      check ("Tipo_Solicitud" in ('Despacho', 'Produccion'));
  end if;
end $$;

-- Casi todas las solicitudes son de despacho; solo indexamos las de producción.
create index if not exists idx_muestras_tipo_solicitud
  on public."SolicitudMuestras" ("Tipo_Solicitud")
  where "Tipo_Solicitud" <> 'Despacho';

-- 2. Vínculo salida a producción -> orden de producción de muestras ---------------

alter table public."Reenvases"
  add column if not exists "Muestra_Ref" text not null default '';

create index if not exists idx_reenvases_muestra_ref
  on public."Reenvases" ("Muestra_Ref")
  where "Muestra_Ref" <> '';

-- 3. Reclasificar las 4 solicitudes existentes de Mercadeo -----------------------
-- (los consecutivos más altos de cada empresa al 2026-09-09).

update public."SolicitudMuestras"
   set "Tipo_Solicitud" = 'Produccion'
 where (btrim("Empresa"), btrim("Consecutivo")) in (
   ('GREEN AGROSOLUCIONES DE COLOMBIA SAS', '14'),
   ('SOLUCIONES INTEGRALES RESO SAS',       '12'),
   ('INSUMOS AGROPECUARIOS DE LA SABANA SAS','12'),
   ('PARCELAR DE COLOMBIA SAS',             '15')
 );

notify pgrst, 'reload schema';
