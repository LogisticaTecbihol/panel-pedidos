-- ============================================================
-- Migración: candado "lo despachado nunca excede lo solicitado"
--
-- Contexto: GREEN #80, línea 1521 (GREEN YODO X LITRO). Un doble clic
-- en "✓ Guardar cambios y enviar" de pedidos.html lanzó un segundo
-- guardarTodo() concurrente que corrompió el objeto en memoria de esa
-- línea; el bucle de UPDATE por línea (js/pedidos.js) persistió
-- Cant_Entregada = 120 sobre Cantidad = 60 y dejó la remisión
-- GREEN-RS-0030 duplicada en Pedidos.Remisiones. El único chequeo
-- vivía en el JavaScript del navegador y no había respaldo en BD.
--
-- El Kardex (js/existencias.js) deriva la SALIDA de un pedido de
-- Pedidos.Cant_Entregada + Pedidos.Remisiones (NO de la tabla
-- EntregasPedido, que es un log secundario para factura/trazabilidad y
-- puede tener filas huérfanas de flujos de corrección). Por eso el
-- candado va sobre "Pedidos":
--
--   Trigger BEFORE UPDATE en "Pedidos": no se puede dejar una línea con
--   Cant_Entregada > Cantidad si antes estaba consistente (cubre el
--   UPDATE directo por PostgREST y la RPC editar_pedido_completo).
--
-- Rechazo duro (RAISE EXCEPTION). Las filas ya inconsistentes se pueden
-- seguir editando para corregirlas — el candado solo impide CREAR
-- nuevas inconsistencias.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase.
-- Fecha: 2026-09-10
-- ============================================================


-- ── "Pedidos": Cant_Entregada nunca supera Cantidad ──
CREATE OR REPLACE FUNCTION public.fn_pedidos_no_sobre_entrega()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_ent  numeric := COALESCE(NEW."Cant_Entregada", 0);
  v_new_cant numeric := COALESCE(NEW."Cantidad", 0);
  v_old_ent  numeric := COALESCE(OLD."Cant_Entregada", 0);
  v_old_cant numeric := COALESCE(OLD."Cantidad", 0);
BEGIN
  -- Solo bloquea si el resultado viola el tope Y la fila NO estaba ya
  -- violada de antes (así una línea heredada inconsistente se puede
  -- corregir). Tolerancia 0.001 por redondeo numérico.
  IF v_new_ent > v_new_cant + 0.001
     AND NOT (v_old_ent > v_old_cant + 0.001) THEN
    RAISE EXCEPTION
      'La línea % (%) quedaría con % entregadas sobre % pedidas. Revisa el despacho — posible doble envío de "Guardar cambios y enviar".',
      NEW.id, COALESCE(NEW."Producto", '?'), v_new_ent, v_new_cant
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedidos_no_sobre_entrega ON public."Pedidos";
CREATE TRIGGER trg_pedidos_no_sobre_entrega
  BEFORE UPDATE ON public."Pedidos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedidos_no_sobre_entrega();

REVOKE ALL ON FUNCTION public.fn_pedidos_no_sobre_entrega() FROM public, anon, authenticated;


-- Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración guard_entregas_no_exceden_pedido
-- ============================================================
