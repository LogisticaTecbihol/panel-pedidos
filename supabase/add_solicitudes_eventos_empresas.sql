-- Solicitudes de eventos: empresas ADICIONALES «Chía Abagó», «Tecbihol» y «Otros» (con el nombre escrito).
--
-- Además de las 5 empresas del holding, la solicitud de evento puede ser de:
--   CHIA_ABAGO (Chía Abagó) · TECBIHOL (Tecbihol) · OTROS (otra empresa; el nombre queda en datos.empresa_otra, obligatorio 3-100 car.)
-- No son empresas del holding: no dependen de usuario_empresas, así que las puede elegir cualquiera que envíe solicitudes
-- (la función solicitud-evento las ofrece en `empresas_extra`). El nombre de «Otros» lo valida la función y lo vuelve a validar el
-- trigger de pqrs (migración 0032 de panel-pqrs).
--
-- Solo cambia la restricción de la columna `empresa`. Idempotente. Aplicar como migración remota: add_solicitudes_eventos_empresas

ALTER TABLE solicitudes_eventos DROP CONSTRAINT IF EXISTS solicitudes_eventos_empresa_check;
ALTER TABLE solicitudes_eventos ADD CONSTRAINT solicitudes_eventos_empresa_check
  CHECK (empresa IN ('PARCELAR','GREEN','RESO','IASO','IAS','CHIA_ABAGO','TECBIHOL','OTROS'));

NOTIFY pgrst, 'reload schema';
