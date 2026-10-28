-- ─────────────────────────────────────────────────────────────────────────────
-- CambiosMercancia: datos de entrega del cliente (Sucursal, Dirección, Municipio, Departamento)
--
-- El formulario «Registrar Cambio de Mercancía» (devoluciones.html → js/cambios.js) captura los mismos
-- datos de entrega que «Nuevo Pedido». Son datos del cambio completo (no de cada línea): como Cliente,
-- NIT o Teléfono, se repiten en todas las filas del cambio.
--
--   Sucursal         sucursal / bodega del cliente elegida de la lista (opcional)
--   Direccion_Envio  dirección de la entrega o recogida (opcional)
--   Municipio        obligatorio en el formulario (salvo carga histórica), normalizado con js/colombia-geo.js
--   Departamento     obligatorio en el formulario (salvo carga histórica), normalizado con js/colombia-geo.js
--
-- Mismos nombres que en Pedidos. Mismo patrón que las demás columnas de texto de la tabla (text, default '',
-- nullable). Los cambios anteriores quedan con '' (sin backfill): la pantalla los muestra como «—».
-- No se toca el trámite parcial (Movs_Ingreso / Movs_Salida, RPC tramitar_cambio): no usa estas columnas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."CambiosMercancia"
  ADD COLUMN IF NOT EXISTS "Sucursal"        text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Direccion_Envio" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Municipio"       text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Departamento"    text DEFAULT '';

-- Refrescar el schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
