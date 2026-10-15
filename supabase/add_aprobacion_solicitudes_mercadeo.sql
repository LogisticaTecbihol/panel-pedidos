-- Aprobación previa de las solicitudes a Mercadeo (misma lógica que las solicitudes de muestras).
--
-- Antes la solicitud viajaba directo al Tablero de panel-pqrs. Ahora queda guardada AQUÍ en
-- estado 'Por aprobar' y solo cuando un aprobador la aprueba la Edge Function
-- `solicitud-mercadeo` la crea en el Tablero de Mercadeo (panel-pqrs).
--
--   Por aprobar --aprobar--> Aprobada  (se crea en el Tablero; aparece como "Recibido")
--   Por aprobar --rechazar-> Rechazada (motivo obligatorio; el solicitante puede editarla y reenviarla)
--   Si quien envía ya es aprobador (admin o permiso), se aprueba sola (auto_aprobada = true).
--
-- Quién aprueba: rol admin o módulo 'solicitudes_mercadeo_aprobar' (casilla nueva en Usuarios;
-- NO se siembra a nadie: se asigna manualmente, como 'muestras_aprobar').
--
-- La tabla NO tiene políticas: el navegador no la lee ni la escribe. Todo pasa por la Edge
-- Function (service_role), que verifica sesión, permiso y empresas.
--
-- Idempotente. Aplicar como migración remota: add_aprobacion_solicitudes_mercadeo

-- ── 1. Tabla ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solicitudes_mercadeo (
  id                  uuid        PRIMARY KEY,   -- request_id del formulario (== origen_ref en pqrs)
  numero              bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,   -- N° visible: SM-<numero>
  creado_por          uuid        NOT NULL REFERENCES usuarios(id),
  creado_por_nombre   text        NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  modificado_en       timestamptz NOT NULL DEFAULT now(),
  a_nombre_de_id      uuid        REFERENCES usuarios(id),
  a_nombre_de_nombre  text,
  empresa             text        NOT NULL CHECK (empresa IN ('PARCELAR','GREEN','RESO','IASO','IAS')),
  asunto              text        NOT NULL CHECK (asunto IN (
                        'material_pop','material_impreso','piezas_graficas','piezas_audiovisuales',
                        'diseno_nuevo_producto','diseno_ajuste_portafolios','diseno_ajuste_institucional',
                        'desarrollo_marca','otros')),
  asunto_otro         text,
  fecha_tentativa     date        NOT NULL,
  descripcion         text        NOT NULL CHECK (char_length(btrim(descripcion)) BETWEEN 10 AND 2000),
  archivos            jsonb       NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(archivos) = 'array' AND jsonb_array_length(archivos) <= 5),
  estado_aprobacion   text        NOT NULL DEFAULT 'Por aprobar'
                        CHECK (estado_aprobacion IN ('Por aprobar','Aprobada','Rechazada')),
  aprobada_por        uuid        REFERENCES usuarios(id),
  aprobada_por_nombre text,
  fecha_aprobacion    timestamptz,
  auto_aprobada       boolean     NOT NULL DEFAULT false,
  motivo_rechazo      text,
  reenvios            integer     NOT NULL DEFAULT 0,
  historial           jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{tipo, por, en, motivo?}]
  pqrs_tarea_id       bigint,                                      -- id de la tarea creada en el Tablero
  CONSTRAINT sm_asunto_otro_valido CHECK (
    asunto_otro IS NULL OR (asunto = 'otros' AND char_length(btrim(asunto_otro)) BETWEEN 3 AND 100)),
  CONSTRAINT sm_a_nombre_completo CHECK ((a_nombre_de_id IS NULL) = (a_nombre_de_nombre IS NULL)),
  CONSTRAINT sm_aprobada_con_datos CHECK (
    estado_aprobacion <> 'Aprobada'
    OR (aprobada_por_nombre IS NOT NULL AND fecha_aprobacion IS NOT NULL AND pqrs_tarea_id IS NOT NULL)),
  CONSTRAINT sm_rechazada_con_motivo CHECK (
    estado_aprobacion <> 'Rechazada' OR (motivo_rechazo IS NOT NULL AND btrim(motivo_rechazo) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_solmerc_creado_por ON solicitudes_mercadeo (creado_por);
CREATE INDEX IF NOT EXISTS idx_solmerc_a_nombre   ON solicitudes_mercadeo (a_nombre_de_id) WHERE a_nombre_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_solmerc_estado     ON solicitudes_mercadeo (estado_aprobacion);

-- Sin políticas: acceso solo por service_role (Edge Function).
ALTER TABLE solicitudes_mercadeo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON solicitudes_mercadeo FROM anon, authenticated;

COMMENT ON TABLE solicitudes_mercadeo IS
  'Solicitudes a Mercadeo pendientes de aprobacion / aprobadas / rechazadas. Solo la Edge Function solicitud-mercadeo lee y escribe.';

-- ── 2. Permiso de aprobación ─────────────────────────────────
ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad','notificaciones','clientes',
    'productos','reabastecimiento','bodegas_consignacion',
    'cartera','crm',
    'legalizacion_gastos','legalizacion_gastos_aprobar',
    'solicitudes_mercadeo','solicitudes_mercadeo_aprobar'
  ));

-- ── 3. Avisos in-app (campanita) ─────────────────────────────
ALTER TABLE notificaciones
  DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;

ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo IN (
    'pedidos','devoluciones','cambios','muestras','ordenes',
    'ingresos','reenvases','kardex','reportes','crm',
    'solicitudes_mercadeo'
  ));
