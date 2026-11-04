-- ============================================================
-- Migración: candado "una remisión de pedidos corresponde a UNA sola orden"
--
-- Contexto: IASO-RS-0171 quedó en dos órdenes de clientes distintos
-- (146 AGROPECUARIA INTERNACIONAL SAS, 5:00 p.m., y 152 HURTADO SANTANA
-- DENIS MACIEL, 5:06 p.m. del 2026-11-03). El contador de remisiones
-- (consecutivos_remisiones) emitió el 0171 UNA sola vez: el segundo uso fue
-- un número escrito a mano (rol admin/remisionador con la casilla «Auto»
-- desmarcada en pedidos.html) y nada en la base ni en pedidos.js impedía
-- repetirlo. De 422 remisiones de pedidos era la única que cubría más de una
-- orden/cliente.
--
-- El Kardex, Existencias y Reportes → Remisiones leen Pedidos.Remisiones
-- (NO EntregasPedido, que es un log secundario), por eso el candado va ahí:
--
--   Trigger BEFORE UPDATE OF "Remisiones" en "Pedidos": una línea no puede
--   AGREGAR a su campo Remisiones un número que ya figura en otra orden de
--   la misma empresa. «Misma orden» = mismo Consecutivo y mismo Cliente
--   (es la clave con la que pedidos.js arma cada orden: keyOf(empresa,
--   consecutivo, cliente); un mismo consecutivo puede agrupar varios
--   clientes, cada uno con su propia remisión).
--
-- · Solo valida los números NUEVOS de la línea (los que ya tenía no se
--   revalidan), así que IASO-RS-0171 —ya repetido— no bloquea otras
--   ediciones de esas líneas ni su corrección.
-- · Al cambiar de cliente en el mismo guardado se acepta el cliente anterior
--   de la línea (OLD) o el nuevo (NEW), porque editar_pedido_completo
--   actualiza línea por línea y las hermanas pueden conservar aún el
--   nombre viejo.
-- · Agregar más líneas al MISMO pedido con su remisión sigue permitido.
-- · Se compara solo dentro de la misma Nombre_Empresa y sin distinguir
--   mayúsculas/espacios.
-- · SECURITY DEFINER para ver las órdenes de otras empresas/comerciales
--   aunque las RLS del usuario no se las muestren; un pg_advisory_xact_lock
--   por empresa+número serializa dos guardados simultáneos con el mismo número.
-- · Rechazo duro (RAISE EXCEPTION, 23505). editar_pedido_completo es una
--   sola transacción: si falla no escribe nada y el mensaje llega a pedidos.js.
--
-- Alcance: solo Pedidos. No toca Ingresos, OC, Muestras, Reenvases ni
-- Devoluciones (comparten contador, pero no este candado). No corrige datos
-- existentes (ver sql/corregir_remision_iaso_rs_0171_orden_152.sql).
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase ANTES de
-- publicar el código. Fecha: 2026-11-04.
-- ============================================================


-- ── Códigos de remisión de un valor de Pedidos.Remisiones ──
-- Formato: "REM|cant|fecha,REM|cant|fecha" (o lista simple "REM1, REM2").
-- Devuelve los códigos en MAYÚSCULAS, sin vacíos ni repetidos.
CREATE OR REPLACE FUNCTION public.fn_pedidos_codigos_remision(p_remisiones text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT s.cod) FILTER (WHERE s.cod <> ''), ARRAY[]::text[])
  FROM (
    SELECT upper(btrim(split_part(btrim(t.p), '|', 1))) AS cod
    FROM unnest(string_to_array(COALESCE(p_remisiones, ''), ',')) AS t(p)
  ) s;
$function$;


-- ── "Pedidos": una remisión nueva no puede estar ya en otra orden ──
CREATE OR REPLACE FUNCTION public.fn_pedidos_remision_unica_por_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cod   text;
  v_otro  record;
BEGIN
  -- Solo los números que esta línea AGREGA (los que ya tenía no se revalidan).
  FOR v_cod IN
    SELECT c FROM unnest(public.fn_pedidos_codigos_remision(NEW."Remisiones")) AS c
    EXCEPT
    SELECT c FROM unnest(public.fn_pedidos_codigos_remision(OLD."Remisiones")) AS c
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('pedidos_remision:' || COALESCE(NEW."Nombre_Empresa", '') || ':' || v_cod)
    );

    SELECT o."Consecutivo", o."Cliente" INTO v_otro
    FROM public."Pedidos" o
    WHERE o.id <> NEW.id
      AND o."Nombre_Empresa" IS NOT DISTINCT FROM NEW."Nombre_Empresa"
      AND strpos(upper(COALESCE(o."Remisiones", '')), v_cod) > 0
      AND v_cod = ANY (public.fn_pedidos_codigos_remision(o."Remisiones"))
      AND NOT (
        o."Consecutivo" IS NOT DISTINCT FROM NEW."Consecutivo"
        AND lower(btrim(COALESCE(o."Cliente", ''))) IN (
          lower(btrim(COALESCE(NEW."Cliente", ''))),
          lower(btrim(COALESCE(OLD."Cliente", '')))
        )
      )
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'La remisión % ya pertenece a la orden % (cliente %) de esta empresa. Una remisión corresponde a una sola orden: deje «Auto» para generar un número nuevo o escriba otro.',
        v_cod, COALESCE(v_otro."Consecutivo", '?'), COALESCE(NULLIF(btrim(v_otro."Cliente"), ''), '?')
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedidos_remision_unica_por_orden ON public."Pedidos";
CREATE TRIGGER trg_pedidos_remision_unica_por_orden
  BEFORE UPDATE OF "Remisiones" ON public."Pedidos"
  FOR EACH ROW
  WHEN (NEW."Remisiones" IS DISTINCT FROM OLD."Remisiones")
  EXECUTE FUNCTION public.fn_pedidos_remision_unica_por_orden();

REVOKE ALL ON FUNCTION public.fn_pedidos_codigos_remision(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_pedidos_remision_unica_por_orden() FROM public, anon, authenticated;


-- Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración remision_unica_por_orden_pedidos
-- ============================================================
