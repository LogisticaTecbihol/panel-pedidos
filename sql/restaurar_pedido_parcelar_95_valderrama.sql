-- ============================================================
-- EJECUTADO el 2026-11-04 — NO volver a ejecutar (ver «Resultado» más abajo).
--
-- Restauración de datos: Pedido #95 de PARCELAR (VALDERRAMA RATIVA EPIGMENIO) y su
-- remisión PARCELAR-RS-0203, borrados por accidente.
--
--   Pedidos.id 2942 · PARCELAR DE COLOMBIA SAS · consecutivo 95 · comercial PDC-C08
--   JABOLAN X LITRO · 12 L · $29.403 c/u · total $352.836 · Archivo_Fuente «Ingreso manual»
--   Remisión PARCELAR-RS-0203, entrega del 2026-10-28 (EntregasPedido 1022, 12 ud)
--
-- Historia (audit_log):
--   · 2026-10-27 20:19  INSERT  Pedidos 2942          candresr_81@hotmail.com (Carlos Ramirez)
--   · 2026-10-28 12:53  UPDATE  Pedidos 2942          aux.logistica@tecbihol.com (Lady Puentes): remisión 0203, 12/12, Cerrado
--   · 2026-10-28 12:53  INSERT  EntregasPedido 1022   aux.logistica@tecbihol.com
--   · 2026-10-28 12:53  notificación «Paquete Pedido 95 — Rem PARCELAR-RS-0203» a contabilidad de PARCELAR
--                       (leída el 2026-10-29): el paquete PDF YA había llegado.
--   · 2026-10-28 13:40  DELETE  Pedidos 2942          adrianpuentes@gmail.com   (audit_log id 21488, con la fila completa)
--
-- Al borrarse el pedido, EntregasPedido 1022 quedó huérfana (no hay FK) y el Kardex perdió la salida
-- de 12 L de JABOLAN X LITRO (existencias de PARCELAR infladas en 12). No había apartados, OC ni
-- «Remisión anulada» ligados al pedido.
--
-- Qué hace (en un solo bloque, con guardas: si el pedido ya existe o la fila no coincide, no guarda nada):
--   · reinserta Pedidos con el MISMO id 2942 desde audit_log.datos_antes (id 21488), así la entrega 1022
--     se vuelve a enlazar sola;
--   · como fn_audit_log quita creado_*/modificado_* del JSON, esos seis campos se reponen desde las
--     entradas del propio audit_log (creó Carlos Ramirez 2026-10-27 20:19:56.138962+00; última modificación
--     Lady Puentes 2026-10-28 12:53:14.426793+00);
--   · comprueba que la fila restaurada es idéntica a la original.
--
-- POR QUÉ POR SQL Y NO DESDE LA PANTALLA: «Nuevo pedido» + «Emitir entrega» gastaría un número de remisión
-- nuevo y enviaría otra vez el paquete PDF a contabilidad. Ese envío lo hace el NAVEGADOR
-- (NOTIF.enviarPDFContabilidad, pedidos.js); la base no tiene triggers ni webhooks de envío, así que un
-- insert directo no notifica a nadie. Verificado: no apareció ninguna notificación nueva.
--
-- Resultado (verificado):
--   · Pedidos 2942 idéntico a la fila borrada (Cerrado, Entregado, Remisiones = PARCELAR-RS-0203|12|2026-10-28);
--   · EntregasPedido 1022 enlazada otra vez;
--   · el Kardex vuelve a mostrar la salida (PARCELAR · JABOLAN X LITRO · -12 · 2026-10-28 · Pedidos · RS-0203);
--   · notificaciones con PARCELAR-RS-0203: solo la original; ninguna nueva;
--   · audit_log: el INSERT de la restauración (id 22988, sin usuario porque corre con el rol de servicio).
--
-- Decisión (2026-11-04): el consecutivo 95 se conserva (coincide con los papeles firmados). El 3-nov, al haber
-- quedado libre el 95 de PDC-C08, se creó el #95 de AGRICOLA CADENA SAS (ids 3027/3028, abierto): NO se tocó.
-- Hoy hay en PARCELAR varios #95 de clientes distintos (VALDERRAMA, AGRICOLA CADENA y el histórico de
-- JOHANA GONZALEZ); el sistema los distingue por consecutivo + cliente.
--
-- Hallazgo aparte (NO corregido aquí): al emitir la RS-0203, la aplicación reasignó comercial_id de las 4
-- líneas históricas del #95 de JOHANA GONZALEZ (Pedidos 240–243, Comercial PDC-C07) de Didimo Cubillos
-- (0d581b96-3a7b-4530-b53a-81558f1f52d6) a Lucero Linares (6a2433d1-bff2-483b-9183-3bf0d5c6d86f) (audit_log
-- 21454–21457). Pasa cuando varios clientes comparten consecutivo; se ve también en pedidos de IASO.
--
-- Para probar sin guardar: añadir al final del bloque `raise exception 'prueba, no se guarda';`.
-- ============================================================

-- 0) Estado antes (solo lectura): el pedido NO debe existir, la entrega debe estar huérfana
select id, "Consecutivo", "Cliente", "Remisiones" from "Pedidos" where id = 2942;                 -- 0 filas
select e.id, e.pedido_id, e.remision, e.cantidad
  from "EntregasPedido" e
 where e.id = 1022 and not exists (select 1 from "Pedidos" p where p.id = e.pedido_id);          -- 1 fila (huérfana)

-- 1) Restauración
do $$
declare
  v_ant jsonb;
  v_ins int;
  v_eq  boolean;
begin
  if exists (select 1 from "Pedidos" where id = 2942) then
    raise exception 'El pedido 2942 ya existe: no se restaura de nuevo';
  end if;

  select datos_antes into v_ant from audit_log
   where id = 21488 and tabla = 'Pedidos' and accion = 'DELETE' and registro_id = '2942';
  if v_ant is null then raise exception 'No se encontro el DELETE en audit_log'; end if;

  insert into "Pedidos"
  select * from jsonb_populate_record(
    null::"Pedidos",
    v_ant || jsonb_build_object(
      'creado_por',            'ddedf9f2-df94-4e39-ab0a-3e8336a4591c',   -- Carlos Ramirez
      'creado_en',             '2026-10-27 20:19:56.138962+00',
      'creado_por_nombre',     'Carlos Ramirez',
      'modificado_por',        'd7fba09f-ec6d-4207-83d3-4aae16a7e580',   -- Lady Puentes
      'modificado_en',         '2026-10-28 12:53:14.426793+00',
      'modificado_por_nombre', 'Lady Puentes'));
  get diagnostics v_ins = row_count;
  if v_ins <> 1 then raise exception 'Se esperaba 1 fila insertada, fueron %', v_ins; end if;

  select (to_jsonb(p) - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en'
                      - 'creado_por_nombre' - 'modificado_por_nombre') = v_ant
    into v_eq from "Pedidos" p where p.id = 2942;
  if not coalesce(v_eq, false) then raise exception 'La fila restaurada no coincide con la original'; end if;
end $$;

-- 2) Verificación
select p.id, p."Consecutivo", p."Cliente", p."Producto", p."Cantidad", p."Cant_Entregada",
       p."Estado_2", p."Remisiones", p.creado_por_nombre, p.modificado_por_nombre
  from "Pedidos" p where p.id = 2942;
select e.id, e.pedido_id, e.remision, e.cantidad
  from "EntregasPedido" e join "Pedidos" p on p.id = e.pedido_id where e.id = 1022;
select empresa, producto, signo, cantidad, fecha, modulo, remision
  from _kx_movs(null) where remision = 'PARCELAR-RS-0203';
select count(*) as notificaciones_rs_0203 from notificaciones where referencia = 'PARCELAR-RS-0203';  -- 1 (la original)
