-- ============================================================
-- Remisiones externas de materia prima: varias plantas/empresas de destino
--
-- Hasta ahora RemisionesExternas."Planta" aceptaba UN valor: CACHIPAY (empresa
-- PARCELAR) o MOSQUERA (empresa GREEN). Ahora una remisión de materia prima
-- puede cargarse a varias empresas, y además de las dos plantas se puede elegir
-- directamente IASO, IAS o RESO.
--
-- Se mantiene la columna de texto: guarda los códigos separados por coma, sin
-- espacios y en este orden canónico: CACHIPAY, MOSQUERA, IASO, IAS, RESO
-- (ej. 'CACHIPAY,IASO'). Es compatible con lo ya guardado: los valores
-- 'CACHIPAY' y 'MOSQUERA' siguen siendo válidos; NULL = sin planta (grupo
-- "MATERIAS PRIMAS").
--
-- Con varias empresas, el panel reparte cada producto de la remisión en partes
-- iguales entre ellas (Prorrateo y reparto manual).
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

ALTER TABLE public."RemisionesExternas"
  DROP CONSTRAINT IF EXISTS remisiones_externas_planta_valida;
ALTER TABLE public."RemisionesExternas"
  ADD CONSTRAINT remisiones_externas_planta_valida CHECK (
    "Planta" IS NULL
    OR "Planta" ~ '^(CACHIPAY|MOSQUERA|IASO|IAS|RESO)(,(CACHIPAY|MOSQUERA|IASO|IAS|RESO))*$'
  );

COMMENT ON COLUMN public."RemisionesExternas"."Planta" IS
  'Solo MATERIA_PRIMA: planta(s)/empresa(s) a las que se carga la remisión, códigos separados por coma (CACHIPAY=PARCELAR, MOSQUERA=GREEN, IASO, IAS, RESO). Con varias, los productos se reparten en partes iguales. NULL = sin planta (grupo MATERIAS PRIMAS).';

NOTIFY pgrst, 'reload schema';
