-- =============================================================
-- Normalización de Municipios en tablas Clientes y ClientesUnicos
-- Fecha: 2026-08-26
-- =============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- TABLA "Clientes"
-- ─────────────────────────────────────────────

-- Bogotá
UPDATE "Clientes" SET "Municipio" = 'Bogotá D.C.'
WHERE "Municipio" IN ('BOGOTA','Bogotá','Bogota D.C.','Bootá');

-- Cundinamarca
UPDATE "Clientes" SET "Municipio" = 'Mosquera' WHERE "Municipio" IN ('MOSQUERA','mosquera');
UPDATE "Clientes" SET "Municipio" = 'Cota' WHERE "Municipio" IN ('COTA','cota');
UPDATE "Clientes" SET "Municipio" = 'Fusagasugá' WHERE "Municipio" = 'FUSAGASUGA';
UPDATE "Clientes" SET "Municipio" = 'Cogua' WHERE "Municipio" = 'COGUA';
UPDATE "Clientes" SET "Municipio" = 'Cáqueza' WHERE "Municipio" IN ('CAQUEZA','Caqueza');
UPDATE "Clientes" SET "Municipio" = 'Villeta' WHERE "Municipio" = 'VILLETA';
UPDATE "Clientes" SET "Municipio" = 'Pasca' WHERE "Municipio" = 'PASCA';
UPDATE "Clientes" SET "Municipio" = 'Facatativá' WHERE "Municipio" = 'Facatativa';
UPDATE "Clientes" SET "Municipio" = 'Fómeque' WHERE "Municipio" IN ('FOMEQUE','Fomeque');
UPDATE "Clientes" SET "Municipio" = 'Subachoque' WHERE "Municipio" = 'subachoque';
UPDATE "Clientes" SET "Municipio" = 'Sibaté' WHERE "Municipio" = 'SIBATE';
UPDATE "Clientes" SET "Municipio" = 'Une' WHERE "Municipio" = 'UNE';
UPDATE "Clientes" SET "Municipio" = 'Funza' WHERE "Municipio" = 'FUNZA';
UPDATE "Clientes" SET "Municipio" = 'Sesquilé' WHERE "Municipio" = 'SESQUILE';
UPDATE "Clientes" SET "Municipio" = 'Gutiérrez' WHERE "Municipio" = 'GUTIÉRREZ';
UPDATE "Clientes" SET "Municipio" = 'Cabrera' WHERE "Municipio" = 'CABRERA';
UPDATE "Clientes" SET "Municipio" = 'Machetá' WHERE "Municipio" = 'Macheta';
UPDATE "Clientes" SET "Municipio" = 'Carmen de Carupa' WHERE "Municipio" = 'CARME DE CARUPA';
UPDATE "Clientes" SET "Municipio" = 'Nariño' WHERE "Municipio" = 'NARIÑO';
UPDATE "Clientes" SET "Municipio" = 'Villapinzón' WHERE "Municipio" IN ('VILLA PINZON','Villa Pinzon');
UPDATE "Clientes" SET "Municipio" = 'Venecia' WHERE "Municipio" = 'VENECIA';

-- Boyacá
UPDATE "Clientes" SET "Municipio" = 'Tunja' WHERE "Municipio" = 'TUNJA';
UPDATE "Clientes" SET "Municipio" = 'Paipa' WHERE "Municipio" = 'PAIPA';
UPDATE "Clientes" SET "Municipio" = 'Duitama' WHERE "Municipio" = 'DUITAMA';
UPDATE "Clientes" SET "Municipio" = 'Sogamoso' WHERE "Municipio" = 'SOGAMOSO';
UPDATE "Clientes" SET "Municipio" = 'Villa de Leyva' WHERE "Municipio" IN ('VILLADELEYVA','Villa De Leyva');
UPDATE "Clientes" SET "Municipio" = 'Buenavista' WHERE "Municipio" = 'BUENAVISTA';
UPDATE "Clientes" SET "Municipio" = 'Saboyá' WHERE "Municipio" IN ('SABOYA','Saboya');
UPDATE "Clientes" SET "Municipio" = 'Ubaté' WHERE "Municipio" = 'UBATE';

-- Tolima
UPDATE "Clientes" SET "Municipio" = 'Ibagué' WHERE "Municipio" = 'IBAGUE';
UPDATE "Clientes" SET "Municipio" = 'Cajamarca' WHERE "Municipio" = 'CAJAMARCA';
UPDATE "Clientes" SET "Municipio" = 'Fresno' WHERE "Municipio" = 'FRESNO';

-- Nariño
UPDATE "Clientes" SET "Municipio" = 'Pasto' WHERE "Municipio" IN ('PASTO','pasto nariño');
UPDATE "Clientes" SET "Municipio" = 'Buesaco' WHERE "Municipio" IN ('BUESACO','BUESACO - BARRIO SOCORRO');
UPDATE "Clientes" SET "Municipio" = 'Pupiales' WHERE "Municipio" = 'PUPIALES';

-- Huila
UPDATE "Clientes" SET "Municipio" = 'Neiva' WHERE "Municipio" = 'NEIVA';
UPDATE "Clientes" SET "Municipio" = 'Suaza' WHERE "Municipio" = 'SUAZA';

-- Risaralda
UPDATE "Clientes" SET "Municipio" = 'Pereira' WHERE "Municipio" IN ('PEREIRA','pereira');

-- Valle del Cauca
UPDATE "Clientes" SET "Municipio" = 'Cartago' WHERE "Municipio" = 'CARTAGO';

-- Meta
UPDATE "Clientes" SET "Municipio" = 'Villavicencio' WHERE "Municipio" = 'VILLAVICENCIO';

-- Santander
UPDATE "Clientes" SET "Municipio" = 'Málaga' WHERE "Municipio" = 'MALAGA';
UPDATE "Clientes" SET "Municipio" = 'Bucaramanga' WHERE "Municipio" = 'BUCARAMANGA';

-- Casanare
UPDATE "Clientes" SET "Municipio" = 'Tauramena' WHERE "Municipio" = 'TAURAMENA';

-- Caldas (typo)
UPDATE "Clientes" SET "Municipio" = 'Manizales' WHERE "Municipio" = 'MANIZALEZ';

-- ─────────────────────────────────────────────
-- TABLA "ClientesUnicos"
-- ─────────────────────────────────────────────

-- Bogotá
UPDATE "ClientesUnicos" SET "Municipio" = 'Bogotá D.C.'
WHERE "Municipio" IN ('Bogota D.C.','BOGOTA','Bogotá','Bootá');

-- Cundinamarca
UPDATE "ClientesUnicos" SET "Municipio" = 'Mosquera' WHERE "Municipio" = 'MOSQUERA';
UPDATE "ClientesUnicos" SET "Municipio" = 'Cota' WHERE "Municipio" IN ('COTA','cota');
UPDATE "ClientesUnicos" SET "Municipio" = 'Fómeque' WHERE "Municipio" = 'Fomeque';
UPDATE "ClientesUnicos" SET "Municipio" = 'Cáqueza' WHERE "Municipio" = 'Caqueza';
UPDATE "ClientesUnicos" SET "Municipio" = 'Subachoque' WHERE "Municipio" = 'subachoque';
UPDATE "ClientesUnicos" SET "Municipio" = 'Sibaté' WHERE "Municipio" = 'sibate';
UPDATE "ClientesUnicos" SET "Municipio" = 'Cogua' WHERE "Municipio" = 'cogua';
UPDATE "ClientesUnicos" SET "Municipio" = 'Machetá' WHERE "Municipio" = 'Macheta';
UPDATE "ClientesUnicos" SET "Municipio" = 'Villeta' WHERE "Municipio" = 'villeta';
UPDATE "ClientesUnicos" SET "Municipio" = 'Soacha' WHERE "Municipio" = 'SOACHA';
UPDATE "ClientesUnicos" SET "Municipio" = 'El Rosal' WHERE "Municipio" IN ('rosal','Rosal');
UPDATE "ClientesUnicos" SET "Municipio" = 'Ubaté' WHERE "Municipio" = 'ubate';
UPDATE "ClientesUnicos" SET "Municipio" = 'Carmen de Carupa' WHERE "Municipio" = 'Carmen De Carupa';
UPDATE "ClientesUnicos" SET "Municipio" = 'Carmen de Apicalá' WHERE "Municipio" = 'Carmen De Apicalá';
UPDATE "ClientesUnicos" SET "Municipio" = 'Villapinzón' WHERE "Municipio" IN ('VILLA PINZON','Villa Pinzon');
UPDATE "ClientesUnicos" SET "Municipio" = 'Santander de Quilichao' WHERE "Municipio" = 'Santander De Quilichao';

-- Boyacá
UPDATE "ClientesUnicos" SET "Municipio" = 'Tunja' WHERE "Municipio" IN ('TUNJA','tunja');
UPDATE "ClientesUnicos" SET "Municipio" = 'Sogamoso' WHERE "Municipio" = 'sogamoso';
UPDATE "ClientesUnicos" SET "Municipio" = 'Villa de Leyva' WHERE "Municipio" = 'Villa De Leyva';
UPDATE "ClientesUnicos" SET "Municipio" = 'Tibaná' WHERE "Municipio" = 'tibana';

-- Huila
UPDATE "ClientesUnicos" SET "Municipio" = 'Neiva' WHERE "Municipio" = 'NEIVA';

-- Risaralda
UPDATE "ClientesUnicos" SET "Municipio" = 'Pereira' WHERE "Municipio" = 'PEREIRA';

-- Nariño
UPDATE "ClientesUnicos" SET "Municipio" = 'Pupiales' WHERE "Municipio" = 'PUPIALES';
UPDATE "ClientesUnicos" SET "Municipio" = 'La Unión' WHERE "Municipio" = 'LA UNION';

-- Putumayo
UPDATE "ClientesUnicos" SET "Municipio" = 'Puerto Asís' WHERE "Municipio" = 'PUERTO ASIS';

-- Antioquia
UPDATE "ClientesUnicos" SET "Municipio" = 'Itagüí' WHERE "Municipio" = 'Itagui';

COMMIT;
