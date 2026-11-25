-- ============================================================
-- «Rentabilidad IASO» → clasificación: carga de 21 productos que no figuraban en categorias.xlsx
--
-- Pedido 2026-11-25 («clasifica los 40 productos que faltan»). De los 40 productos que IASO ha vendido y no
-- estaban en el Excel, se clasifican 21 con estos criterios, confirmados con el usuario:
--   · 12 son OTRA PRESENTACIÓN de un producto que el Excel ya clasifica: heredan su clasificación.
--   · 9 por el nombre o la línea del producto (PEGASSO TOP como PEGASSO OIL/PH; NEMATO CROP → Nematicida;
--     GRADUS 43 SC y FOSTAL 80 WP —proveedor CV—, GROW GREEN SP y GREEN YODO → Fungicida). Son marcas propias:
--     no se pudieron verificar en fuentes externas, así que son una propuesta editable desde la pestaña.
-- Los otros 19 quedan en «Otros» (sin fila) por decisión del usuario: 10 que parecen fertilizantes (HAIFA PONY NPK,
-- VASTAGO 9-13-28 ×2, NITRATO DE ZINC ×3, GREEN CA-L, FERTI-HUMI 16 ×3), 7 sin identificar (ACI SI, ARACK GREEN ×3,
-- CUFIGA 80 WP, SABIAGRA, JABOLAN X GALON) y MOSKAKILL X LITRO y NUL, iguales a presentaciones que el Excel dejó en blanco.
--
-- Solo agrega filas (ON CONFLICT DO NOTHING: no pisa lo que ya se haya editado) en la tabla creada por
-- create_clasificacion_producto.sql, con sus triggers: queda en audit_log.
-- Reversión: clasificacion_producto_carga_pendientes_rollback.sql
-- ============================================================

INSERT INTO public."ClasificacionProducto" ("Producto", "Clasificacion", "creado_por_nombre", "creado_en")
SELECT btrim(regexp_replace(v.p, '\s+', ' ', 'g')), v.c, 'Carga asistida 2026-11-25 (por nombre o presentación)', now()
FROM (VALUES
    -- Otra presentación de un producto ya clasificado en el Excel
    ('AJO AJI ORTIGA X GALON', 'Insecticida'),
    ('BORCAMAG X BIDON 20 LITROS', 'Bioestimulante'),
    ('GENIUS-TECH X 250 ML', 'Nano menores'),
    ('GENIUS-TECH X LITRO', 'Nano menores'),
    ('GREEN CORRECTOR X 250 ML', 'Coadyuvante'),
    ('GREEN FUNGY-BAC X GALON', 'Fungicida'),
    ('NUTRICEL K50 X GALON', 'Bioestimulante'),
    ('PEGASSO OIL X 250 ML', 'Tensoactivo'),
    ('PEGASSO PH X 250 ML', 'Tensoactivo'),
    ('PEGASSO PH X GALON', 'Tensoactivo'),
    ('THYME GREEN X LITRO', 'Fungicida'),
    ('YODO X 500 ML', 'Fungicida'),
    -- Por el nombre o la línea del producto
    ('PEGASSO TOP X BIDON 20 LITROS', 'Tensoactivo'),
    ('PEGASSO TOP X LITRO', 'Tensoactivo'),
    ('NEMATO CROP X 500 ML', 'Nematicida'),
    ('NEMATO CROP X LITRO', 'Nematicida'),
    ('GRADUS 43 SC X LITRO CV', 'Fungicida'),
    ('FOSTAL 80 WP X 500 GR CV', 'Fungicida'),
    ('GROW GREEN SP X BIDON 20 LITROS', 'Fungicida'),
    ('GROW GREEN SP X LITRO', 'Fungicida'),
    ('GREEN YODO X BIDON 20 LITROS', 'Fungicida')
) AS v(p, c)
ON CONFLICT ("Producto_Clave") DO NOTHING;
