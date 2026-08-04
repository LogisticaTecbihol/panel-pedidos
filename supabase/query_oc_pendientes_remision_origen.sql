-- OC históricas que antes descontaban del origen y ahora ya no,
-- hasta que se les registre "Remisión Origen".
-- Criterio: Remisión Destino está llena, Empresa_Origen distinta de Empresa_Destino,
-- estado no Anulada, y Remision_Origen vacía.
select
  id,
  "Fecha",
  "Consecutivo",
  "Empresa_Destino",
  "Empresa_Origen",
  "Producto",
  "Presentacion",
  "Cantidad",
  "Remision"       as "Remision_Destino",
  "Remision_Origen",
  "Estado"
from "OrdenesCompra"
where coalesce(trim("Remision"), '') <> ''
  and coalesce("Empresa_Origen", '') <> ''
  and coalesce("Empresa_Origen", '') <> coalesce("Empresa_Destino", '')
  and lower(coalesce("Estado", '')) <> 'anulada'
  and coalesce(trim("Remision_Origen"), '') = ''
order by "Fecha" desc, "Consecutivo";
