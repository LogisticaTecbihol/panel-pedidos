-- ============================================================
-- Corrección puntual de datos: pedido #838 (PARCELAR DE COLOMBIA SAS →
-- EL ESTABLO COLOMBIA SAS), remisión PARCELAR-RS-0116.
--
-- Contexto: Lady Puentes registró la entrega el 2026-09-23 19:38 UTC
-- (EntregasPedido filas 583-588, remisión PARCELAR-RS-0116; el PDF de la
-- remisión se generó e imprimió en ese mismo guardado). 4 minutos después
-- (19:42 UTC) Carlos Ramirez guardó el mismo pedido desde una copia vieja
-- del modal (abierta antes del despacho) — guardarTodo() en js/pedidos.js
-- recalculaba Cant_Entregada/Remisiones/Estado_Entrega desde su copia
-- local sin refrescarla del servidor, así que su guardado (sin entregas
-- nuevas) pisó lo que Lady acababa de grabar: las 6 líneas del pedido
-- volvieron a Cant_Entregada=0, Remisiones=NULL, Estado_Entrega='Recibido'.
--
-- Como Kardex y Existencias (js/kardex.js, js/existencias.js) calculan la
-- salida de un pedido a partir de Pedidos.Cant_Entregada/Remisiones (NO de
-- EntregasPedido, que es un log secundario), el efecto fue que el sistema
-- dejó de reflejar un despacho que sí ocurrió físicamente.
--
-- Esta migración restaura Cant_Entregada/Cant_Pendiente/Estado_Entrega/
-- Remisiones en las 6 líneas según lo realmente despachado (EntregasPedido
-- 583-588). El bug de fondo (guardarTodo/saveEdit no refrescaban desde el
-- servidor antes de guardar) se corrigió aparte en js/pedidos.js.
--
-- Aplicar con apply_migration del MCP de Supabase. Fecha: 2026-09-24.
-- ============================================================

update "Pedidos" set
  "Cant_Entregada" = v.cant_entregada,
  "Cant_Pendiente" = v.cant_pendiente,
  "Estado_Entrega" = v.estado,
  "Remisiones" = v.remision || '|' || v.cant_entregada || '|2026-09-23'
from (values
  (1847, 12::numeric, 0::numeric, 'Entregado', 'PARCELAR-RS-0116'),
  (1848, 4, 0, 'Entregado', 'PARCELAR-RS-0116'),
  (1849, 3, 1, 'Parcial',   'PARCELAR-RS-0116'),
  (1850, 36, 0, 'Entregado','PARCELAR-RS-0116'),
  (1851, 4, 0, 'Entregado', 'PARCELAR-RS-0116'),
  (1852, 1, 3, 'Parcial',   'PARCELAR-RS-0116')
) as v(id, cant_entregada, cant_pendiente, estado, remision)
where "Pedidos".id = v.id;

-- ============================================================
-- FIN migración fix_pedido_838_entrega_rs0116
-- ============================================================
