-- ============================================================
-- Migración: candado "lo despachado nunca excede lo solicitado"
--
-- Contexto: GREEN #80 (línea 1521 · GREEN YODO X LITRO). Un doble clic
-- en "✓ Guardar cambios y enviar" de pedidos.html lanzó un segundo
-- guardarTodo() concurrente que corrompió el objeto en memoria de esa
-- línea; el bucle de UPDATE por línea (js/pedidos.js) persistió
-- Cant_Entregada = 120 sobre Cantidad = 60 y dejó la remisión
-- GREEN-RS-0030 duplicada en Pedidos.Remisiones. El único chequeo
-- vivía en el JavaScript del navegador y no había ningún respaldo en BD.
--
-- Este candado es defensa en profundidad a nivel base de datos:
--   1. Trigger BEFORE UPDATE en "Pedidos": no se puede dejar una línea
--      con Cant_Entregada > Cantidad si antes estaba consistente
--      (cubre el UPDATE directo por PostgREST y la RPC editar_pedido_completo).
--   2. Trigger BEFORE INSERT/UPDATE en "EntregasPedido": la suma de
--      cantidad entregada de una línea nunca puede superar Pedidos.Cantidad.
--
-- Ambos: rechazo duro (RAISE EXCEPTION). Filas ya inconsistentes se
-- pueden seguir editando (para corregirlas) — el candado solo impide
-- CREAR nuevas inconsistencias.
--
-- NOTA: el índice único parcial EntregasPedido(pedido_id, remision) se
-- deja para una migración posterior: hoy hay filas heredadas del mismo
-- bug (RESO #107, IASO #7) con remisión repetida en la misma línea que
-- harían fallar la creación del índice. Limpiarlas primero.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase.
-- Fecha: 2026-09-10
-- ============================================================


-- ── 1. "Pedidos": Cant_Entregada nunca supera Cantidad ──
CREATE OR REPLACE FUNCTION public.fn_pedidos_no_sobre_entrega()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_ent numeric := COALESCE(NEW."Cant_Entregada", 0);
  v_new_cant numeric := COALESCE(NEW."Cantidad", 0);
  v_old_ent numeric := COALESCE(OLD."Cant_Entregada", 0);
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


-- ── 2. "EntregasPedido": Σ cantidad de la línea ≤ Pedidos.Cantidad ──
CREATE OR REPLACE FUNCTION public.fn_entregas_pedido_no_excede()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cantidad_linea numeric;
  v_producto       text;
  v_ya_entregado   numeric;
BEGIN
  -- Un UPDATE que no toca ni la cantidad ni la línea (p. ej. etiquetar
  -- número de factura) no necesita revalidarse: deja pasar incluso si la
  -- línea ya estaba inconsistente de antes.
  IF TG_OP = 'UPDATE'
     AND NEW."cantidad"  IS NOT DISTINCT FROM OLD."cantidad"
     AND NEW."pedido_id" IS NOT DISTINCT FROM OLD."pedido_id" THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW."cantidad", 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT "Cantidad", "Producto" INTO v_cantidad_linea, v_producto
    FROM public."Pedidos" WHERE "id" = NEW."pedido_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EntregasPedido: la línea de pedido % no existe', NEW."pedido_id";
  END IF;

  -- Línea sin cantidad informada (datos antiguos): no se puede validar.
  IF COALESCE(v_cantidad_linea, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("cantidad"), 0) INTO v_ya_entregado
    FROM public."EntregasPedido"
   WHERE "pedido_id" = NEW."pedido_id"
     AND (TG_OP = 'INSERT' OR "id" <> NEW."id");

  IF v_ya_entregado + NEW."cantidad" > v_cantidad_linea + 0.001 THEN
    RAISE EXCEPTION
      'Despacho excede lo solicitado en % (línea %): pedidas %, ya entregadas %, intento de entregar % más.',
      COALESCE(v_producto, '?'), NEW."pedido_id",
      v_cantidad_linea, v_ya_entregado, NEW."cantidad"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_entregas_pedido_no_excede ON public."EntregasPedido";
CREATE TRIGGER trg_entregas_pedido_no_excede
  BEFORE INSERT OR UPDATE ON public."EntregasPedido"
  FOR EACH ROW EXECUTE FUNCTION public.fn_entregas_pedido_no_excede();

REVOKE ALL ON FUNCTION public.fn_entregas_pedido_no_excede() FROM public, anon, authenticated;


-- ── 3. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración guard_entregas_no_exceden_pedido
-- ============================================================
