-- ============================================================
-- Relleno del "Reparto entre empresas" de las legalizaciones de gasto
-- existentes (LEG-00002 .. LEG-00012, 2026-09-29).
--
-- Todas tenían el reparto en $0 (filas de empresa creadas por el
-- autocompletado desde las remisiones, sin montos). Se calcula igual que el
-- botón "Calcular reparto" del formulario (calcularRepartoSugerido en
-- js/legalizacion-gastos.js):
--   * base = gastos de la legalización SIN Combustible (el combustible no se
--     prorratea por ahora);
--   * separado en bolsa de líquidos (por litro) y de sólidos (por kilo),
--     proporcional a cuántas remisiones aportan a cada una, y dentro de cada
--     bolsa según los litros/kilos de cada empresa (Pedidos + Ingresos +
--     Muestras + Devoluciones);
--   * pesos enteros por el método del mayor resto, así la suma cuadra con la
--     base.
-- LEG-00009 y LEG-00012 son 100% combustible: no tienen base, quedan en $0.
--
-- Solo toca filas con Monto = 0 (nunca pisa un reparto puesto a mano) y solo
-- legalizaciones 'Por conciliar'. Valores previos: todos 0.
-- Es un relleno de DATOS (no requiere NOTIFY pgrst).
-- ============================================================

UPDATE public."LegalizacionGastosEmpresas" e
   SET "Monto" = v.monto
  FROM (VALUES
    -- LEG-00002 (base 12.400)
    (2,  'INSUMOS AGROPECUARIOS DE LA SABANA SAS',    502),
    (2,  'GREEN AGROSOLUCIONES DE COLOMBIA SAS',     2764),
    (2,  'PARCELAR DE COLOMBIA SAS',                 9134),
    -- LEG-00003 (base 12.400)
    (3,  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS',   12400),
    -- LEG-00004 (base 12.400)
    (4,  'SOLUCIONES INTEGRALES RESO SAS',           4742),
    (4,  'GREEN AGROSOLUCIONES DE COLOMBIA SAS',     3387),
    (4,  'PARCELAR DE COLOMBIA SAS',                 4271),
    -- LEG-00005 (base 203.179)
    (5,  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS',  203179),
    -- LEG-00006 (base 76.987)
    (6,  'PARCELAR DE COLOMBIA SAS',                76987),
    -- LEG-00007 (base 214.000)
    (7,  'SOLUCIONES INTEGRALES RESO SAS',          82398),
    (7,  'PARCELAR DE COLOMBIA SAS',                43413),
    (7,  'GREEN AGROSOLUCIONES DE COLOMBIA SAS',    88189),
    -- LEG-00008 (base 12.400)
    (8,  'INSUMOS AGROPECUARIOS DE LA SABANA SAS',  12189),
    (8,  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS',     211),
    -- LEG-00010 (base 121.600)
    (10, 'PARCELAR DE COLOMBIA SAS',               114844),
    (10, 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS',    6756),
    -- LEG-00011 (base 200.500)
    (11, 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS',  198778),
    (11, 'INSUMOS AGROPECUARIOS DE LA SABANA SAS',    620),
    (11, 'GREEN AGROSOLUCIONES DE COLOMBIA SAS',      505),
    (11, 'SOLUCIONES INTEGRALES RESO SAS',            597)
  ) AS v(leg_id, empresa, monto)
 WHERE e."Legalizacion_Id" = v.leg_id
   AND e."Empresa" = v.empresa
   AND e."Monto" = 0
   AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" g
                WHERE g.id = e."Legalizacion_Id" AND g."Estado_Conciliacion" = 'Por conciliar');
