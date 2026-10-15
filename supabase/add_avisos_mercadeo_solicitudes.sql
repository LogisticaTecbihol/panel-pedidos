-- Avisos desde el Tablero de Mercadeo (panel-pqrs) hacia el solicitante, y rechazo por Mercadeo.
--
-- Qué habilita:
--   1. Mercadeo puede RECHAZAR en su Tablero una solicitud ya aprobada aquí (con motivo). La función
--      `solicitud-mercadeo-aviso` (llamada por pqrs, server -> server) la devuelve a 'Rechazada' con
--      rechazada_por_mercadeo = true; el solicitante la corrige y la reenvía (vuelve a 'Por aprobar').
--   2. Los avisos del Tablero (cambio de estado, rechazo, respuesta) llegan a la campanita del
--      solicitante como notificaciones DEL SISTEMA: no tienen un usuario emisor de este panel
--      (de_usuario_id NULL). La interfaz ya muestra '—' cuando no hay emisor.
--
-- Idempotente. Aplicar como migración remota: add_avisos_mercadeo_solicitudes

-- ── 1. Notificaciones del sistema (sin usuario emisor) ───────
ALTER TABLE notificaciones
  ALTER COLUMN de_usuario_id DROP NOT NULL;

-- ── 2. Marca de "rechazada por Mercadeo" ─────────────────────
ALTER TABLE solicitudes_mercadeo
  ADD COLUMN IF NOT EXISTS rechazada_por_mercadeo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN solicitudes_mercadeo.rechazada_por_mercadeo IS
  'true cuando el rechazo lo hizo Mercadeo en su Tablero (ya habia sido aprobada aqui). aprobada_por_nombre guarda quien rechazo en Mercadeo; pqrs_tarea_id apunta a la tarea rechazada hasta que se reenvie.';

NOTIFY pgrst, 'reload schema';
