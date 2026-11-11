-- ROLLBACK de tramitar_traslado_oc.sql
-- Quita el RPC de trámite y sus ayudantes. No deshace trámites ya hechos: las piezas y los remanentes
-- son filas de OC normales (las piezas, Cerradas con sus remisiones; el remanente, una OC Abierta común).
-- Aplicar ANTES de revertir el código de Pedidos (que llama a guardar_pedido_con_traslados).
-- Fecha: 2026-11-11

DROP FUNCTION IF EXISTS public.guardar_pedido_con_traslados(jsonb, jsonb, bigint[], jsonb);
DROP FUNCTION IF EXISTS public.tramitar_traslado_oc(jsonb);
DROP FUNCTION IF EXISTS public._oc_avisar_tramite(text, text, text, text, text, numeric, text, text, uuid);
DROP FUNCTION IF EXISTS public._remision_siguiente(text, text);
