-- ROLLBACK de oc_traslado_diferido_activar.sql
-- Quita el marcado automático de las OC nuevas y devuelve a OC común las diferidas que siguen
-- pendientes (sin remisiones, Abiertas). Las piezas ya tramitadas (Cerradas, con remisiones) quedan
-- como filas de OC legalizadas normales: su marca no importa y se deja (el candado de inmutabilidad
-- desaparece si luego se revierte oc_traslado_diferido.sql).
-- Fecha: 2026-11-11

DROP TRIGGER IF EXISTS trg_oc_diferida_alta ON public."OrdenesCompra";
DROP FUNCTION IF EXISTS public.fn_oc_diferida_alta();

UPDATE public."OrdenesCompra"
   SET "Traslado_Diferido" = false
 WHERE "Traslado_Diferido"
   AND COALESCE("Estado", '') = 'Abierta'
   AND COALESCE(btrim("Remision"), '') = ''
   AND COALESCE(btrim("Remision_Origen"), '') = '';
