-- ============================================================
-- EJECUTADO el 2026-11-04 — NO volver a ejecutar (ver «Resultado» más abajo).
--
-- Corrección de datos: IASO-RS-0171 quedó en DOS órdenes de clientes distintos.
--
--   Orden 146 · AGROPECUARIA INTERNACIONAL SAS · Pedidos.id 2916            · EntregasPedido 1118 · 2026-11-03 5:00 p.m.
--   Orden 152 · HURTADO SANTANA DENIS MACIEL   · Pedidos.id 3070 y 3071     · EntregasPedido 1119, 1120 · 2026-11-03 5:06 p.m.
--
-- El contador de IASO (consecutivos_remisiones, SALIDA) emitió el 0171 UNA sola
-- vez, para la orden 146. La orden 152 lo recibió escrito a mano. Por eso este
-- borrador deja el 0171 en la 146 y pasa la 152 a un número nuevo.
--
-- Resultado: la orden 152 quedó en IASO-RS-0174 (el contador IASO/SALIDA pasó de 173
-- a 174) y la 146 conserva IASO-RS-0171. Se decidió sin consultar a la remisionadora
-- porque el propio sistema lo respondía: el contador emitió el 0171 una sola vez,
-- para la 146 (2026-11-03 5:00 p. m.), y los avisos a contabilidad de las dos
-- órdenes salieron titulados «Rem IASO-RS-0171» (146: Alison Vargas y Lizeth Bonilla;
-- 152: Alison Vargas y Sharon Bajonero). Ninguna de las tres entregas tenía factura.
--
-- Pendiente, fuera de la base: reemitir el PDF de la 152 con el número nuevo y
-- reenviarlo a Alison y Sharon pidiéndoles descartar el anterior. Los avisos viejos
-- de la tabla notificaciones siguen titulados 0171 y no se tocaron (es historial).
-- NO usar «Remisión anulada» para el 0171 de la 152: funciona por número y
-- excluiría también la remisión de la 146 del Kardex.
--
-- Si hubiera que invertir el criterio (dejar el 0171 en la 152 y renumerar la 146),
-- usar ids de Pedidos 2916 / EntregasPedido 1118 / orden '146'.
--
-- Qué hace (en una transacción, con guardas: si el dato ya cambió, no hace nada):
--   · toma el siguiente número del contador IASO/SALIDA (igual que el RPC
--     generar_remision, que aquí no sirve porque exige auth.uid());
--   · reemplaza 0171 por el número nuevo en Pedidos.Remisiones (ids 3070, 3071) y
--     en EntregasPedido.remision (ids 1119, 1120);
--   · el Kardex y Reportes → Remisiones leen Pedidos.Remisiones, así que se
--     corrigen solos. No hay factura asociada a esas filas (num_factura vacío).
--
-- El trigger trg_pedidos_remision_unica_por_orden (migración remision_unica_por_orden_pedidos)
-- no estorba: el número nuevo no está en ninguna otra orden.
--
-- Probar primero cambiando el COMMIT final por ROLLBACK. Fecha: 2026-11-04.
-- ============================================================

-- 0) Estado actual (solo lectura)
select p.id, p."Consecutivo", p."Cliente", p."Producto", p."Cantidad", p."Remisiones"
from "Pedidos" p
where p."Remisiones" ilike '%IASO-RS-0171%'
order by p."Consecutivo", p.id;

select e.id, e.pedido_id, e.producto, e.cantidad, e.remision, e.creado_en
from "EntregasPedido" e
where e.remision = 'IASO-RS-0171'
order by e.id;

-- 1) Corrección
begin;

do $$
declare
  v_emp   constant text := 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS';
  v_vieja constant text := 'IASO-RS-0171';
  v_nueva text;
  v_n     int;
begin
  -- Guardas: el dato sigue tal como se diagnosticó.
  if (select count(*) from "Pedidos"
        where id in (3070, 3071) and "Nombre_Empresa" = v_emp and "Consecutivo" = '152'
          and "Remisiones" like v_vieja || '|%') <> 2 then
    raise exception 'Pedidos 3070/3071 ya no coinciden con lo diagnosticado; no se toca nada';
  end if;
  if (select count(*) from "EntregasPedido"
        where id in (1119, 1120) and pedido_id in (3070, 3071) and remision = v_vieja) <> 2 then
    raise exception 'EntregasPedido 1119/1120 ya no coinciden con lo diagnosticado; no se toca nada';
  end if;

  -- Siguiente número del contador IASO / SALIDA (mismo UPDATE que hace generar_remision).
  update consecutivos_remisiones
     set ultimo_numero = ultimo_numero + 1
   where empresa = 'IASO' and tipo = 'SALIDA'
  returning ultimo_numero into v_n;
  if v_n is null then
    raise exception 'No se encontró el contador IASO/SALIDA';
  end if;
  v_nueva := 'IASO-RS-' || lpad(v_n::text, 4, '0');

  update "Pedidos"
     set "Remisiones" = replace("Remisiones", v_vieja, v_nueva)
   where id in (3070, 3071);

  update "EntregasPedido"
     set remision = v_nueva
   where id in (1119, 1120);

  raise notice 'Orden 152 (HURTADO SANTANA) pasa de % a %', v_vieja, v_nueva;
end $$;

-- 2) Verificación (debe mostrar el 0171 solo en la orden 146 y el número nuevo en la 152)
select p.id, p."Consecutivo", p."Cliente", p."Remisiones"
from "Pedidos" p
where p.id in (2916, 3070, 3071)
order by p.id;

-- Cambiar por ROLLBACK para probar sin guardar.
commit;
