-- ============================================================
-- Rollback de remision_unica_por_orden_pedidos.sql
-- Quita el candado «una remisión de pedidos = una sola orden».
-- No toca datos. Idempotente.
-- ============================================================

DROP TRIGGER IF EXISTS trg_pedidos_remision_unica_por_orden ON public."Pedidos";
DROP FUNCTION IF EXISTS public.fn_pedidos_remision_unica_por_orden();
DROP FUNCTION IF EXISTS public.fn_pedidos_codigos_remision(text);

NOTIFY pgrst, 'reload schema';
