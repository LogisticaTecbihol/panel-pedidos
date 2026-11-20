-- Rollback de add_cliente_nit_muestras.sql.
-- Borra las dos columnas y lo que se haya guardado en ellas. Publicar antes el código anterior
-- (si no, agregarMuestra falla al insertar «Cliente»/«NIT»).

alter table public."SolicitudMuestras" drop column if exists "NIT";
alter table public."SolicitudMuestras" drop column if exists "Cliente";
