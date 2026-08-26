-- =============================================================
-- Normalización de Municipios y Departamentos existentes
-- Fecha: 2026-08-26
-- Afecta: ~621 filas (municipio) + ~528 filas (departamento)
-- =============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. NORMALIZAR DEPARTAMENTOS
-- ─────────────────────────────────────────────

UPDATE "Pedidos" SET "Departamento" = 'Cundinamarca'
WHERE "Departamento" IN ('CUNDINAMARCA','cundinamarca','cund','CUND');

UPDATE "Pedidos" SET "Departamento" = 'Boyacá'
WHERE "Departamento" IN ('BOYACA','boyaca');

UPDATE "Pedidos" SET "Departamento" = 'Risaralda'
WHERE "Departamento" IN ('RISARALDA','risaralda');

UPDATE "Pedidos" SET "Departamento" = 'Nariño'
WHERE "Departamento" IN ('NARIÑO','nariño');

UPDATE "Pedidos" SET "Departamento" = 'Huila'
WHERE "Departamento" = 'HUILA';

UPDATE "Pedidos" SET "Departamento" = 'Tolima'
WHERE "Departamento" = 'TOLIMA';

UPDATE "Pedidos" SET "Departamento" = 'Meta'
WHERE "Departamento" = 'META';

UPDATE "Pedidos" SET "Departamento" = 'Casanare'
WHERE "Departamento" = 'CASANARE';

UPDATE "Pedidos" SET "Departamento" = 'Santander'
WHERE "Departamento" = 'SANTANDER';

UPDATE "Pedidos" SET "Departamento" = 'Valle del Cauca'
WHERE "Departamento" = 'VALLE DEL CAUCA';

-- ─────────────────────────────────────────────
-- 2. NORMALIZAR MUNICIPIOS (+ corregir depto donde aplique)
-- ─────────────────────────────────────────────

-- Bogotá (todas las variantes)
UPDATE "Pedidos" SET "Municipio" = 'Bogotá D.C.', "Departamento" = 'Bogotá D.C.'
WHERE "Municipio" IN ('BOGOTA','Bogotá','Bogota D.C.','Bootá');

-- Municipios con acento o mayúsculas — Cundinamarca
UPDATE "Pedidos" SET "Municipio" = 'Mosquera' WHERE "Municipio" IN ('MOSQUERA','mosquera');
UPDATE "Pedidos" SET "Municipio" = 'Cota' WHERE "Municipio" IN ('COTA','cota');
UPDATE "Pedidos" SET "Municipio" = 'Fusagasugá' WHERE "Municipio" = 'FUSAGASUGA';
UPDATE "Pedidos" SET "Municipio" = 'Cogua' WHERE "Municipio" = 'COGUA';
UPDATE "Pedidos" SET "Municipio" = 'Cáqueza' WHERE "Municipio" IN ('CAQUEZA','Caqueza');
UPDATE "Pedidos" SET "Municipio" = 'Villeta' WHERE "Municipio" = 'VILLETA';
UPDATE "Pedidos" SET "Municipio" = 'Pasca' WHERE "Municipio" IN ('PASCA','pasca');
UPDATE "Pedidos" SET "Municipio" = 'Arbeláez' WHERE "Municipio" = 'ARBELAEZ';
UPDATE "Pedidos" SET "Municipio" = 'Facatativá' WHERE "Municipio" IN ('FACATATIVA','facatativa','Facatativa');
UPDATE "Pedidos" SET "Municipio" = 'Ubaté' WHERE "Municipio" = 'UBATE';
UPDATE "Pedidos" SET "Municipio" = 'Fómeque' WHERE "Municipio" IN ('FOMEQUE','Fomeque');
UPDATE "Pedidos" SET "Municipio" = 'Subachoque' WHERE "Municipio" IN ('SUBACHOQUE','subachoque');
UPDATE "Pedidos" SET "Municipio" = 'Sibaté' WHERE "Municipio" IN ('SIBATE','sibate');
UPDATE "Pedidos" SET "Municipio" = 'Une' WHERE "Municipio" = 'UNE';
UPDATE "Pedidos" SET "Municipio" = 'Funza' WHERE "Municipio" IN ('FUNZA','funza');
UPDATE "Pedidos" SET "Municipio" = 'Tausa' WHERE "Municipio" = 'TAUSA';
UPDATE "Pedidos" SET "Municipio" = 'Sesquilé' WHERE "Municipio" = 'SESQUILE';
UPDATE "Pedidos" SET "Municipio" = 'Gutiérrez' WHERE "Municipio" = 'GUTIÉRREZ';
UPDATE "Pedidos" SET "Municipio" = 'Cabrera' WHERE "Municipio" = 'CABRERA';
UPDATE "Pedidos" SET "Municipio" = 'Granada' WHERE "Municipio" = 'GRANADA';
UPDATE "Pedidos" SET "Municipio" = 'Machetá' WHERE "Municipio" = 'Macheta';
UPDATE "Pedidos" SET "Municipio" = 'El Rosal' WHERE "Municipio" IN ('rosal','Rosal');
UPDATE "Pedidos" SET "Municipio" = 'Carmen de Carupa' WHERE "Municipio" = 'CARME DE CARUPA';
UPDATE "Pedidos" SET "Municipio" = 'Nariño' WHERE "Municipio" = 'NARIÑO';

-- Municipios — Boyacá
UPDATE "Pedidos" SET "Municipio" = 'Tunja' WHERE "Municipio" IN ('TUNJA','tunja');
UPDATE "Pedidos" SET "Municipio" = 'Paipa' WHERE "Municipio" = 'PAIPA';
UPDATE "Pedidos" SET "Municipio" = 'Duitama' WHERE "Municipio" = 'DUITAMA';
UPDATE "Pedidos" SET "Municipio" = 'Sogamoso' WHERE "Municipio" = 'SOGAMOSO';
UPDATE "Pedidos" SET "Municipio" = 'Villa de Leyva' WHERE "Municipio" IN ('VILLADELEYVA','Villa De Leyva','VILLA DELEYVA');
UPDATE "Pedidos" SET "Municipio" = 'Villapinzón' WHERE "Municipio" IN ('VILLA PINZON','Villa Pinzon');
UPDATE "Pedidos" SET "Municipio" = 'Buenavista' WHERE "Municipio" = 'BUENAVISTA';
UPDATE "Pedidos" SET "Municipio" = 'Saboyá' WHERE "Municipio" = 'SABOYA';
UPDATE "Pedidos" SET "Municipio" = 'Ventaquemada' WHERE "Municipio" = 'VENTAQUEMADA';

-- Municipios — Tolima
UPDATE "Pedidos" SET "Municipio" = 'Ibagué' WHERE "Municipio" = 'IBAGUE';
UPDATE "Pedidos" SET "Municipio" = 'Cajamarca' WHERE "Municipio" = 'CAJAMARCA';
UPDATE "Pedidos" SET "Municipio" = 'Fresno' WHERE "Municipio" = 'FRESNO';

-- Municipios — Nariño
UPDATE "Pedidos" SET "Municipio" = 'Pasto' WHERE "Municipio" = 'PASTO';
UPDATE "Pedidos" SET "Municipio" = 'Buesaco' WHERE "Municipio" IN ('BUESACO','BUESACO - BARRIO SOCORRO');
UPDATE "Pedidos" SET "Municipio" = 'Pupiales' WHERE "Municipio" = 'PUPIALES';

-- Municipios — Huila
UPDATE "Pedidos" SET "Municipio" = 'Neiva' WHERE "Municipio" = 'NEIVA';
UPDATE "Pedidos" SET "Municipio" = 'Suaza' WHERE "Municipio" = 'SUAZA';

-- Municipios — Risaralda
UPDATE "Pedidos" SET "Municipio" = 'Pereira' WHERE "Municipio" IN ('PEREIRA','pereira');

-- Municipios — Valle del Cauca
UPDATE "Pedidos" SET "Municipio" = 'Cartago' WHERE "Municipio" = 'CARTAGO';

-- Municipios — Meta
UPDATE "Pedidos" SET "Municipio" = 'Villavicencio' WHERE "Municipio" = 'VILLAVICENCIO';

-- Municipios — Santander
UPDATE "Pedidos" SET "Municipio" = 'Málaga' WHERE "Municipio" = 'MALAGA';
UPDATE "Pedidos" SET "Municipio" = 'Bucaramanga' WHERE "Municipio" = 'BUCARAMANGA';

-- Municipios — Casanare
UPDATE "Pedidos" SET "Municipio" = 'Tauramena' WHERE "Municipio" = 'TAURAMENA';

-- Municipios — Caldas (typo)
UPDATE "Pedidos" SET "Municipio" = 'Manizales', "Departamento" = 'Caldas'
WHERE "Municipio" = 'MANIZALEZ';

-- Villapinzón pertenece a Cundinamarca (no Boyacá)
UPDATE "Pedidos" SET "Departamento" = 'Cundinamarca'
WHERE "Municipio" = 'Villapinzón' AND "Departamento" != 'Cundinamarca';

COMMIT;
