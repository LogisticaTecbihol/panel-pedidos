-- Solicitud de muestras: campos opcionales «Cliente» y «NIT».
--
-- Son datos de la solicitud completa (no de cada línea): igual que Responsable o Municipio, se repiten en todas
-- las filas del consecutivo. Las solicitudes anteriores quedan con '' (sin relleno); el detalle muestra «—» y la
-- remisión PDF sigue imprimiendo el Solicitante como hasta ahora cuando el Cliente está vacío.
-- Mismos nombres que en Pedidos / Devoluciones / CambiosMercancia ("Cliente", "NIT").
--
-- Aditiva e idempotente. Aplicar ANTES de publicar el código: agregarMuestra ya inserta las dos columnas.

alter table public."SolicitudMuestras" add column if not exists "Cliente" text not null default '';
alter table public."SolicitudMuestras" add column if not exists "NIT"     text not null default '';
