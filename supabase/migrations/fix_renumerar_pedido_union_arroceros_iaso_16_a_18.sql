-- ============================================================
-- Fix de datos (2026-09-21): IASO #16 repetido en el comercial ISO-C05
--
-- BODEGA COATOL (ids 1765/1766, 17/09) y UNION DE ARROCEROS - Espinal
-- (ids 1806/1807, 18/09) quedaron con el mismo N° 16 porque el formulario
-- calculaba el consecutivo con una lista desactualizada (ver
-- add_generar_consecutivo_pedido.sql). El #17 ya lo usa UNION DE ARROCEROS -
-- Saldaña (id 1808), así que el pedido de Espinal pasa a #18.
--
-- Además del pedido, se actualiza el texto "... #16" de sus 2 solicitudes de
-- compra (OrdenesCompra 387/388, Tipo Traslado, pedido_id 1806/1807), que se
-- indexan por Ref_Pedido = "<empresa> #<N°>". Las OC 383/384 (COATOL) y
-- 255/256 (otro pedido antiguo, pedido_id 1310) NO se tocan.
--
-- Todo o nada: si algo no coincide con lo esperado, aborta y revierte.
-- ============================================================

DO $$
DECLARE
  n_ped int;
  n_oc  int;
BEGIN
  IF EXISTS (SELECT 1 FROM "Pedidos"
              WHERE lower(btrim("Comercial")) = 'iso-c05' AND "Consecutivo" = '18') THEN
    RAISE EXCEPTION 'Ya existe un pedido #18 para ISO-C05; no se renumera';
  END IF;

  UPDATE "Pedidos"
     SET "Consecutivo" = '18'
   WHERE id IN (1806, 1807)
     AND "Consecutivo" = '16'
     AND "Comercial" = 'ISO-C05'
     AND "Cliente" = 'UNION DE ARROCEROS S.A.S.'
     AND "Nombre_Empresa" = 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS';
  GET DIAGNOSTICS n_ped = ROW_COUNT;
  IF n_ped <> 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 líneas de pedido y se actualizaron %', n_ped;
  END IF;

  UPDATE "OrdenesCompra"
     SET "Ref_Pedido"    = 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS #18',
         "Observaciones" = replace("Observaciones", 'SOSTENIBLES SAS #16', 'SOSTENIBLES SAS #18')
   WHERE id IN (387, 388)
     AND pedido_id IN (1806, 1807)
     AND "Ref_Pedido" = 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS #16';
  GET DIAGNOSTICS n_oc = ROW_COUNT;
  IF n_oc <> 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 solicitudes de compra y se actualizaron %', n_oc;
  END IF;
END $$;
