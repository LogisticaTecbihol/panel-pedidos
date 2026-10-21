-- Solicitudes de EVENTOS (formato MC-ISO-FO01 «Solicitud de eventos», v1) con aprobación previa.
--
-- El comercial diligencia el formato en solicitudes-eventos.html. La solicitud queda guardada AQUÍ
-- en estado 'Por aprobar'; un aprobador (rol admin o módulo 'solicitudes_mercadeo_aprobar', los
-- mismos de "Solicitudes a Mercadeo") la aprueba o la rechaza con motivo. SOLO al aprobarse la
-- Edge Function `solicitud-evento` la crea en el módulo de Eventos de Mercadeo de panel-pqrs
-- (estado 'Radicada'; función `solicitud-evento-pedidos` de pqrs, migración 0031 de ese proyecto).
--
--   Por aprobar --aprobar--> Aprobada  (se crea en Eventos de Mercadeo; el Líder de Mercadeo la evalúa)
--   Por aprobar --rechazar-> Rechazada (motivo obligatorio; el solicitante puede editarla y reenviarla)
--   Si quien envía ya es aprobador (admin o permiso), se aprueba sola (auto_aprobada = true).
--   Mercadeo también puede rechazarla después (rechazada_por_mercadeo = true), vía `solicitud-evento-aviso`.
--
-- Permisos: se REUTILIZAN los módulos de "Solicitudes a Mercadeo": enviar = 'solicitudes_mercadeo';
-- aprobar = 'solicitudes_mercadeo_aprobar'. No hay claves nuevas en usuario_modulos.
--
-- Todo el formulario (secciones 1-5 del formato) viaja normalizado en `datos` (jsonb): la valida la
-- Edge Function y la vuelve a validar el trigger de pqrs. Las columnas sueltas son las que usan las
-- listas y las reglas (empresa, nombre y fecha del evento, fecha en que se radicó).
--
-- La tabla NO tiene políticas: el navegador no la lee ni la escribe. Todo pasa por la Edge Function
-- (service_role), que verifica sesión, permiso y empresas.
--
-- Idempotente. Aplicar como migración remota: add_solicitudes_eventos

CREATE TABLE IF NOT EXISTS solicitudes_eventos (
  id                  uuid        PRIMARY KEY,   -- request_id del formulario (== origen_ref en pqrs)
  numero              bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,   -- N° visible: SE-<numero>
  creado_por          uuid        NOT NULL REFERENCES usuarios(id),
  creado_por_nombre   text        NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  modificado_en       timestamptz NOT NULL DEFAULT now(),
  a_nombre_de_id      uuid        REFERENCES usuarios(id),
  a_nombre_de_nombre  text,
  empresa             text        NOT NULL CHECK (empresa IN ('PARCELAR','GREEN','RESO','IASO','IAS')),
  nombre_evento       text        NOT NULL CHECK (char_length(btrim(nombre_evento)) BETWEEN 3 AND 200),
  fecha_evento        date        NOT NULL,
  -- Fecha en que el solicitante radicó (o reenvió, tras un rechazo) la solicitud: base de la política de
  -- 15 días de anticipación. Una edición mientras sigue por aprobar o ya aprobada NO la reinicia.
  fecha_radicacion    date        NOT NULL,
  datos               jsonb       NOT NULL CHECK (jsonb_typeof(datos) = 'object'),
  archivos            jsonb       NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(archivos) = 'array' AND jsonb_array_length(archivos) <= 5),
  estado_aprobacion   text        NOT NULL DEFAULT 'Por aprobar'
                        CHECK (estado_aprobacion IN ('Por aprobar','Aprobada','Rechazada')),
  aprobada_por        uuid        REFERENCES usuarios(id),
  aprobada_por_nombre text,
  fecha_aprobacion    timestamptz,
  auto_aprobada       boolean     NOT NULL DEFAULT false,
  motivo_rechazo      text,
  rechazada_por_mercadeo boolean  NOT NULL DEFAULT false,
  reenvios            integer     NOT NULL DEFAULT 0,
  historial           jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{tipo, por, en, motivo?}]
  pqrs_evento_id      bigint,                                      -- id del evento creado en Eventos de Mercadeo
  CONSTRAINT se_a_nombre_completo CHECK ((a_nombre_de_id IS NULL) = (a_nombre_de_nombre IS NULL)),
  CONSTRAINT se_aprobada_con_datos CHECK (
    estado_aprobacion <> 'Aprobada'
    OR (aprobada_por_nombre IS NOT NULL AND fecha_aprobacion IS NOT NULL AND pqrs_evento_id IS NOT NULL)),
  CONSTRAINT se_rechazada_con_motivo CHECK (
    estado_aprobacion <> 'Rechazada' OR (motivo_rechazo IS NOT NULL AND btrim(motivo_rechazo) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_soleve_creado_por ON solicitudes_eventos (creado_por);
CREATE INDEX IF NOT EXISTS idx_soleve_a_nombre   ON solicitudes_eventos (a_nombre_de_id) WHERE a_nombre_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_soleve_estado     ON solicitudes_eventos (estado_aprobacion);
CREATE INDEX IF NOT EXISTS idx_soleve_aprobada_por ON solicitudes_eventos (aprobada_por) WHERE aprobada_por IS NOT NULL;

-- Sin políticas: acceso solo por service_role (Edge Function).
ALTER TABLE solicitudes_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON solicitudes_eventos FROM anon, authenticated;

COMMENT ON TABLE solicitudes_eventos IS
  'Solicitudes de eventos (formato MC-ISO-FO01) pendientes de aprobación / aprobadas / rechazadas. Solo las Edge Functions solicitud-evento y solicitud-evento-aviso leen y escriben.';

NOTIFY pgrst, 'reload schema';
