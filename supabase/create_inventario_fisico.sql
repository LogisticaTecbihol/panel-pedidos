-- Tabla para almacenar conteos de inventario físico
CREATE TABLE "InventarioFisico" (
  id bigint generated always as identity primary key,
  "Fecha_Conteo"      date NOT NULL,
  "Empresa"           text NOT NULL,
  "Producto"          text NOT NULL,
  "Presentacion"      text DEFAULT '',
  "Cantidad_Fisica"   numeric DEFAULT 0,
  "Cantidad_Sistema"  numeric DEFAULT 0,
  "Diferencia"        numeric DEFAULT 0,
  "Observaciones"     text DEFAULT '',
  "Estado"            text DEFAULT 'Borrador',
  "Fecha_Registro"    timestamp DEFAULT now(),
  "creado_por"        uuid,
  "modificado_por"    uuid
);

-- RLS
ALTER TABLE "InventarioFisico" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invf_select" ON "InventarioFisico"
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "invf_insert" ON "InventarioFisico"
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "invf_update" ON "InventarioFisico"
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "invf_delete" ON "InventarioFisico"
  FOR DELETE USING (auth.role() = 'authenticated');
