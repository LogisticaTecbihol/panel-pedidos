-- ============================================================
-- Fix: BodegasConsignacion — el índice único
-- bodegas_consignacion_empresa_nombre_uq (Nombre_Empresa, Nombre)
-- impedía registrar dos bodegas con el mismo nombre en municipios
-- distintos de la misma empresa (error "duplicate key value violates
-- unique constraint" al crear una bodega nueva en
-- bodegas-consignacion.html).
--
-- Se reemplaza por un índice que también incluye Municipio.
-- Aplicar con apply_migration del MCP de Supabase (no se aplica con
-- el push a GitHub).
-- Fecha: 2026-09-17
-- ============================================================

DROP INDEX IF EXISTS public.bodegas_consignacion_empresa_nombre_uq;

CREATE UNIQUE INDEX IF NOT EXISTS bodegas_consignacion_empresa_nombre_municipio_uq
  ON public."BodegasConsignacion" ("Nombre_Empresa", "Nombre", "Municipio");

NOTIFY pgrst, 'reload schema';
