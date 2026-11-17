-- ROLLBACK de bodega_satelite_search_path.sql — devuelve los 3 helpers a su estado original (sin search_path fijo).
ALTER FUNCTION public._bodega_signo(text)         RESET search_path;
ALTER FUNCTION public._bodega_presentacion(text)  RESET search_path;
ALTER FUNCTION public._bodega_fecha_segura(text)  RESET search_path;
