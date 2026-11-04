-- ============================================================
-- PENDIENTE DE EJECUTAR (preparado el 2026-11-04). Revisar primero la lista:
--   sql/reparar_comercial_id_por_orden_lista.csv  (89 órdenes · 286 líneas)
--
-- Reparación de datos contaminados por el defecto «guardar una orden pisa a las demás órdenes que
-- comparten consecutivo» (Cliente ausente en el filtro de js/shared.js → editarPedido y de la RPC
-- editar_pedido_completo; corregidos el 2026-11-04, ver supabase/migrations/
-- editar_pedido_completo_estado_por_orden.sql).
--
-- 1) Pedidos.comercial_id: queda igual al usuario dueño del código de Pedidos.Comercial.
--    El texto Comercial NO se pisa entre órdenes (la RPC solo lo escribe en las líneas de la orden que
--    se guarda), así que es la fuente de verdad. Mismo directorio que usa pedidos.js
--    (_resolveComercialId): usuario_empresas.codigo_comercial y usuarios.comercial_codigo, solo usuarios
--    activos, sin distinguir mayúsculas. Solo se tocan filas cuyo código SÍ resuelve a un usuario y cuyo
--    comercial_id es distinto (o está vacío). Las filas con Comercial en texto libre no se tocan.
--    Medido en producción: 286 líneas / 89 órdenes; en el 100 % otro cliente del mismo consecutivo
--    tiene el valor equivocado (268 «donante»; 18 en NULL).
--
-- 2) Pedidos.Estado_Entrega: líneas SIN entregas en su propia orden que quedaron en «Parcial» porque
--    OTRO cliente del mismo consecutivo sí había recibido (15 líneas / 4 órdenes). Pasan a «Recibido»,
--    que es lo que da la fórmula de la RPC corregida.
--
-- NO repara la marca de «modificado» (Fecha_/Tipo_Modificacion_Cant) compartida entre clientes (75 líneas):
-- no se puede reconstruir cuál era la correcta y solo es un resaltado visual.
--
-- Efectos a tener en cuenta:
--   · fn_audit_log SÍ registra cada cambio en audit_log (antes → después), sin usuario (se ejecuta desde
--     el servidor): es el respaldo para deshacerlo.
--   · trg_auditoria_row pondrá modificado_en = ahora y modificado_por = NULL en las líneas tocadas.
--   · Cada comercial verá/dejará de ver órdenes (RLS por comercial_id): es justo el objetivo.
--
-- Deshacer: para cada fila, audit_log.datos_antes (accion='UPDATE', tabla='Pedidos', created_at de la
-- ejecución) trae el comercial_id / Estado_Entrega anterior.
--
-- Probar sin guardar: cambiar el COMMIT final por ROLLBACK.
-- ============================================================

-- 0) Estado actual (solo lectura)
with dir as (
  select lower(trim(ue.codigo_comercial)) as cod, u.id from usuario_empresas ue join usuarios u on u.id = ue.usuario_id
   where u.activo and ue.codigo_comercial is not null and trim(ue.codigo_comercial) <> ''
  union
  select lower(trim(u.comercial_codigo)), u.id from usuarios u
   where u.activo and u.comercial_codigo is not null and trim(u.comercial_codigo) <> ''
), res as (select cod, (array_agg(distinct id))[1] as id from dir group by cod)
select 'lineas con comercial_id distinto al del codigo Comercial' as k, count(*) as n
  from "Pedidos" p join res r on r.cod = lower(trim(p."Comercial")) where p.comercial_id is distinct from r.id;   -- 286

select 'lineas Parcial sin entregas propias y con entregas de otro cliente del consecutivo' as k, count(*) as n
  from "Pedidos" p
 where coalesce(p."Cant_Entregada", 0) = 0 and p."Estado_Entrega" = 'Parcial'
   and not exists (select 1 from "Pedidos" q where q."Nombre_Empresa" = p."Nombre_Empresa" and q."Consecutivo" = p."Consecutivo"
                      and q."Cliente" = p."Cliente" and coalesce(q."Cant_Entregada", 0) > 0)
   and exists (select 1 from "Pedidos" q where q."Nombre_Empresa" = p."Nombre_Empresa" and q."Consecutivo" = p."Consecutivo"
                  and q."Cliente" is distinct from p."Cliente" and coalesce(q."Cant_Entregada", 0) > 0);                -- 15

-- 1) Reparación
begin;

do $$
declare
  v_com int;
  v_est int;
begin
  -- 1) comercial_id según el código de Comercial
  with dir as (
    select lower(trim(ue.codigo_comercial)) as cod, u.id from usuario_empresas ue join usuarios u on u.id = ue.usuario_id
     where u.activo and ue.codigo_comercial is not null and trim(ue.codigo_comercial) <> ''
    union
    select lower(trim(u.comercial_codigo)), u.id from usuarios u
     where u.activo and u.comercial_codigo is not null and trim(u.comercial_codigo) <> ''
  ), res as (select cod, (array_agg(distinct id))[1] as id from dir group by cod),
  upd as (
    update "Pedidos" p set comercial_id = r.id
      from res r
     where r.cod = lower(trim(p."Comercial")) and p.comercial_id is distinct from r.id
    returning p.id
  )
  select count(*) into v_com from upd;

  -- Guarda de cordura: se diagnosticaron 286 líneas; muy por encima de eso algo no es lo esperado
  -- (p. ej. un directorio mal cargado). Si se pasa, se revierte todo.
  if v_com > 600 then
    raise exception 'comercial_id: % filas a corregir (se esperaban ~286); no se toca nada', v_com;
  end if;

  -- 2) Estado_Entrega falso por contaminación entre clientes
  update "Pedidos" p set "Estado_Entrega" = 'Recibido'
   where coalesce(p."Cant_Entregada", 0) = 0 and p."Estado_Entrega" = 'Parcial'
     and not exists (select 1 from "Pedidos" q where q."Nombre_Empresa" = p."Nombre_Empresa" and q."Consecutivo" = p."Consecutivo"
                        and q."Cliente" = p."Cliente" and coalesce(q."Cant_Entregada", 0) > 0)
     and exists (select 1 from "Pedidos" q where q."Nombre_Empresa" = p."Nombre_Empresa" and q."Consecutivo" = p."Consecutivo"
                    and q."Cliente" is distinct from p."Cliente" and coalesce(q."Cant_Entregada", 0) > 0);
  get diagnostics v_est = row_count;
  if v_est > 100 then
    raise exception 'Estado_Entrega: % filas a corregir (se esperaban ~15); no se toca nada', v_est;
  end if;

  raise notice 'comercial_id corregido en % líneas; Estado_Entrega corregido en % líneas', v_com, v_est;
end $$;

-- 2) Verificación (ambas deben dar 0)
with dir as (
  select lower(trim(ue.codigo_comercial)) as cod, u.id from usuario_empresas ue join usuarios u on u.id = ue.usuario_id
   where u.activo and ue.codigo_comercial is not null and trim(ue.codigo_comercial) <> ''
  union
  select lower(trim(u.comercial_codigo)), u.id from usuarios u
   where u.activo and u.comercial_codigo is not null and trim(u.comercial_codigo) <> ''
), res as (select cod, (array_agg(distinct id))[1] as id from dir group by cod)
select count(*) as lineas_con_comercial_desalineado
  from "Pedidos" p join res r on r.cod = lower(trim(p."Comercial")) where p.comercial_id is distinct from r.id;

select count(*) as lineas_parcial_por_contaminacion
  from "Pedidos" p
 where coalesce(p."Cant_Entregada", 0) = 0 and p."Estado_Entrega" = 'Parcial'
   and not exists (select 1 from "Pedidos" q where q."Nombre_Empresa" = p."Nombre_Empresa" and q."Consecutivo" = p."Consecutivo"
                      and q."Cliente" = p."Cliente" and coalesce(q."Cant_Entregada", 0) > 0)
   and exists (select 1 from "Pedidos" q where q."Nombre_Empresa" = p."Nombre_Empresa" and q."Consecutivo" = p."Consecutivo"
                  and q."Cliente" is distinct from p."Cliente" and coalesce(q."Cant_Entregada", 0) > 0);

-- Cambiar por ROLLBACK para probar sin guardar.
commit;
