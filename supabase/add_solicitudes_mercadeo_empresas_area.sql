-- Solicitudes a Mercadeo: empresas ADICIONALES «Chía Abagó», «Tecbihol» y «Otros» (con el nombre escrito)
-- y campo «Departamento / Área».
--
-- Mismas opciones de empresa que la solicitud de eventos (add_solicitudes_eventos_empresas.sql): además de las 5 del
-- holding (las que tenga asignadas el usuario), cualquiera que envíe solicitudes puede elegir
--   CHIA_ABAGO (Chía Abagó) · TECBIHOL (Tecbihol) · OTROS (otra empresa; el nombre queda en empresa_otra, obligatorio 3-100 car.)
-- Las valida la función solicitud-mercadeo; aquí solo se amplía la restricción y se agregan las columnas nuevas:
--   · empresa_otra      -> nombre de la empresa cuando empresa = 'OTROS' (NULL en cualquier otro caso).
--   · departamento_area -> Departamento / Área del solicitante (opcional, hasta 120 caracteres).
--
-- Cambio aditivo y retrocompatible: las filas existentes (empresa del holding, sin nombre ni área) cumplen las
-- restricciones nuevas. Idempotente. Aplicar como migración remota: add_solicitudes_mercadeo_empresas_area

ALTER TABLE solicitudes_mercadeo ADD COLUMN IF NOT EXISTS empresa_otra text;
ALTER TABLE solicitudes_mercadeo ADD COLUMN IF NOT EXISTS departamento_area text;

ALTER TABLE solicitudes_mercadeo DROP CONSTRAINT IF EXISTS solicitudes_mercadeo_empresa_check;
ALTER TABLE solicitudes_mercadeo ADD CONSTRAINT solicitudes_mercadeo_empresa_check
  CHECK (empresa IN ('PARCELAR','GREEN','RESO','IASO','IAS','CHIA_ABAGO','TECBIHOL','OTROS'));

ALTER TABLE solicitudes_mercadeo DROP CONSTRAINT IF EXISTS sm_empresa_otra_valida;
ALTER TABLE solicitudes_mercadeo ADD CONSTRAINT sm_empresa_otra_valida
  CHECK (
    (empresa = 'OTROS' AND empresa_otra IS NOT NULL AND char_length(btrim(empresa_otra)) BETWEEN 3 AND 100)
    OR (empresa <> 'OTROS' AND empresa_otra IS NULL)
  );

ALTER TABLE solicitudes_mercadeo DROP CONSTRAINT IF EXISTS sm_departamento_area_valido;
ALTER TABLE solicitudes_mercadeo ADD CONSTRAINT sm_departamento_area_valido
  CHECK (departamento_area IS NULL OR char_length(btrim(departamento_area)) BETWEEN 1 AND 120);

NOTIFY pgrst, 'reload schema';
