-- Solicitudes a Mercadeo: campo opcional «Productos relacionados».
--
-- El solicitante puede registrar los productos relacionados con la solicitud: los busca en el maestro de productos
-- (maestro_productos) por el NOMBRE, sin la presentación («CALIMAN X LITRO» y «CALIMAN X GALON» dan «CALIMAN»), o escribe
-- el nombre directo si no está en el listado. Se guarda como arreglo de textos: {CALIMAN,"Otro producto"}.
--   · productos -> hasta 20 nombres (el largo de cada nombre, 2-100 caracteres, lo valida la función solicitud-mercadeo, que
--                  es la única que escribe en esta tabla). Vacío por defecto: las solicitudes anteriores quedan sin productos.
--
-- Los productos viajan a Mercadeo (panel-pqrs) con la solicitud, en el encabezado del brief de la tarea del Tablero.
-- Cambio aditivo y retrocompatible. Idempotente. Aplicar como migración remota: add_solicitudes_mercadeo_productos
-- Orden de despliegue: primero esta migración, luego la función solicitud-mercadeo (ya inserta la columna) y al final el frontend.

ALTER TABLE solicitudes_mercadeo ADD COLUMN IF NOT EXISTS productos text[] NOT NULL DEFAULT '{}';

ALTER TABLE solicitudes_mercadeo DROP CONSTRAINT IF EXISTS sm_productos_valido;
ALTER TABLE solicitudes_mercadeo ADD CONSTRAINT sm_productos_valido
  CHECK (cardinality(productos) <= 20);

NOTIFY pgrst, 'reload schema';
