-- Solicitudes a Mercadeo: envío DIRECTO (sin aprobación del gerente comercial).
--
-- Las solicitudes que NO son comerciales (ni quien envía ni la persona «a nombre de» tienen rol
-- comercial/editor/gerente_iaso/admin, y el área elegida no es «Comercial») se saltan la aprobación previa:
-- la Edge Function `solicitud-mercadeo` las manda de una vez al Tablero de Mercadeo (panel-pqrs), donde el
-- equipo de Mercadeo las acepta o las rechaza. Quedan 'Aprobada' (hay tarea en el Tablero) pero sin aprobador:
--   directa_mercadeo = true, aprobada_por = NULL, aprobada_por_nombre = 'Envío directo (sin aprobación comercial)'.
-- Si se edita o se reenvía, la bandera se apaga y se vuelve a evaluar la ruta.
--
-- Aditiva e idempotente (las filas anteriores quedan en false). Aplicar como migración remota
-- ANTES de desplegar la función: add_solicitudes_mercadeo_directa

ALTER TABLE solicitudes_mercadeo
  ADD COLUMN IF NOT EXISTS directa_mercadeo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN solicitudes_mercadeo.directa_mercadeo IS
  'true = fue directo a Mercadeo sin aprobacion del gerente comercial (solicitud no comercial)';
