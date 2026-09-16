-- ============================================================
-- Fix: Estado_Entrega vacío en pedidos de "Ingreso manual"
--
-- Causa real: agregarPedido() en js/shared.js nunca fijaba
-- Estado_Entrega ni Cant_Pendiente al insertar un pedido nuevo —
-- solo escribía la columna vieja/sin uso "Estado" (minúscula).
-- El módulo Pedidos no lo notaba porque pedidos.js:953 lo parcha
-- en memoria a "Recibido" cada vez que carga, sin guardar el
-- arreglo en la base. Detectado porque el módulo nuevo "Bodegas en
-- Consignación" lee Estado_Entrega crudo, sin ese parche.
--
-- Arreglo de la causa: agregarPedido() ahora sí fija
-- Cant_Entregada=0, Cant_Pendiente=Cantidad, Estado_Entrega='Recibido'
-- al crear el pedido (commit siguiente a este).
--
-- Este archivo es el backfill de las 28 filas ya afectadas
-- (verificadas: todas con Cant_Entregada=0, Cant_Pendiente=0,
-- sin Remisiones — ningún despacho real pendiente de reflejar).
-- Respaldo en _backup_pedidos_estado_entrega_20260916.
--
-- Aplicado con apply_migration del MCP de Supabase el 2026-09-16.
-- ============================================================

CREATE TABLE IF NOT EXISTS public._backup_pedidos_estado_entrega_20260916 AS
SELECT id, "Estado_Entrega", "Cant_Pendiente", "Cantidad", "Cant_Entregada"
FROM public."Pedidos"
WHERE coalesce(trim("Estado_Entrega"), '') = '';

UPDATE public."Pedidos"
SET "Estado_Entrega" = 'Recibido',
    "Cant_Pendiente" = GREATEST(coalesce("Cantidad",0) - coalesce("Cant_Entregada",0), 0)
WHERE coalesce(trim("Estado_Entrega"), '') = '';
