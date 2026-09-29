-- ============================================================
-- Remisiones externas de materia prima: planta de destino
--
-- Cada remisión de materia prima llega a una de las dos plantas de producción:
--   CACHIPAY -> empresa PARCELAR   |   MOSQUERA -> empresa GREEN
-- (misma relación planta/empresa de ORIGEN_EMPRESA en ingresos.js). La planta
-- define a qué empresa se cargan los gastos de la remisión en el reparto y en
-- Prorrateo, en lugar del grupo aparte "MATERIAS PRIMAS" (que solo queda para
-- las remisiones antiguas sin planta).
--
-- Planta solo aplica a Tipo = 'MATERIA_PRIMA' (NULL en Abago). Es obligatoria al
-- registrar/editar desde el panel (lo valida guardarRemisionExterna); en la
-- base queda NULL-able para las remisiones registradas antes de este cambio.
--
-- Backfill: las remisiones de materia prima que ya existían y tenían la planta
-- escrita en el campo Proveedor ("Planta Cachipay" / "Planta Mosquera") pasan a
-- la columna Planta y ese Proveedor se limpia (el proveedor real es otro dato).
--
-- Nota: el número de una remisión de materia prima YA puede repetirse: el panel
-- guarda el segundo con sufijo automático (MP-205, MP-205-2), así que el índice
-- único sobre el código no cambia.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

ALTER TABLE public."RemisionesExternas"
  ADD COLUMN IF NOT EXISTS "Planta" text;

ALTER TABLE public."RemisionesExternas"
  DROP CONSTRAINT IF EXISTS remisiones_externas_planta_valida;
ALTER TABLE public."RemisionesExternas"
  ADD CONSTRAINT remisiones_externas_planta_valida CHECK ("Planta" IS NULL OR "Planta" IN ('CACHIPAY', 'MOSQUERA'));

COMMENT ON COLUMN public."RemisionesExternas"."Planta" IS
  'Solo MATERIA_PRIMA: planta de producción que recibe la materia prima. CACHIPAY = empresa PARCELAR; MOSQUERA = empresa GREEN. Define la empresa a la que se cargan los gastos de la remisión.';

-- Backfill de las remisiones de materia prima que ya tenían la planta en Proveedor.
UPDATE public."RemisionesExternas"
   SET "Planta" = 'CACHIPAY', "Proveedor" = ''
 WHERE "Tipo" = 'MATERIA_PRIMA' AND "Planta" IS NULL
   AND btrim("Proveedor") ILIKE 'planta cachipay';

UPDATE public."RemisionesExternas"
   SET "Planta" = 'MOSQUERA', "Proveedor" = ''
 WHERE "Tipo" = 'MATERIA_PRIMA' AND "Planta" IS NULL
   AND btrim("Proveedor") ILIKE 'planta mosquera';

NOTIFY pgrst, 'reload schema';
